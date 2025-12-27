#!/usr/bin/env python3
"""
GradeVault CV Worker - Modal.com Serverless Function
=====================================================
Runs the Python CV pipeline (frame selection, glint analysis) 
as a serverless function triggered by the web app.

Deployment:
    modal deploy cv_worker.py

Test locally:
    modal run cv_worker.py --video-url "https://..." --scan-id "video-123"
"""

import modal
import os
import json
import tempfile
from pathlib import Path

# Create Modal app
app = modal.App("gradevault-cv-worker")

# Define the container image with all dependencies
cv_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "ffmpeg")
    .pip_install(
        "opencv-python-headless==4.9.0.80",
        "numpy==1.26.4",
        "scipy==1.13.1",
        "pillow==10.4.0",
        "supabase>=2.0.0",
        "requests>=2.31.0",
        "fastapi>=0.109.0",  # Required for web endpoints
    )
)


@app.function(
    image=cv_image,
    timeout=300,  # 5 minute timeout
    secrets=[modal.Secret.from_name("supabase-secrets")],
)
def analyze_video(video_url: str, scan_id: str, item_type: str = "card") -> dict:
    """
    Main entry point - downloads video, runs CV analysis, uploads results.
    
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
    from supabase import create_client
    
    # Get Supabase credentials from Modal secrets
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_KEY"]
    supabase = create_client(supabase_url, supabase_key)
    
    print(f"🎬 Processing scan: {scan_id}")
    print(f"📹 Video URL: {video_url}")
    print(f"🏷️ Item type: {item_type}")
    
    # Create temp directory for processing
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        video_path = tmpdir / "input.mp4"
        output_dir = tmpdir / "analysis"
        output_dir.mkdir()
        
        # Download video
        print("📥 Downloading video...")
        response = requests.get(video_url, stream=True)
        response.raise_for_status()
        with open(video_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        file_size_mb = video_path.stat().st_size / 1024 / 1024
        print(f"   Downloaded: {file_size_mb:.1f} MB")
        
        # Run frame selection
        print("🔍 Extracting golden frames...")
        golden_frames = extract_golden_frames(str(video_path), str(output_dir))
        print(f"   Found {len(golden_frames)} golden frames")
        
        # Run glint analysis
        print("🔦 Running glint analysis...")
        analysis_results = run_glint_analysis(golden_frames, str(output_dir))
        
        # Upload results to Supabase
        print("📤 Uploading to Supabase...")
        result = upload_results(supabase, scan_id, output_dir, golden_frames, analysis_results)
        
        print("✅ Analysis complete!")
        return result


def extract_golden_frames(video_path: str, output_dir: str, num_frames: int = 5) -> list:
    """
    Extract the sharpest, most stable frames from the video.
    Uses Laplacian Variance for sharpness and Optical Flow for motion detection.
    """
    import cv2
    import numpy as np
    
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    print(f"   Video: {total_frames} frames, {fps:.1f} fps, {total_frames/fps:.1f}s")
    
    # Analyze all frames
    candidates = []
    prev_gray = None
    frame_number = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Calculate sharpness (Laplacian Variance)
        laplacian = cv2.Laplacian(curr_gray, cv2.CV_64F)
        sharpness = laplacian.var()
        
        # Calculate motion (Optical Flow)
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
        if motion <= 1.0:
            candidates.append({
                'frame_number': frame_number,
                'sharpness': sharpness,
                'motion': motion,
                'frame': frame.copy(),
                'timestamp': frame_number / fps
            })
        
        prev_gray = curr_gray
        frame_number += 1
    
    cap.release()
    
    print(f"   Found {len(candidates)} stable frames")
    
    # Sort by sharpness (highest first) and select top N with spacing
    candidates.sort(key=lambda x: x['sharpness'], reverse=True)
    
    selected = []
    min_gap = 15  # Minimum frames between selections
    
    for candidate in candidates:
        too_close = False
        for s in selected:
            if abs(candidate['frame_number'] - s['frame_number']) < min_gap:
                too_close = True
                break
        
        if not too_close:
            selected.append(candidate)
        
        if len(selected) >= num_frames:
            break
    
    # Save selected frames
    saved_paths = []
    for i, frame_data in enumerate(selected, 1):
        filename = f"golden_frame_{i:02d}_f{frame_data['frame_number']:05d}.png"
        filepath = Path(output_dir) / filename
        cv2.imwrite(str(filepath), frame_data['frame'], [cv2.IMWRITE_PNG_COMPRESSION, 9])
        saved_paths.append({
            'path': str(filepath),
            'frame_number': frame_data['frame_number'],
            'timestamp': frame_data['timestamp'],
            'sharpness': frame_data['sharpness']
        })
        print(f"   [{i}] Frame #{frame_data['frame_number']} @ {frame_data['timestamp']:.2f}s (sharpness: {frame_data['sharpness']:.1f})")
    
    return saved_paths


def run_glint_analysis(golden_frames: list, output_dir: str) -> dict:
    """
    Analyze golden frames for defects using variance detection.
    """
    import cv2
    import numpy as np
    
    if len(golden_frames) < 2:
        return {"error": "Need at least 2 frames for analysis"}
    
    # Load all frames
    frames = []
    for gf in golden_frames:
        img = cv2.imread(gf['path'])
        if img is not None:
            frames.append(img)
    
    if len(frames) < 2:
        return {"error": "Could not load enough frames"}
    
    # Ensure all frames are same size
    reference_shape = frames[0].shape
    frames = [f for f in frames if f.shape == reference_shape]
    
    # Convert to grayscale
    gray_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]
    
    # Compute variance map
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
    
    defect_pct = (np.sum(defect_mask > 0) / defect_mask.size) * 100
    
    # Save visualizations
    output_path = Path(output_dir)
    
    # Defect mask
    cv2.imwrite(str(output_path / "defect_mask.png"), defect_mask)
    
    # Variance heatmap
    var_normalized = (variance_map / variance_map.max() * 255).astype(np.uint8)
    var_heatmap = cv2.applyColorMap(var_normalized, cv2.COLORMAP_JET)
    cv2.imwrite(str(output_path / "variance_heatmap.png"), var_heatmap)
    
    # Region crops
    h, w = frames[0].shape[:2]
    regions = {
        "corner_tl": (0, 0, int(w * 0.15), int(h * 0.12)),
        "corner_tr": (int(w * 0.85), 0, w, int(h * 0.12)),
        "corner_bl": (0, int(h * 0.88), int(w * 0.15), h),
        "corner_br": (int(w * 0.85), int(h * 0.88), w, h),
        "surface": (int(w * 0.2), int(h * 0.2), int(w * 0.8), int(h * 0.8)),
    }
    
    region_paths = {}
    for name, (x1, y1, x2, y2) in regions.items():
        crop = frames[0][y1:y2, x1:x2]
        crop_path = output_path / f"crop_{name}.png"
        cv2.imwrite(str(crop_path), crop)
        region_paths[name] = str(crop_path)
    
    return {
        "defect_percentage": defect_pct,
        "defect_mask_path": str(output_path / "defect_mask.png"),
        "variance_heatmap_path": str(output_path / "variance_heatmap.png"),
        "region_paths": region_paths
    }


def upload_results(supabase, scan_id: str, output_dir: Path, golden_frames: list, analysis: dict) -> dict:
    """
    Upload all generated images to Supabase Storage.
    """
    result = {
        "scanId": scan_id,
        "goldenFrames": [],
        "frameTimestamps": [],
        "defectMask": None,
        "varianceHeatmap": None,
        "regionCrops": {},
        "defectPercentage": analysis.get("defect_percentage", 0)
    }
    
    bucket = "analysis-images"
    
    # Upload golden frames
    for i, gf in enumerate(golden_frames):
        filepath = gf['path']
        filename = Path(filepath).name
        remote_path = f"{scan_id}/frames/{filename}"
        
        with open(filepath, 'rb') as f:
            supabase.storage.from_(bucket).upload(
                remote_path, f.read(),
                file_options={"content-type": "image/png", "upsert": "true"}
            )
        
        url = supabase.storage.from_(bucket).get_public_url(remote_path)
        result["goldenFrames"].append(url)
        result["frameTimestamps"].append(gf['timestamp'])
    
    # Upload defect mask
    if analysis.get("defect_mask_path"):
        remote_path = f"{scan_id}/defect_mask.png"
        with open(analysis["defect_mask_path"], 'rb') as f:
            supabase.storage.from_(bucket).upload(
                remote_path, f.read(),
                file_options={"content-type": "image/png", "upsert": "true"}
            )
        result["defectMask"] = supabase.storage.from_(bucket).get_public_url(remote_path)
    
    # Upload variance heatmap
    if analysis.get("variance_heatmap_path"):
        remote_path = f"{scan_id}/variance_heatmap.png"
        with open(analysis["variance_heatmap_path"], 'rb') as f:
            supabase.storage.from_(bucket).upload(
                remote_path, f.read(),
                file_options={"content-type": "image/png", "upsert": "true"}
            )
        result["varianceHeatmap"] = supabase.storage.from_(bucket).get_public_url(remote_path)
    
    # Upload region crops
    for name, path in analysis.get("region_paths", {}).items():
        remote_path = f"{scan_id}/crops/{name}.png"
        with open(path, 'rb') as f:
            supabase.storage.from_(bucket).upload(
                remote_path, f.read(),
                file_options={"content-type": "image/png", "upsert": "true"}
            )
        result["regionCrops"][name] = supabase.storage.from_(bucket).get_public_url(remote_path)
    
    return result


# Web endpoint for triggering analysis
@app.function(image=cv_image, secrets=[modal.Secret.from_name("supabase-secrets")])
@modal.web_endpoint(method="POST")
def trigger_analysis(request: dict) -> dict:
    """
    HTTP endpoint to trigger CV analysis.
    
    POST body:
    {
        "videoUrl": "https://...",
        "scanId": "video-123",
        "itemType": "card"
    }
    """
    video_url = request.get("videoUrl")
    scan_id = request.get("scanId")
    item_type = request.get("itemType", "card")
    
    if not video_url or not scan_id:
        return {"error": "Missing videoUrl or scanId"}
    
    # Run the analysis
    result = analyze_video.remote(video_url, scan_id, item_type)
    
    return result


# CLI entry point for local testing
@app.local_entrypoint()
def main(video_url: str, scan_id: str, item_type: str = "card"):
    """Local test entry point."""
    result = analyze_video.remote(video_url, scan_id, item_type)
    print(json.dumps(result, indent=2))

