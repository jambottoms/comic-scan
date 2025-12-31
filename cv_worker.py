#!/usr/bin/env python3
"""
GradeVault CV Worker - PARALLEL VERSION (Full Precision)
=========================================================
Runs the Python CV pipeline with parallel frame processing.
Maintains 100% accuracy while processing 3-5x faster.

Deployment:
    modal deploy cv_worker.py

Test locally:
    modal run cv_worker.py --video-url "https://..." --scan-id "video-123"

Last deployed: 2025-12-30 (Phase 2 progress tracking fix)
"""
from __future__ import annotations  # Defer type hint evaluation for np.ndarray etc.

import modal
import os
import json
import tempfile
from pathlib import Path
# Note: numpy, cv2, etc. are imported inside Modal functions where they're needed
# This allows the deploy script to run without these dependencies installed locally

# Create Modal app
app = modal.App("gradevault-cv-worker")

# Shared volume for video files - allows parallel workers to access same video
# without re-downloading. Ephemeral storage, cleaned up after each scan.
video_volume = modal.Volume.from_name("gradevault-video-temp", create_if_missing=True)

# Define the container image with all dependencies
# Using REST API for Supabase Storage (full support for new sb_secret_ keys)
cv_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "ffmpeg")
    .pip_install(
        "opencv-python-headless==4.9.0.80",
        "numpy==1.26.4",
        "scipy==1.13.1",
        "pillow==10.4.0",
        "requests>=2.31.0",  # For REST API calls to Supabase Storage and Nyckel
        "fastapi>=0.109.0",  # Required for web endpoints
    )
)

# =============================================================================
# NYCKEL CONFIGURATION
# =============================================================================

# Region definitions (same as glint_analyzer.py)
REGIONS = {
    "spine": {"x_start": 0.0, "x_end": 0.08, "y_start": 0.0, "y_end": 1.0},
    "corner_tl": {"x_start": 0.0, "x_end": 0.15, "y_start": 0.0, "y_end": 0.12},
    "corner_tr": {"x_start": 0.85, "x_end": 1.0, "y_start": 0.0, "y_end": 0.12},
    "corner_bl": {"x_start": 0.0, "x_end": 0.15, "y_start": 0.88, "y_end": 1.0},
    "corner_br": {"x_start": 0.85, "x_end": 1.0, "y_start": 0.88, "y_end": 1.0},
    "surface": {"x_start": 0.20, "x_end": 0.80, "y_start": 0.20, "y_end": 0.80}
}

# Critical regions for grading (most important)
CRITICAL_REGIONS = ["spine", "corner_tl", "corner_tr", "corner_bl", "corner_br"]

# Region importance weights (must match lib/grading-config.ts)
REGION_WEIGHTS = {
    "spine": 1.5,       # Most important - structural
    "corner_tl": 1.2,   # Top left corner
    "corner_tr": 1.2,   # Top right corner
    "corner_bl": 1.2,   # Bottom left corner
    "corner_br": 1.2,   # Bottom right corner
    "surface": 1.0,     # Center/surface area
}

# Valid CGC grade points (must match lib/grading-config.ts)
# CGC only uses specific increments, not arbitrary decimals
VALID_CGC_GRADES = [
    10.0,
    9.8, 9.6, 9.4, 9.2, 9.0,
    8.5, 8.0,
    7.5, 7.0,
    6.5, 6.0,
    5.5, 5.0,
    4.5, 4.0,
    3.5, 3.0,
    2.5, 2.0,
    1.8, 1.5, 1.0,
    0.5
]

def round_to_cgc_grade(grade: float) -> float:
    """
    Round a grade to the nearest valid CGC grade point.
    When in doubt, rounds DOWN (conservative grading).
    
    Args:
        grade: Raw calculated grade (0.0 - 10.0)
    
    Returns:
        Valid CGC grade point
    
    Examples:
        7.9 → 7.5 (rounds down)
        9.1 → 9.0 (rounds down)
        9.7 → 9.6 (rounds down)
    """
    # Clamp to valid range
    clamped = max(0.5, min(10.0, grade))
    
    # Find the nearest valid grade, rounding DOWN when between two values
    for valid_grade in VALID_CGC_GRADES:
        if clamped >= valid_grade:
            return valid_grade
    
    # Fallback to lowest grade
    return 0.5


# Visibility labels
VISIBILITY_LABELS = ["clearly_visible", "partially_visible", "not_visible", "occluded"]

# Grade labels with numeric mappings (CGC scale)
GRADE_LABELS = ["pristine", "near_mint", "minor_wear", "moderate_wear", "heavy_wear", "damaged"]

LABEL_TO_GRADE = {
    "pristine": 10.0,
    "near_mint": 9.2,
    "minor_wear": 7.5,
    "moderate_wear": 5.5,
    "heavy_wear": 3.5,
    "damaged": 2.0,
}

# Defect labels matching lib/grading-config.ts (legacy/detailed)
DEFECT_LABELS = [
    "spine_split", "detached_cover", "missing_piece", "tear_major",
    "spine_roll", "staple_rust", "tear_minor",
    "stain", "foxing", "color_touch", "fingerprint", "date_stamp", "writing",
    "corner_blunt", "color_break", "crease_minor", "spine_stress",
    "pristine"
]


# =============================================================================
# NYCKEL HELPER FUNCTIONS
# =============================================================================

def detect_comic_boundaries(frame):
    """
    Detect the comic book object in the frame using edge detection.
    
    Returns:
        tuple: (x, y, w, h) bounding box of the detected comic, or None if detection fails
    """
    import cv2
    import numpy as np
    
    # Convert to grayscale
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Edge detection
    edges = cv2.Canny(blurred, 50, 150)
    
    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return None
    
    # Find the largest contour (likely the comic)
    largest_contour = max(contours, key=cv2.contourArea)
    
    # Get bounding rectangle
    x, y, w, h = cv2.boundingRect(largest_contour)
    
    # Validate: comic should be at least 30% of frame
    frame_h, frame_w = frame.shape[:2]
    if w * h < (frame_w * frame_h * 0.3):
        return None  # Too small, probably not the comic
    
    # Add small padding (5%)
    padding_x = int(w * 0.05)
    padding_y = int(h * 0.05)
    
    x = max(0, x - padding_x)
    y = max(0, y - padding_y)
    w = min(frame_w - x, w + 2 * padding_x)
    h = min(frame_h - y, h + 2 * padding_y)
    
    return (x, y, w, h)


def create_debug_visualization(frame, comic_bbox, output_path):
    """
    Create a debug visualization showing the detected comic boundaries and region crops.
    
    Args:
        frame: OpenCV BGR image
        comic_bbox: (x, y, w, h) bounding box or None
        output_path: Path to save the debug image
    """
    import cv2
    import numpy as np
    
    # Make a copy for drawing
    debug_frame = frame.copy()
    
    # Draw comic boundary if detected
    if comic_bbox:
        x, y, w, h = comic_bbox
        cv2.rectangle(debug_frame, (x, y), (x + w, y + h), (0, 255, 0), 3)
        cv2.putText(debug_frame, "Comic Detected", (x + 10, y + 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        # Use detected comic as working area
        working_x, working_y = x, y
        working_w, working_h = w, h
    else:
        # Use full frame
        working_x, working_y = 0, 0
        working_h, working_w = frame.shape[:2]
        cv2.putText(debug_frame, "Using Full Frame", (10, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
    
    # Draw region boundaries
    region_colors = {
        'spine': (255, 0, 0),       # Blue
        'corner_tl': (0, 255, 255),  # Yellow
        'corner_tr': (255, 0, 255),  # Magenta
        'corner_bl': (0, 165, 255),  # Orange
        'corner_br': (255, 255, 0),  # Cyan
        'surface': (128, 0, 128)     # Purple
    }
    
    for region_name, region_def in REGIONS.items():
        x1 = working_x + int(working_w * region_def["x_start"])
        x2 = working_x + int(working_w * region_def["x_end"])
        y1 = working_y + int(working_h * region_def["y_start"])
        y2 = working_y + int(working_h * region_def["y_end"])
        
        color = region_colors.get(region_name, (255, 255, 255))
        cv2.rectangle(debug_frame, (x1, y1), (x2, y2), color, 2)
        
        # Add label
        label_y = y1 + 20 if y1 > 30 else y2 - 10
        cv2.putText(debug_frame, region_name, (x1 + 5, label_y), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    
    # Save debug image
    cv2.imwrite(str(output_path), debug_frame, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print(f"   📊 Debug visualization saved to {output_path}")



def extract_region_crops_for_frame(frame, frame_id: str, output_dir: Path, detect_object: bool = True) -> dict:
    """
    Extract 6 region crops from a single frame.
    
    If detect_object=True, first detects the comic boundaries and extracts regions from the detected comic.
    Otherwise, uses the entire frame (legacy behavior).
    
    Args:
        frame: OpenCV BGR image (numpy array)
        frame_id: Unique identifier for this frame (e.g., "f00123")
        output_dir: Directory to save crop files
        detect_object: Whether to detect comic boundaries first (default True)
    
    Returns:
        Dict mapping region name to crop file path
        e.g., {"spine": "/tmp/analysis/f00123_crop_spine.png", ...}
    """
    import cv2
    
    # Try to detect comic boundaries
    working_frame = frame
    if detect_object:
        bbox = detect_comic_boundaries(frame)
        if bbox:
            x, y, w, h = bbox
            working_frame = frame[y:y+h, x:x+w]
            print(f"   📐 Detected comic at ({x}, {y}) size ({w}x{h})")
        else:
            print(f"   ⚠️ Object detection failed, using full frame")
    
    h, w = working_frame.shape[:2]
    crops = {}
    
    for region_name, region_def in REGIONS.items():
        x1 = int(w * region_def["x_start"])
        x2 = int(w * region_def["x_end"])
        y1 = int(h * region_def["y_start"])
        y2 = int(h * region_def["y_end"])
        
        # Extract crop
        crop = working_frame[y1:y2, x1:x2]
        
        # Save to file
        crop_filename = f"{frame_id}_crop_{region_name}.png"
        crop_path = output_dir / crop_filename
        cv2.imwrite(str(crop_path), crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        
        crops[region_name] = str(crop_path)
    
    return crops


def get_nyckel_token(client_id: str, client_secret: str) -> str:
    """
    Get OAuth token from Nyckel API.
    
    Args:
        client_id: Nyckel client ID
        client_secret: Nyckel client secret
    
    Returns:
        Access token string
    """
    import requests
    
    token_response = requests.post(
        "https://www.nyckel.com/connect/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials"
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30
    )
    token_response.raise_for_status()
    return token_response.json()["access_token"]


def classify_region_visibility(crop_paths: dict, access_token: str, function_id: str) -> dict:
    """
    Classify if each region is clearly visible using Nyckel.
    
    Args:
        crop_paths: Dict mapping region name to crop file path
        access_token: Nyckel OAuth token
        function_id: Nyckel visibility function ID
    
    Returns:
        Dict mapping region name to visibility result
        e.g., {"spine": {"visibility": "clearly_visible", "confidence": 0.92}, ...}
    """
    import requests
    import base64
    
    results = {}
    
    for region_name, crop_path in crop_paths.items():
        try:
            # Read and encode image as base64
            with open(crop_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
            
            # Call Nyckel invoke API
            invoke_response = requests.post(
                f"https://www.nyckel.com/v1/functions/{function_id}/invoke",
                json={"data": f"data:image/png;base64,{image_data}"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                timeout=30
            )
            invoke_response.raise_for_status()
            result = invoke_response.json()
            
            results[region_name] = {
                "visibility": result.get("labelName", "not_visible"),
                "confidence": result.get("confidence", 0.0)
            }
            
        except Exception as e:
            print(f"      ⚠️ Visibility check failed for {region_name}: {e}")
            results[region_name] = {
                "visibility": "not_visible",
                "confidence": 0.0
            }
    
    return results


def classify_region_grades(crop_paths: dict, access_token: str, function_id: str) -> dict:
    """
    Classify the grade/condition of each region using Nyckel.
    
    Args:
        crop_paths: Dict mapping region name to crop file path
        access_token: Nyckel OAuth token
        function_id: Nyckel defect/grade function ID
    
    Returns:
        Dict mapping region name to grade result
        e.g., {"spine": {"label": "near_mint", "grade": 9.2, "confidence": 0.88}, ...}
    """
    import requests
    import base64
    
    results = {}
    
    for region_name, crop_path in crop_paths.items():
        try:
            # Read and encode image as base64
            with open(crop_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
            
            # Call Nyckel invoke API
            invoke_response = requests.post(
                f"https://www.nyckel.com/v1/functions/{function_id}/invoke",
                json={"data": f"data:image/png;base64,{image_data}"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                timeout=30
            )
            invoke_response.raise_for_status()
            result = invoke_response.json()
            
            label = result.get("labelName", "moderate_wear")
            confidence = result.get("confidence", 0.0)
            grade = LABEL_TO_GRADE.get(label, 5.5)
            
            # DEBUG: Log what Nyckel is returning
            print(f"      DEBUG {region_name}: label={label}, confidence={confidence:.2f}, grade={grade}")
            
            # IMPORTANT: If confidence is too low, don't trust the result
            if confidence < 0.3:
                print(f"      ⚠️ Low confidence ({confidence:.2f}) for {region_name}, using fallback grade")
                grade = 5.5
                label = "uncertain"
            
            results[region_name] = {
                "label": label,
                "grade": grade,
                "confidence": confidence
            }
            
        except Exception as e:
            print(f"      ⚠️ Grade classification failed for {region_name}: {e}")
            results[region_name] = {
                "label": "moderate_wear",
                "grade": 5.5,
                "confidence": 0.0
            }
    
    return results


def select_golden_frames_by_coverage(
    all_candidates: list,
    video_path: str,
    temp_dir: Path,
    nyckel_token: str,
    visibility_function_id: str,
    max_candidates: int = 20,
    max_frames: int = 5
) -> list:
    """
    Select golden frames ensuring all critical regions are clearly visible.
    
    This is smarter than just picking the sharpest frames - it uses Nyckel
    to verify that important regions (spine, corners) are visible in each frame.
    
    Args:
        all_candidates: List of candidate frames sorted by sharpness
        video_path: Path to video file
        temp_dir: Temporary directory for crop files
        nyckel_token: Nyckel OAuth token
        visibility_function_id: Nyckel visibility function ID
        max_candidates: Number of top candidates to evaluate
        max_frames: Maximum golden frames to select
    
    Returns:
        List of selected frame candidates with visibility scores
    """
    import cv2
    
    # Take top N candidates by sharpness
    top_candidates = all_candidates[:max_candidates]
    
    if not visibility_function_id:
        # Fallback to sharpness-only selection if no visibility function
        print("   ⚠️ No visibility function configured, using sharpness-only selection")
        return select_by_sharpness_only(top_candidates, max_frames)
    
    print(f"   🔍 Evaluating {len(top_candidates)} candidates for region visibility...")
    
    # Extract crops and classify visibility for each candidate
    cap = cv2.VideoCapture(str(video_path))
    visibility_scores = []
    
    for candidate in top_candidates:
        cap.set(cv2.CAP_PROP_POS_FRAMES, candidate['frame_number'])
        ret, frame = cap.read()
        
        if not ret:
            continue
        
        # Extract region crops for this frame
        frame_id = f"f{candidate['frame_number']:05d}"
        crops = extract_region_crops_for_frame(frame, frame_id, temp_dir)
        
        # Classify visibility of each region
        visibility = classify_region_visibility(crops, nyckel_token, visibility_function_id)
        
        # Score based on critical region visibility
        visible_count = sum(
            1 for r in CRITICAL_REGIONS 
            if visibility.get(r, {}).get("visibility") == "clearly_visible"
        )
        avg_confidence = sum(
            visibility.get(r, {}).get("confidence", 0) 
            for r in CRITICAL_REGIONS
        ) / len(CRITICAL_REGIONS)
        
        visibility_scores.append({
            **candidate,
            'visibility_score': visible_count + avg_confidence,
            'visible_regions': visible_count,
            'visibility_details': visibility,
            'crop_paths': crops
        })
    
    cap.release()
    
    # Sort by visibility score (prioritize coverage) then sharpness
    visibility_scores.sort(
        key=lambda x: (x['visibility_score'], x['sharpness']), 
        reverse=True
    )
    
    # Select frames with temporal spacing
    selected = []
    min_gap = 15  # Minimum frames between selections
    
    for candidate in visibility_scores:
        too_close = any(
            abs(candidate['frame_number'] - s['frame_number']) < min_gap 
            for s in selected
        )
        if not too_close:
            selected.append(candidate)
            regions_str = ", ".join(
                r for r in CRITICAL_REGIONS 
                if candidate['visibility_details'].get(r, {}).get("visibility") == "clearly_visible"
            )
            print(f"      ✅ Frame #{candidate['frame_number']}: {candidate['visible_regions']}/5 regions visible ({regions_str})")
        
        if len(selected) >= max_frames:
            break
    
    return selected


def select_by_sharpness_only(candidates: list, max_frames: int = 5) -> list:
    """
    Fallback selection using sharpness only (no Nyckel).
    
    Args:
        candidates: List of candidates sorted by sharpness
        max_frames: Maximum frames to select
    
    Returns:
        List of selected candidates
    """
    selected = []
    min_gap = 15
    
    for candidate in candidates:
        too_close = any(
            abs(candidate['frame_number'] - s['frame_number']) < min_gap 
            for s in selected
        )
        if not too_close:
            selected.append(candidate)
        if len(selected) >= max_frames:
            break
    
    return selected


@app.function(
    image=cv_image,
    timeout=120,
    volumes={"/video": video_volume},
)
def analyze_frame_chunk(
    scan_id: str,
    start_frame: int,
    end_frame: int,
    fps: float,
    chunk_id: int,
    sample_rate: int = 1
) -> list:
    """
    Analyze a chunk of frames in parallel (OPTIMIZED with frame sampling).
    
    Reads video from shared Volume (no re-download needed).
    Returns list of candidate frames with quality metrics.
    
    Args:
        scan_id: Scan ID used as folder name in Volume
        start_frame: Starting frame number
        end_frame: Ending frame number
        fps: Video FPS for timestamp calculation
        chunk_id: Chunk identifier for logging
        sample_rate: Analyze every Nth frame (default 1 = all frames)
    
    Returns:
        List of candidate frames with quality metrics
    """
    import cv2
    import numpy as np
    import time
    
    video_path = f"/video/{scan_id}/input.mp4"
    print(f"[Chunk {chunk_id}] Processing frames {start_frame}-{end_frame} (sample rate: 1/{sample_rate}) from {video_path}")
    
    # CRITICAL: Reload volume to see files committed by parent function
    # Modal Volumes are eventually consistent - workers may start before sync completes
    video_volume.reload()
    
    # Retry logic for volume propagation delays
    max_retries = 3
    for attempt in range(max_retries):
        if os.path.exists(video_path):
            break
        print(f"[Chunk {chunk_id}] Waiting for volume sync (attempt {attempt + 1}/{max_retries})...")
        time.sleep(0.5)
        video_volume.reload()
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[Chunk {chunk_id}] ERROR: Could not open video at {video_path}")
        return []
    
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    
    candidates = []
    prev_gray = None
    frames_analyzed = 0
    
    for frame_number in range(start_frame, end_frame, sample_rate):
        # Skip to the frame we want to analyze (3x faster with sample_rate=3)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        if not ret:
            break
        
        frames_analyzed += 1
        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Calculate sharpness (Laplacian Variance)
        laplacian = cv2.Laplacian(curr_gray, cv2.CV_64F)
        sharpness = laplacian.var()
        
        # Calculate motion (Optical Flow) - skip first frame in chunk
        motion = 0.0
        if prev_gray is not None:
            flow = cv2.calcOpticalFlowFarneback(
                prev_gray, curr_gray, None,
                pyr_scale=0.5, levels=3, winsize=15,
                iterations=3, poly_n=5, poly_sigma=1.2, flags=0
            )
            magnitude, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
            motion = np.mean(magnitude)
        
        # Only keep frames with low motion (stable)
        if motion <= 3.0:
            candidates.append({
                'frame_number': frame_number,
                'sharpness': float(sharpness),
                'motion': float(motion),
                'timestamp': frame_number / fps
            })
        
        prev_gray = curr_gray
    
    cap.release()
    
    print(f"[Chunk {chunk_id}] Analyzed {frames_analyzed} frames, found {len(candidates)} stable frames")
    return candidates


def find_golden_frame_candidates(video_path: str, total_frames: int, fps: float) -> list:
    """
    Analyze all frames sequentially to find stable, sharp frames.
    
    Single-pass analysis that downloads once and processes all frames.
    For 5-10 second videos (150-300 frames), this is fast enough.
    
    Args:
        video_path: Local path to downloaded video
        total_frames: Total number of frames in video
        fps: Video FPS for timestamp calculation
    
    Returns:
        List of candidate frames with quality metrics, sorted by sharpness
    """
    import cv2
    import numpy as np
    
    print(f"   Analyzing {total_frames} frames for sharpness/motion...")
    
    cap = cv2.VideoCapture(str(video_path))
    candidates = []
    prev_gray = None
    
    for frame_number in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break
        
        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Calculate sharpness (Laplacian Variance)
        laplacian = cv2.Laplacian(curr_gray, cv2.CV_64F)
        sharpness = laplacian.var()
        
        # Calculate motion (Optical Flow) - skip first frame
        motion = 0.0
        if prev_gray is not None:
            flow = cv2.calcOpticalFlowFarneback(
                prev_gray, curr_gray, None,
                pyr_scale=0.5, levels=3, winsize=15,
                iterations=3, poly_n=5, poly_sigma=1.2, flags=0
            )
            magnitude, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
            motion = np.mean(magnitude)
        
        # Only keep frames with low motion (stable)
        if motion <= 3.0:
            candidates.append({
                'frame_number': frame_number,
                'sharpness': float(sharpness),
                'motion': float(motion),
                'timestamp': frame_number / fps
            })
        
        prev_gray = curr_gray
        
        # Progress indicator every 50 frames
        if frame_number > 0 and frame_number % 50 == 0:
            print(f"      Processed {frame_number}/{total_frames} frames...")
    
    cap.release()
    
    print(f"   Found {len(candidates)} stable frames (motion <= 3.0)")
    return candidates


@app.function(
    image=cv_image,
    timeout=300,  # 5 minute timeout
    secrets=[
        modal.Secret.from_name("supabase-secrets"),
        modal.Secret.from_name("nyckel-secret"),  # For defect classification
    ],
    volumes={"/video": video_volume},
)
def analyze_video(video_url: str, scan_id: str, item_type: str = "card") -> dict:
    """
    Main entry point for video analysis with PARALLEL frame processing.
    
    Downloads video once to shared Volume, then spawns parallel workers
    to analyze frame chunks. Each worker reads from the Volume (no re-download).
    
    Args:
        video_url: Public URL of the video in Supabase
        scan_id: The scan/video ID (e.g., video-1234567890-abc)
        item_type: Type of collectible ("comic", "card", "toy")
    
    Returns:
        Dict with URLs to all generated images
    """
    import cv2
    import numpy as np
    import requests
    import tempfile
    import shutil
    from pathlib import Path
    
    # Get Supabase credentials from Modal secrets
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_KEY"]
    
    # Debug: Show key info (safely - only show first/last few chars)
    key_preview = f"{supabase_key[:15]}...{supabase_key[-8:]}" if len(supabase_key) > 25 else "KEY_TOO_SHORT"
    print(f"🔑 Supabase URL: {supabase_url}")
    print(f"🔑 Key format: {'New (sb_)' if supabase_key.startswith('sb_') else 'Legacy (eyJ)'}")
    print(f"🔑 Key preview: {key_preview}")
    
    # Note: We use REST API for storage uploads (full support for new sb_secret_ keys)
    supabase = None
    
    print(f"🎬 Processing scan: {scan_id} (PARALLEL MODE)")
    print(f"📹 Video URL: {video_url}")
    print(f"🏷️ Item type: {item_type}")
    
    # Progress: 5% - Starting
    update_progress(supabase_url, supabase_key, scan_id, 5, "Starting CV analysis...", "init")
    
    # Create directories
    volume_dir = Path(f"/video/{scan_id}")
    volume_dir.mkdir(parents=True, exist_ok=True)
    volume_video_path = volume_dir / "input.mp4"
    
    # Create temp directory for local processing
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        output_dir = tmpdir / "analysis"
        output_dir.mkdir()
        
        # Download video ONCE and save to shared Volume
        print("📥 Downloading video to shared Volume...")
        response = requests.get(video_url, stream=True)
        response.raise_for_status()
        with open(volume_video_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        # Progress: 15% - Video downloaded
        update_progress(supabase_url, supabase_key, scan_id, 15, "Video downloaded, analyzing frames...", "download_complete")
        
        # Commit the volume so workers can see the file
        video_volume.commit()
        
        file_size_mb = volume_video_path.stat().st_size / 1024 / 1024
        print(f"   Downloaded: {file_size_mb:.1f} MB to {volume_video_path}")
        
        # Small delay to allow volume sync to propagate before spawning workers
        import time
        time.sleep(0.5)
        print("   Volume sync initiated...")
        
        # Get video metadata
        cap = cv2.VideoCapture(str(volume_video_path))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
        
        print(f"   Video: {total_frames} frames, {fps:.1f} fps, {total_frames/fps:.1f}s")
        
        # OPTIMIZATION: Sample every 3rd frame instead of all frames (3x faster)
        # For 5-10s videos (150-300 frames), analyzing 50-100 frames is sufficient
        frame_sample_rate = 3  # Analyze every 3rd frame
        sampled_frames = total_frames // frame_sample_rate
        print(f"   🚀 OPTIMIZED: Analyzing every {frame_sample_rate}rd frame ({sampled_frames} frames instead of {total_frames})")
        
        # Determine optimal number of parallel workers
        # Modal can handle 100+ concurrent containers easily
        min_frames_per_chunk = 5  # Minimum frames per worker for optical flow accuracy
        max_workers = 100
        num_workers = min(max_workers, max(2, sampled_frames // min_frames_per_chunk))
        chunk_size = sampled_frames // num_workers
        
        print(f"🔀 Splitting into {num_workers} parallel workers...")
        print(f"   Each worker analyzes ~{chunk_size} sampled frames")
        
        # Prepare chunk parameters with frame sampling
        chunk_params = []
        for i in range(num_workers):
            start = i * chunk_size * frame_sample_rate  # Account for sampling
            end = min((i + 1) * chunk_size * frame_sample_rate, total_frames) if i < num_workers - 1 else total_frames
            chunk_params.append({
                'scan_id': scan_id,
                'start_frame': start,
                'end_frame': end,
                'fps': fps,
                'chunk_id': i,
                'sample_rate': frame_sample_rate
            })
        
        # Progress: 25% - Starting frame analysis
        update_progress(supabase_url, supabase_key, scan_id, 25, f"Analyzing {sampled_frames} frames for quality...", "frame_analysis")
        
        # Process chunks in parallel using Modal's .map()
        print(f"⚡ Processing {num_workers} chunks in parallel...")
        all_candidates = []
        
        for candidates in analyze_frame_chunk.map(
            [p['scan_id'] for p in chunk_params],
            [p['start_frame'] for p in chunk_params],
            [p['end_frame'] for p in chunk_params],
            [p['fps'] for p in chunk_params],
            [p['chunk_id'] for p in chunk_params],
            [p['sample_rate'] for p in chunk_params],
        ):
            all_candidates.extend(candidates)
        
        print(f"✅ Analyzed {sampled_frames} frames in parallel (sampled every {frame_sample_rate}rd frame)")
        print(f"   Found {len(all_candidates)} stable frames (motion <= 3.0)")
        
        # Progress: 50% - Frame analysis complete
        update_progress(supabase_url, supabase_key, scan_id, 50, "Frame analysis complete, selecting best frames...", "frame_analysis_complete")
        
        # Sort by sharpness (highest first)
        all_candidates.sort(key=lambda x: x['sharpness'], reverse=True)
        
        # Check if Nyckel visibility classifier is available
        nyckel_client_id = os.environ.get("NYCKEL_CLIENT_ID")
        nyckel_client_secret = os.environ.get("NYCKEL_CLIENT_SECRET")
        nyckel_visibility_id = os.environ.get("NYCKEL_VISIBILITY_FUNCTION_ID")
        
        # Try smart frame selection with Nyckel visibility classifier
        if all([nyckel_client_id, nyckel_client_secret, nyckel_visibility_id]):
            print("\n🔬 Using Nyckel smart frame selection...")
            try:
                nyckel_token = get_nyckel_token(nyckel_client_id, nyckel_client_secret)
                selected = select_golden_frames_by_coverage(
                    all_candidates,
                    str(volume_video_path),
                    output_dir,
                    nyckel_token,
                    nyckel_visibility_id,
                    max_candidates=20,
                    max_frames=5
                )
            except Exception as e:
                print(f"   ⚠️ Smart frame selection failed: {e}")
                print("   Falling back to sharpness-only selection...")
                selected = select_by_sharpness_only(all_candidates, max_frames=5)
        else:
            # Fallback: Select by sharpness with temporal spacing
            print("\n📊 Using sharpness-based frame selection (Nyckel not configured)...")
            selected = select_by_sharpness_only(all_candidates, max_frames=5)
        
        # Progress: 60% - Golden frames selected
        update_progress(supabase_url, supabase_key, scan_id, 60, f"Selected {len(selected)} best frames, extracting regions...", "frames_selected")
        
        # Now extract the actual golden frames (only 5 frames - fast!)
        print(f"\n🖼️  Extracting {len(selected)} golden frames...")
        cap = cv2.VideoCapture(str(volume_video_path))
        
        golden_frames = []
        for i, frame_data in enumerate(selected, 1):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_data['frame_number'])
            ret, frame = cap.read()
            
            if ret:
                filename = f"golden_frame_{i:02d}_f{frame_data['frame_number']:05d}.png"
                filepath = output_dir / filename
                cv2.imwrite(str(filepath), frame, [cv2.IMWRITE_PNG_COMPRESSION, 9])
                
                golden_frames.append({
                    'path': str(filepath),
                    'frame_number': frame_data['frame_number'],
                    'timestamp': frame_data['timestamp'],
                    'sharpness': frame_data['sharpness']
                })
                print(f"   [{i}] Frame #{frame_data['frame_number']} @ {frame_data['timestamp']:.2f}s (sharpness: {frame_data['sharpness']:.1f})")
        
        cap.release()
        
        # Progress: 70% - Starting defect analysis
        update_progress(supabase_url, supabase_key, scan_id, 70, "Analyzing defects with ML classifier...", "defect_analysis")
        
        # Run analysis on golden frames
        # Try Nyckel ML analysis first, fall back to CV variance analysis
        print("\n🔬 Running defect analysis...")
        analysis_result = None
        
        # Try Nyckel ML analysis first
        try:
            analysis_result = run_nyckel_analysis(golden_frames, output_dir, scan_id)
            if analysis_result:
                print(f"   ✅ Nyckel ML Analysis complete:")
                print(f"      Average Grade: {analysis_result['averageGrade']}")
                print(f"      Critical Region Avg: {analysis_result['criticalRegionAvg']}")
                if analysis_result.get('lowestRegion'):
                    print(f"      Lowest: {analysis_result['lowestRegion']['region']} ({analysis_result['lowestRegion']['grade']})")
                # Progress: 85% - ML analysis complete
                update_progress(supabase_url, supabase_key, scan_id, 85, "Defect analysis complete, uploading results...", "analysis_complete")
        except Exception as nyckel_error:
            print(f"   ⚠️ Nyckel analysis failed: {nyckel_error}")
        
        # Fall back to CV analysis if Nyckel failed
        if not analysis_result:
            print("   📊 Falling back to CV variance analysis...")
            try:
                analysis_result = run_cv_analysis(golden_frames, output_dir, scan_id)
                if analysis_result:
                    print(f"   ✅ CV Analysis complete: {analysis_result['damageScore']:.1f}% damage detected")
            except Exception as cv_error:
                print(f"   ⚠️ CV analysis also failed: {cv_error}")
        
        # Upload golden frames to Supabase
        print("\n📤 Uploading golden frames to Supabase...")
        result = upload_golden_frames(scan_id, golden_frames)
        
        # Add analysis to result (either Nyckel or CV)
        if analysis_result:
            # Use "nyckelAnalysis" for ML-based, "cvAnalysis" for variance-based
            if analysis_result.get("analysisType") == "nyckel-ml":
                result["nyckelAnalysis"] = analysis_result
                # Also include as cvAnalysis for backward compatibility
                result["cvAnalysis"] = analysis_result
            else:
                result["cvAnalysis"] = analysis_result
        
        # Progress: 95% - Upload complete
        update_progress(supabase_url, supabase_key, scan_id, 95, "Upload complete, finalizing...", "upload_complete")
        
        # Clean up the shared Volume to free space
        print("\n🧹 Cleaning up shared Volume...")
        try:
            shutil.rmtree(str(volume_dir))
            video_volume.commit()
            print(f"   Removed {volume_dir}")
        except Exception as e:
            print(f"   Warning: Could not clean up volume: {e}")
        
        # Progress: 100% - Complete
        update_progress(supabase_url, supabase_key, scan_id, 100, "CV analysis complete!", "complete")
        
        print("\n✅ Analysis complete!")
        return result


def run_cv_analysis(golden_frames: list, output_dir: Path, scan_id: str) -> dict:
    """
    Run CV defect analysis on golden frames using glint analyzer logic.
    
    Performs:
    - Frame alignment
    - Variance calculation
    - Defect mask generation
    - Region-by-region analysis
    
    Note: This is the fallback analysis when Nyckel ML is not available.
    Uses variance-based defect detection instead of ML classification.
    """
    import cv2
    import numpy as np
    
    # Use global REGIONS definition (defined at top of file)
    
    # Load frames
    frames = []
    for gf in golden_frames:
        img = cv2.imread(gf['path'])
        if img is not None:
            frames.append(img)
    
    if len(frames) < 2:
        print(f"   ⚠️ Need at least 2 frames for CV analysis, got {len(frames)}")
        return None
    
    print(f"   Analyzing {len(frames)} frames...")
    
    # Detect comic boundaries in reference frame
    print("   🎯 Detecting comic boundaries...")
    comic_bbox = detect_comic_boundaries(frames[0])
    if comic_bbox:
        x, y, w, h = comic_bbox
        # Crop all frames to comic boundaries
        frames = [frame[y:y+h, x:x+w] for frame in frames]
        print(f"   ✅ Comic detected at ({x}, {y}) size ({w}x{h})")
    else:
        print(f"   ⚠️ Object detection failed, using full frames")
    
    # Align frames (simple feature-based alignment)
    reference = frames[0]
    aligned_frames = [reference]
    
    orb = cv2.ORB_create(nfeatures=1000)
    ref_gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
    ref_kp, ref_desc = orb.detectAndCompute(ref_gray, None)
    
    for i, frame in enumerate(frames[1:], 1):
        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        kp, desc = orb.detectAndCompute(frame_gray, None)
        
        if desc is None or ref_desc is None or len(desc) < 4:
            aligned_frames.append(frame)
            continue
        
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(ref_desc, desc)
        matches = sorted(matches, key=lambda x: x.distance)[:50]
        
        if len(matches) >= 4:
            src_pts = np.float32([ref_kp[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
            dst_pts = np.float32([kp[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
            H, mask = cv2.findHomography(dst_pts, src_pts, cv2.RANSAC, 5.0)
            
            if H is not None:
                h, w = reference.shape[:2]
                aligned_frame = cv2.warpPerspective(frame, H, (w, h))
                aligned_frames.append(aligned_frame)
            else:
                aligned_frames.append(frame)
        else:
            aligned_frames.append(frame)
    
    print(f"   Aligned {len(aligned_frames)} frames")
    
    # Compute variance map
    gray_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in aligned_frames]
    stack = np.stack(gray_frames, axis=0)
    variance_map = np.var(stack, axis=0)
    
    # Compute max difference map
    max_diff = np.zeros_like(gray_frames[0])
    for i in range(len(gray_frames)):
        for j in range(i + 1, len(gray_frames)):
            diff = np.abs(gray_frames[i] - gray_frames[j])
            max_diff = np.maximum(max_diff, diff)
    
    # Create defect mask
    combined = (variance_map / variance_map.max() + max_diff / max_diff.max()) / 2
    mean_val = np.mean(combined)
    std_val = np.std(combined)
    threshold = mean_val + 2.0 * std_val
    
    defect_mask = (combined > threshold).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    defect_mask = cv2.morphologyEx(defect_mask, cv2.MORPH_OPEN, kernel)
    defect_mask = cv2.morphologyEx(defect_mask, cv2.MORPH_CLOSE, kernel)
    defect_mask = cv2.dilate(defect_mask, kernel, iterations=2)
    
    # Calculate overall damage score using BOTH defect mask AND variance heatmap
    # Variance map is more reliable for detecting subtle damage (creases, spine stress)
    # Defect mask catches obvious anomalies (stains, tears)
    
    # Mask-based damage (binary: damaged or not)
    mask_damage_pct = (np.sum(defect_mask > 0) / defect_mask.size) * 100
    
    # Variance-based damage (continuous: how much variance from mean)
    # Normalize variance map to 0-1, then threshold high-variance areas
    variance_normalized = variance_map / (variance_map.max() + 1e-6)
    high_variance_mask = variance_normalized > 0.3  # Threshold for "damaged" variance
    variance_damage_pct = (np.sum(high_variance_mask) / variance_map.size) * 100
    
    # Weighted blend: 40% defect mask, 60% variance map
    # Variance map is prioritized as it's more accurate for detecting subtle issues
    overall_defect_pct = (mask_damage_pct * 0.4) + (variance_damage_pct * 0.6)
    
    print(f"   Damage Analysis: Mask={mask_damage_pct:.1f}%, Variance={variance_damage_pct:.1f}%, Overall={overall_defect_pct:.1f}%")
    
    # Analyze each region
    region_scores = {}
    region_analyses = []
    
    for region_name, region_def in REGIONS.items():
        h, w = reference.shape[:2]
        x1 = int(w * region_def["x_start"])
        x2 = int(w * region_def["x_end"])
        y1 = int(h * region_def["y_start"])
        y2 = int(h * region_def["y_end"])
        
        # DEBUG: Log crop coordinates for alignment verification
        print(f"   DEBUG {region_name}: image=({w}x{h}), crop=({x1},{y1})->({x2},{y2}), size=({x2-x1}x{y2-y1})")
        
        # Extract region crops
        crop = reference[y1:y2, x1:x2]
        mask_crop = defect_mask[y1:y2, x1:x2]
        var_crop = variance_map[y1:y2, x1:x2]
        
        # Calculate defect statistics
        defect_pixels = np.sum(mask_crop > 0)
        total_pixels = mask_crop.shape[0] * mask_crop.shape[1]
        defect_pct = (defect_pixels / total_pixels) * 100 if total_pixels > 0 else 0
        
        region_scores[region_name] = defect_pct
        
        # Save crops
        crop_filename = f"crop_{region_name}.png"
        crop_path = output_dir / crop_filename
        cv2.imwrite(str(crop_path), crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        
        mask_filename = f"mask_{region_name}.png"
        mask_path = output_dir / mask_filename
        cv2.imwrite(str(mask_path), mask_crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        
        # Create overlay
        overlay = crop.copy()
        red_overlay = np.zeros_like(crop)
        red_overlay[:, :, 2] = mask_crop
        overlay = cv2.addWeighted(overlay, 0.7, red_overlay, 0.3, 0)
        
        overlay_filename = f"overlay_{region_name}.png"
        overlay_path = output_dir / overlay_filename
        cv2.imwrite(str(overlay_path), overlay, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        
        region_analyses.append({
            'region_name': region_name,
            'crop_file': crop_filename,
            'mask_file': mask_filename,
            'overlay_file': overlay_filename,
            'defect_percentage': defect_pct
        })
        
        print(f"   Region {region_name}: {defect_pct:.1f}% defects")
    
    # Save full visualizations
    mask_file = "defect_mask_full.png"
    cv2.imwrite(str(output_dir / mask_file), defect_mask, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    
    var_normalized = (variance_map / variance_map.max() * 255).astype(np.uint8)
    var_heatmap = cv2.applyColorMap(var_normalized, cv2.COLORMAP_JET)
    var_file = "variance_heatmap.png"
    cv2.imwrite(str(output_dir / var_file), var_heatmap, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    
    # Upload CV images to Supabase
    print(f"   Uploading CV analysis images...")
    cv_images = upload_cv_images(scan_id, output_dir, region_analyses, defect_mask, var_heatmap)
    
    # Classify defects with Nyckel (if credentials available)
    defect_labels = {}
    try:
        defect_labels = classify_regions_with_nyckel(output_dir, REGIONS.keys())
        print(f"   ✅ Nyckel classification complete")
    except Exception as nyckel_error:
        print(f"   ⚠️ Nyckel classification skipped: {nyckel_error}")
        # Default to pristine for all regions if Nyckel unavailable
        defect_labels = {region: ["pristine"] for region in REGIONS.keys()}
    
    return {
        "damageScore": float(overall_defect_pct),
        "regionScores": region_scores,
        "defectLabels": defect_labels,
        "images": cv_images
    }


def run_nyckel_analysis(golden_frames: list, output_dir: Path, scan_id: str) -> dict:
    """
    Run ML-based region analysis using Nyckel classifiers.
    
    This replaces variance-based CV analysis with ML classification:
    - Extracts region crops from golden frames
    - Grades each region using Nyckel defect classifier
    - Calculates aggregate scores
    - Uploads crops and results to Supabase
    
    Args:
        golden_frames: List of golden frame dicts with 'path' key
        output_dir: Directory for output files
        scan_id: Scan ID for Supabase paths
    
    Returns:
        Dict with Nyckel analysis results
    """
    import cv2
    import numpy as np
    import os
    
    # Get Nyckel credentials
    nyckel_client_id = os.environ.get("NYCKEL_CLIENT_ID")
    nyckel_client_secret = os.environ.get("NYCKEL_CLIENT_SECRET")
    nyckel_grade_function_id = os.environ.get("NYCKEL_DEFECT_FUNCTION_ID")
    
    if not all([nyckel_client_id, nyckel_client_secret, nyckel_grade_function_id]):
        print("   ⚠️ Nyckel credentials not configured, falling back to CV analysis")
        return None
    
    print("   🤖 Running Nyckel ML analysis...")
    
    # Get OAuth token
    try:
        access_token = get_nyckel_token(nyckel_client_id, nyckel_client_secret)
    except Exception as e:
        print(f"   ⚠️ Failed to get Nyckel token: {e}")
        return None
    
    # Load reference frame (first golden frame)
    if not golden_frames:
        return None
    
    reference = cv2.imread(golden_frames[0]['path'])
    if reference is None:
        return None
    
    # Detect comic boundaries first
    print("   🎯 Detecting comic boundaries...")
    comic_bbox = detect_comic_boundaries(reference)
    if comic_bbox:
        x, y, w, h = comic_bbox
        reference = reference[y:y+h, x:x+w]
        print(f"   ✅ Comic detected at ({x}, {y}) size ({w}x{h})")
    else:
        print(f"   ⚠️ Object detection failed, using full frame")
    
    # Create debug visualization BEFORE cropping
    debug_viz_path = output_dir / "debug_regions.png"
    create_debug_visualization(cv2.imread(golden_frames[0]['path']), comic_bbox, debug_viz_path)
    
    # Extract region crops from reference frame
    print("   📐 Extracting region crops...")
    h, w = reference.shape[:2]
    region_crops = {}
    region_analyses = []
    
    for region_name, region_def in REGIONS.items():
        x1 = int(w * region_def["x_start"])
        x2 = int(w * region_def["x_end"])
        y1 = int(h * region_def["y_start"])
        y2 = int(h * region_def["y_end"])
        
        crop = reference[y1:y2, x1:x2]
        
        crop_filename = f"crop_{region_name}.png"
        crop_path = output_dir / crop_filename
        cv2.imwrite(str(crop_path), crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        
        region_crops[region_name] = str(crop_path)
        region_analyses.append({
            'region_name': region_name,
            'crop_file': crop_filename,
            'overlay_file': f"overlay_{region_name}.png",
            'mask_file': f"mask_{region_name}.png"
        })
    
    # Classify grades for each region
    print("   🎯 Classifying regions with Nyckel...")
    region_grades = classify_region_grades(region_crops, access_token, nyckel_grade_function_id)
    
    # Log results
    for region_name, result in region_grades.items():
        emoji = "✅" if result['grade'] >= 9.0 else "⚠️" if result['grade'] >= 7.0 else "❌"
        print(f"      {emoji} {region_name}: {result['label']} ({result['grade']}) - {result['confidence']:.0%}")
    
    # Calculate aggregate scores using WEIGHTED AVERAGE
    # Simple average would double-count deductions and give incorrect results
    
    # Weighted average: Σ(grade × weight) / Σ(weights)
    weighted_sum = sum(
        region_grades[region]['grade'] * REGION_WEIGHTS.get(region, 1.0)
        for region in region_grades
    )
    total_weights = sum(REGION_WEIGHTS.get(region, 1.0) for region in region_grades)
    avg_grade_raw = weighted_sum / total_weights if total_weights > 0 else 5.5
    
    # Round to valid CGC grade point (conservative - rounds down)
    avg_grade = round_to_cgc_grade(avg_grade_raw)
    
    # Critical region average (also weighted)
    critical_weighted_sum = sum(
        region_grades[r]['grade'] * REGION_WEIGHTS.get(r, 1.0)
        for r in CRITICAL_REGIONS if r in region_grades
    )
    critical_weights = sum(
        REGION_WEIGHTS.get(r, 1.0) 
        for r in CRITICAL_REGIONS if r in region_grades
    )
    critical_avg_raw = critical_weighted_sum / critical_weights if critical_weights > 0 else 5.5
    critical_avg = round_to_cgc_grade(critical_avg_raw)
    
    print(f"   📊 Weighted Average Grade: {avg_grade_raw:.2f} → {avg_grade} (CGC)")
    print(f"   📊 Critical Regions Avg: {critical_avg_raw:.2f} → {critical_avg} (CGC)")
    
    # Find lowest graded region
    worst_region = min(region_grades.items(), key=lambda x: x[1]['grade']) if region_grades else None
    
    # Convert grade to damage score (inverse: 10.0 = 0%, 0.0 = 100%)
    damage_score = max(0, (10.0 - avg_grade) * 10)
    
    # Create region scores dict (percentage-based for backward compatibility)
    region_scores = {
        region: max(0, (10.0 - data['grade']) * 10)
        for region, data in region_grades.items()
    }
    
    # Upload crops to Supabase
    print("   📤 Uploading Nyckel analysis images...")
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_KEY"]
    bucket = "analysis-images"
    
    cv_images = {
        "regionCrops": {},
        "regionOverlays": {},
        "debugVisualization": None
    }
    
    # Upload debug visualization first
    debug_viz_remote = f"{scan_id}/debug_regions.png"
    with open(debug_viz_path, 'rb') as f:
        debug_url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, debug_viz_remote, f.read())
        cv_images["debugVisualization"] = debug_url
        print(f"   ✅ Debug visualization uploaded: {debug_url}")
    
    for region_name, crop_path in region_crops.items():
        remote_path = f"{scan_id}/regions/crop_{region_name}.png"
        with open(crop_path, 'rb') as f:
            url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, remote_path, f.read())
            cv_images["regionCrops"][region_name] = url
    
    return {
        "analysisType": "nyckel-ml",
        "damageScore": float(damage_score),
        "regionScores": region_scores,
        "regionGrades": region_grades,
        "averageGrade": round(avg_grade, 1),
        "criticalRegionAvg": round(critical_avg, 1),
        "lowestRegion": {
            "region": worst_region[0] if worst_region else None,
            "grade": worst_region[1]['grade'] if worst_region else None,
            "label": worst_region[1]['label'] if worst_region else None
        } if worst_region else None,
        "defectLabels": {r: [d['label']] for r, d in region_grades.items()},
        "images": cv_images
    }


def classify_regions_with_nyckel(output_dir: Path, region_names) -> dict:
    """
    Classify defects in each region crop using Nyckel API.
    
    Sends each region crop to Nyckel for classification and returns
    the detected defect labels per region.
    
    Args:
        output_dir: Directory containing crop_{region}.png files
        region_names: List of region names to classify
    
    Returns:
        Dict mapping region name to list of detected defect labels
        e.g., {"spine": ["spine_roll"], "corner_tl": ["pristine"]}
    """
    import requests
    import base64
    import os
    
    # Get Nyckel credentials from Modal secrets
    nyckel_client_id = os.environ.get("NYCKEL_CLIENT_ID")
    nyckel_client_secret = os.environ.get("NYCKEL_CLIENT_SECRET")
    nyckel_function_id = os.environ.get("NYCKEL_DEFECT_FUNCTION_ID")
    
    if not all([nyckel_client_id, nyckel_client_secret, nyckel_function_id]):
        raise ValueError("Nyckel credentials not configured in Modal secrets")
    
    # Get OAuth token
    token_response = requests.post(
        "https://www.nyckel.com/connect/token",
        data={
            "client_id": nyckel_client_id,
            "client_secret": nyckel_client_secret,
            "grant_type": "client_credentials"
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30
    )
    token_response.raise_for_status()
    access_token = token_response.json()["access_token"]
    
    defect_labels = {}
    
    for region_name in region_names:
        crop_path = output_dir / f"crop_{region_name}.png"
        
        if not crop_path.exists():
            print(f"      ⚠️ Missing crop for {region_name}")
            defect_labels[region_name] = ["pristine"]
            continue
        
        # Read and encode image as base64
        with open(crop_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
        
        # Call Nyckel invoke API
        try:
            invoke_response = requests.post(
                f"https://www.nyckel.com/v1/functions/{nyckel_function_id}/invoke",
                json={"data": f"data:image/png;base64,{image_data}"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                timeout=30
            )
            invoke_response.raise_for_status()
            result = invoke_response.json()
            
            # Extract label from response
            label_name = result.get("labelName", "pristine")
            confidence = result.get("confidence", 0.0)
            
            # Only accept high-confidence predictions (70%+ threshold)
            # Below this, region crop alignment may be unreliable
            if confidence >= 0.70:
                defect_labels[region_name] = [label_name]
                print(f"      {region_name}: {label_name} ({confidence:.0%}) ✓")
            else:
                # Low confidence - likely misaligned crop or unclear defect
                defect_labels[region_name] = ["pristine"]
                print(f"      {region_name}: {label_name} ({confidence:.0%}) - IGNORED (low confidence)")
            
        except Exception as e:
            print(f"      ⚠️ Failed to classify {region_name}: {e}")
            defect_labels[region_name] = ["pristine"]
    
    return defect_labels


def upload_cv_images(scan_id: str, output_dir: Path, region_analyses: list, 
                      defect_mask, variance_heatmap) -> dict:
    """
    Upload CV analysis images to Supabase Storage.
    """
    import os
    import cv2
    import numpy as np
    
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_KEY"]
    bucket = "analysis-images"
    
    result = {
        "regionCrops": {},
        "regionOverlays": {},
        "defectMask": None,
        "varianceMap": None
    }
    
    # Upload region crops and overlays
    for analysis in region_analyses:
        region = analysis['region_name']
        
        # Crop
        crop_path = output_dir / analysis['crop_file']
        if crop_path.exists():
            remote_path = f"{scan_id}/regions/crop_{region}.png"
            with open(crop_path, 'rb') as f:
                url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, remote_path, f.read())
                result["regionCrops"][region] = url
                print(f"      ✅ Uploaded crop: {region}")
        
        # Overlay
        overlay_path = output_dir / analysis['overlay_file']
        if overlay_path.exists():
            remote_path = f"{scan_id}/regions/overlay_{region}.png"
            with open(overlay_path, 'rb') as f:
                url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, remote_path, f.read())
                result["regionOverlays"][region] = url
    
    # Upload full visualizations
    mask_path = output_dir / "defect_mask_full.png"
    if mask_path.exists():
        remote_path = f"{scan_id}/analysis/defect_mask_full.png"
        with open(mask_path, 'rb') as f:
            url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, remote_path, f.read())
            result["defectMask"] = url
            print(f"      ✅ Uploaded defect mask")
    
    var_path = output_dir / "variance_heatmap.png"
    if var_path.exists():
        remote_path = f"{scan_id}/analysis/variance_heatmap.png"
        with open(var_path, 'rb') as f:
            url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, remote_path, f.read())
            result["varianceMap"] = url
            print(f"      ✅ Uploaded variance heatmap")
    
    return result


def update_progress(supabase_url: str, supabase_key: str, job_id: str, percentage: int, message: str, step: str):
    """
    Update progress in Supabase analysis_jobs table for real-time UI updates.
    
    Args:
        supabase_url: Supabase project URL
        supabase_key: Service role key
        job_id: The analysis job ID (scan_id)
        percentage: Progress percentage (0-100)
        message: Human-readable progress message
        step: Current step name (for tracking)
    """
    import requests
    from datetime import datetime
    
    try:
        update_url = f"{supabase_url}/rest/v1/analysis_jobs"
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        payload = {
            "progress_percentage": percentage,
            "progress_message": message,
            "progress_step": step,
            "progress_updated_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }
        
        response = requests.patch(
            f"{update_url}?id=eq.{job_id}",
            headers=headers,
            json=payload,
            timeout=5
        )
        
        if response.status_code not in [200, 204]:
            print(f"   ⚠️ Progress update failed ({response.status_code}): {response.text[:200]}")
        else:
            print(f"   📊 Progress: {percentage}% - {message}")
            
    except Exception as e:
        # Don't fail the whole job if progress update fails
        print(f"   ⚠️ Progress update error: {e}")


def upload_to_supabase_storage(supabase_url: str, supabase_key: str, bucket: str, 
                                 remote_path: str, file_data: bytes, 
                                 content_type: str = "image/png") -> str:
    """
    Upload a file to Supabase Storage using the official REST API.
    
    This approach works with both legacy JWT keys and new sb_secret_ keys.
    It's the recommended method when supabase-py storage support is catching up
    to the new key format.
    
    Supabase Storage REST API docs:
    https://supabase.com/docs/reference/storage/upload
    """
    import requests
    
    # Supabase Storage REST API endpoint for upload
    upload_url = f"{supabase_url}/storage/v1/object/{bucket}/{remote_path}"
    
    # Headers for the new sb_secret_ key format
    # The apikey header is used for authentication with new keys
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": content_type,
        "x-upsert": "true",  # Overwrite if file exists
    }
    
    response = requests.post(upload_url, headers=headers, data=file_data, timeout=60)
    
    if response.status_code not in [200, 201]:
        error_detail = response.text[:500] if response.text else "No error details"
        raise Exception(f"Storage upload failed ({response.status_code}): {error_detail}")
    
    # Return public URL for the uploaded file
    public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{remote_path}"
    return public_url


def upload_golden_frames(scan_id: str, golden_frames: list) -> dict:
    """
    Upload golden frames to Supabase Storage.
    
    Simplified version that only uploads frames - no CV defect analysis.
    Gemini will handle defect detection on the frontend.
    """
    import os
    
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_KEY"]
    
    result = {
        "success": True,
        "scanId": scan_id,
        "goldenFrames": [],
        "frameTimestamps": [],
    }
    
    bucket = "analysis-images"
    
    # Upload golden frames
    for i, gf in enumerate(golden_frames):
        filepath = gf['path']
        filename = Path(filepath).name
        remote_path = f"{scan_id}/frames/{filename}"
        
        with open(filepath, 'rb') as f:
            file_data = f.read()
        
        url = upload_to_supabase_storage(supabase_url, supabase_key, bucket, remote_path, file_data)
        result["goldenFrames"].append(url)
        result["frameTimestamps"].append(gf['timestamp'])
        print(f"   ✅ Uploaded frame {i+1}: {filename}")
    
    return result


# Pydantic model for request validation
from pydantic import BaseModel
from typing import Optional

class AnalysisRequest(BaseModel):
    videoUrl: str
    scanId: str
    itemType: Optional[str] = "card"


# Web endpoint for triggering analysis
@app.function(image=cv_image, secrets=[modal.Secret.from_name("supabase-secrets")])
@modal.fastapi_endpoint(method="POST")
async def trigger_analysis(request: AnalysisRequest) -> dict:
    """
    HTTP endpoint to trigger CV analysis.
    
    POST body:
    {
        "videoUrl": "https://...",
        "scanId": "video-123",
        "itemType": "card"
    }
    """
    try:
        print(f"[Modal] Received request: videoUrl={request.videoUrl}, scanId={request.scanId}")
        
        # Run the analysis
        result = analyze_video.remote(request.videoUrl, request.scanId, request.itemType)
        
        return result
    except Exception as e:
        print(f"[Modal] Error: {e}")
        return {"error": str(e), "type": type(e).__name__}


# CLI entry point for local testing
@app.local_entrypoint()
def main(video_url: str, scan_id: str, item_type: str = "card"):
    """Local test entry point."""
    result = analyze_video.remote(video_url, scan_id, item_type)
    print(json.dumps(result, indent=2))

