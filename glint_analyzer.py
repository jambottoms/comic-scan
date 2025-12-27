#!/usr/bin/env python3
"""
Glint Analyzer for Comic Book Grading
=====================================
Detects defects by analyzing light reflections across multiple frames.

Uses:
- Frame subtraction to find intensity changes (glints from creases)
- Statistical analysis to create defect masks
- Region extraction for spine and corners
"""

import cv2
import numpy as np
import json
import os
import sys
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Dict
import glob


# Region definitions (as percentages of image dimensions)
# Works for comics (spine + corners) and cards (corners + surface)
REGIONS = {
    "spine": {
        "x_start": 0.0,
        "x_end": 0.08,      # Left 8% of image (comics only)
        "y_start": 0.0,
        "y_end": 1.0
    },
    "corner_tl": {
        "x_start": 0.0,
        "x_end": 0.15,      # 15% from edges
        "y_start": 0.0,
        "y_end": 0.12
    },
    "corner_tr": {
        "x_start": 0.85,
        "x_end": 1.0,
        "y_start": 0.0,
        "y_end": 0.12
    },
    "corner_bl": {
        "x_start": 0.0,
        "x_end": 0.15,
        "y_start": 0.88,
        "y_end": 1.0
    },
    "corner_br": {
        "x_start": 0.85,
        "x_end": 1.0,
        "y_start": 0.88,
        "y_end": 1.0
    },
    "surface": {
        "x_start": 0.20,    # Center region for surface analysis (cards)
        "x_end": 0.80,
        "y_start": 0.20,
        "y_end": 0.80
    }
}


@dataclass
class DefectAnalysis:
    """Analysis results for a region."""
    region_name: str
    crop_file: str
    mask_file: str
    defect_pixel_count: int
    defect_percentage: float
    max_intensity_variance: float
    mean_intensity_variance: float


@dataclass
class GlintAnalysisResult:
    """Complete analysis results."""
    frames_analyzed: int
    output_dir: str
    defect_threshold: float
    regions: List[DefectAnalysis]
    full_mask_file: str
    variance_map_file: str


def load_warped_frames(input_dir: str = "temp_analysis") -> List[np.ndarray]:
    """
    Load all warped golden frames.
    
    Args:
        input_dir: Directory containing warped frames
    
    Returns:
        List of BGR images
    """
    pattern = os.path.join(input_dir, "*_warped.png")
    files = sorted(glob.glob(pattern))
    
    if not files:
        # Fall back to golden frames if no warped frames exist
        pattern = os.path.join(input_dir, "golden_frame_*.png")
        files = sorted(glob.glob(pattern))
        # Exclude already warped files
        files = [f for f in files if "_warped" not in f]
    
    frames = []
    for f in files:
        img = cv2.imread(f)
        if img is not None:
            frames.append(img)
            print(f"   Loaded: {os.path.basename(f)}")
    
    return frames


def align_frames(frames: List[np.ndarray]) -> List[np.ndarray]:
    """
    Align frames to the first frame using feature matching.
    This compensates for any slight misalignment between frames.
    
    Args:
        frames: List of BGR images
    
    Returns:
        List of aligned BGR images
    """
    if len(frames) < 2:
        return frames
    
    reference = frames[0]
    aligned = [reference]
    
    # Use ORB for feature detection
    orb = cv2.ORB_create(nfeatures=1000)
    
    ref_gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
    ref_kp, ref_desc = orb.detectAndCompute(ref_gray, None)
    
    for i, frame in enumerate(frames[1:], 1):
        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        kp, desc = orb.detectAndCompute(frame_gray, None)
        
        if desc is None or ref_desc is None:
            aligned.append(frame)
            continue
        
        # Match features
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(ref_desc, desc)
        matches = sorted(matches, key=lambda x: x.distance)[:50]
        
        if len(matches) < 4:
            aligned.append(frame)
            continue
        
        # Extract matched points
        src_pts = np.float32([ref_kp[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        
        # Find homography
        H, mask = cv2.findHomography(dst_pts, src_pts, cv2.RANSAC, 5.0)
        
        if H is not None:
            h, w = reference.shape[:2]
            aligned_frame = cv2.warpPerspective(frame, H, (w, h))
            aligned.append(aligned_frame)
        else:
            aligned.append(frame)
    
    return aligned


def compute_variance_map(frames: List[np.ndarray]) -> np.ndarray:
    """
    Compute pixel-wise variance across all frames.
    High variance indicates glints/reflections from defects.
    
    Args:
        frames: List of aligned BGR images
    
    Returns:
        Variance map (float32, single channel)
    """
    # Convert all frames to grayscale and float
    gray_frames = []
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gray_frames.append(gray)
    
    # Stack frames
    stack = np.stack(gray_frames, axis=0)
    
    # Compute variance along the frame axis
    variance = np.var(stack, axis=0)
    
    return variance


def compute_max_difference_map(frames: List[np.ndarray]) -> np.ndarray:
    """
    Compute maximum absolute difference between any two frames.
    This captures the largest intensity change at each pixel.
    
    Args:
        frames: List of aligned BGR images
    
    Returns:
        Max difference map (float32, single channel)
    """
    gray_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]
    
    max_diff = np.zeros_like(gray_frames[0])
    
    for i in range(len(gray_frames)):
        for j in range(i + 1, len(gray_frames)):
            diff = np.abs(gray_frames[i] - gray_frames[j])
            max_diff = np.maximum(max_diff, diff)
    
    return max_diff


def create_defect_mask(
    variance_map: np.ndarray,
    max_diff_map: np.ndarray,
    threshold_sigma: float = 2.0
) -> np.ndarray:
    """
    Create a binary defect mask from variance and difference maps.
    
    Args:
        variance_map: Pixel-wise variance across frames
        max_diff_map: Maximum difference between frames
        threshold_sigma: Number of standard deviations above mean for threshold
    
    Returns:
        Binary mask (uint8, 0 or 255)
    """
    # Combine variance and max difference
    combined = (variance_map / variance_map.max() + max_diff_map / max_diff_map.max()) / 2
    
    # Calculate threshold using mean + sigma * std
    mean_val = np.mean(combined)
    std_val = np.std(combined)
    threshold = mean_val + threshold_sigma * std_val
    
    # Create binary mask
    mask = (combined > threshold).astype(np.uint8) * 255
    
    # Morphological operations to clean up
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    
    # Dilate slightly to ensure we capture full defect areas
    mask = cv2.dilate(mask, kernel, iterations=2)
    
    return mask


def extract_region(
    image: np.ndarray,
    region: Dict[str, float]
) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    """
    Extract a region from an image based on percentage coordinates.
    
    Args:
        image: Input image
        region: Dict with x_start, x_end, y_start, y_end as percentages
    
    Returns:
        Tuple of (cropped image, (x1, y1, x2, y2) coordinates)
    """
    h, w = image.shape[:2]
    
    x1 = int(w * region["x_start"])
    x2 = int(w * region["x_end"])
    y1 = int(h * region["y_start"])
    y2 = int(h * region["y_end"])
    
    crop = image[y1:y2, x1:x2]
    
    return crop, (x1, y1, x2, y2)


def analyze_region(
    frames: List[np.ndarray],
    defect_mask: np.ndarray,
    variance_map: np.ndarray,
    region_name: str,
    region_def: Dict[str, float],
    output_dir: str
) -> DefectAnalysis:
    """
    Analyze a specific region and save crops.
    
    Args:
        frames: List of aligned frames (use first/best for crop)
        defect_mask: Full defect mask
        variance_map: Full variance map
        region_name: Name of the region
        region_def: Region definition
        output_dir: Output directory
    
    Returns:
        DefectAnalysis object
    """
    # Use first frame for the crop (typically the sharpest)
    reference = frames[0]
    
    # Extract regions
    crop, (x1, y1, x2, y2) = extract_region(reference, region_def)
    mask_crop, _ = extract_region(defect_mask, region_def)
    var_crop, _ = extract_region(variance_map, region_def)
    
    # Calculate defect statistics
    defect_pixels = np.sum(mask_crop > 0)
    total_pixels = mask_crop.shape[0] * mask_crop.shape[1]
    defect_pct = (defect_pixels / total_pixels) * 100 if total_pixels > 0 else 0
    
    max_var = float(np.max(var_crop))
    mean_var = float(np.mean(var_crop))
    
    # Save crop (original + overlay)
    crop_filename = f"crop_{region_name}.png"
    crop_path = os.path.join(output_dir, crop_filename)
    cv2.imwrite(crop_path, crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    
    # Save mask crop
    mask_filename = f"mask_{region_name}.png"
    mask_path = os.path.join(output_dir, mask_filename)
    cv2.imwrite(mask_path, mask_crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    
    # Create visualization with defects highlighted
    overlay = crop.copy()
    # Create red overlay for defects
    red_overlay = np.zeros_like(crop)
    red_overlay[:, :, 2] = mask_crop  # Red channel
    overlay = cv2.addWeighted(overlay, 0.7, red_overlay, 0.3, 0)
    
    overlay_filename = f"overlay_{region_name}.png"
    overlay_path = os.path.join(output_dir, overlay_filename)
    cv2.imwrite(overlay_path, overlay, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    
    return DefectAnalysis(
        region_name=region_name,
        crop_file=crop_filename,
        mask_file=mask_filename,
        defect_pixel_count=int(defect_pixels),
        defect_percentage=round(defect_pct, 2),
        max_intensity_variance=round(max_var, 2),
        mean_intensity_variance=round(mean_var, 2)
    )


def create_full_visualization(
    reference: np.ndarray,
    defect_mask: np.ndarray,
    variance_map: np.ndarray,
    output_dir: str
) -> Tuple[str, str]:
    """
    Create full-image visualizations.
    
    Args:
        reference: Reference frame
        defect_mask: Full defect mask
        variance_map: Full variance map
        output_dir: Output directory
    
    Returns:
        Tuple of (mask filename, variance map filename)
    """
    # Save defect mask
    mask_file = "defect_mask_full.png"
    cv2.imwrite(
        os.path.join(output_dir, mask_file),
        defect_mask,
        [cv2.IMWRITE_PNG_COMPRESSION, 9]
    )
    
    # Normalize and save variance map as heatmap
    var_normalized = (variance_map / variance_map.max() * 255).astype(np.uint8)
    var_heatmap = cv2.applyColorMap(var_normalized, cv2.COLORMAP_JET)
    
    var_file = "variance_heatmap.png"
    cv2.imwrite(
        os.path.join(output_dir, var_file),
        var_heatmap,
        [cv2.IMWRITE_PNG_COMPRESSION, 9]
    )
    
    # Create overlay visualization
    overlay = reference.copy()
    
    # Draw region boundaries
    h, w = reference.shape[:2]
    for name, region in REGIONS.items():
        x1 = int(w * region["x_start"])
        x2 = int(w * region["x_end"])
        y1 = int(h * region["y_start"])
        y2 = int(h * region["y_end"])
        
        color = (0, 255, 255) if "spine" in name else (255, 255, 0)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 3)
        cv2.putText(overlay, name, (x1 + 5, y1 + 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    
    # Add red defect overlay
    red_mask = np.zeros_like(overlay)
    red_mask[:, :, 2] = defect_mask
    overlay = cv2.addWeighted(overlay, 0.8, red_mask, 0.2, 0)
    
    regions_file = "regions_overlay.png"
    cv2.imwrite(
        os.path.join(output_dir, regions_file),
        overlay,
        [cv2.IMWRITE_PNG_COMPRESSION, 9]
    )
    
    return mask_file, var_file


def main():
    """Main entry point."""
    input_dir = sys.argv[1] if len(sys.argv) > 1 else "temp_analysis"
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "temp_analysis"
    threshold_sigma = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    
    print("=" * 60)
    print("🔦 Glint Analyzer - Comic Book Grading")
    print("=" * 60)
    print()
    print(f"Input directory: {input_dir}")
    print(f"Output directory: {output_dir}")
    print(f"Defect threshold: {threshold_sigma} sigma")
    print()
    
    # Load frames
    print("📂 Loading warped frames...")
    frames = load_warped_frames(input_dir)
    
    if len(frames) < 2:
        print(f"\n❌ Need at least 2 frames for glint analysis. Found: {len(frames)}")
        print("\nRun frame_selector.py and perspect_warp.py first.")
        sys.exit(1)
    
    print(f"\n   Total frames: {len(frames)}")
    
    # Ensure all frames are the same size
    reference_shape = frames[0].shape
    frames = [f for f in frames if f.shape == reference_shape]
    print(f"   Frames with matching size: {len(frames)}")
    print(f"   Frame dimensions: {reference_shape[1]} x {reference_shape[0]} px")
    
    # Align frames
    print("\n🔧 Aligning frames...")
    aligned_frames = align_frames(frames)
    print(f"   Aligned {len(aligned_frames)} frames")
    
    # Compute variance map
    print("\n📊 Computing variance map...")
    variance_map = compute_variance_map(aligned_frames)
    print(f"   Variance range: {variance_map.min():.2f} - {variance_map.max():.2f}")
    
    # Compute max difference map
    print("\n📈 Computing max difference map...")
    max_diff_map = compute_max_difference_map(aligned_frames)
    print(f"   Max difference range: {max_diff_map.min():.2f} - {max_diff_map.max():.2f}")
    
    # Create defect mask
    print("\n🎭 Creating defect mask...")
    defect_mask = create_defect_mask(variance_map, max_diff_map, threshold_sigma)
    defect_pct = (np.sum(defect_mask > 0) / defect_mask.size) * 100
    print(f"   Defect coverage: {defect_pct:.2f}%")
    
    # Create output directory
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    # Create full visualizations
    print("\n🖼️  Creating visualizations...")
    mask_file, var_file = create_full_visualization(
        aligned_frames[0], defect_mask, variance_map, output_dir
    )
    print(f"   Saved: {mask_file}")
    print(f"   Saved: {var_file}")
    print(f"   Saved: regions_overlay.png")
    
    # Analyze each region
    print("\n📍 Analyzing regions...")
    region_analyses: List[DefectAnalysis] = []
    
    for region_name, region_def in REGIONS.items():
        analysis = analyze_region(
            aligned_frames, defect_mask, variance_map,
            region_name, region_def, output_dir
        )
        region_analyses.append(analysis)
        
        status = "⚠️" if analysis.defect_percentage > 1.0 else "✅"
        print(f"   {status} {region_name}: {analysis.defect_percentage:.1f}% defects")
    
    # Create result object
    result = GlintAnalysisResult(
        frames_analyzed=len(aligned_frames),
        output_dir=output_dir,
        defect_threshold=threshold_sigma,
        regions=region_analyses,
        full_mask_file=mask_file,
        variance_map_file=var_file
    )
    
    # Save analysis results
    analysis_path = os.path.join(output_dir, "glint_analysis.json")
    with open(analysis_path, 'w') as f:
        json.dump({
            "frames_analyzed": result.frames_analyzed,
            "output_dir": result.output_dir,
            "defect_threshold": result.defect_threshold,
            "full_mask_file": result.full_mask_file,
            "variance_map_file": result.variance_map_file,
            "regions": [asdict(r) for r in result.regions]
        }, f, indent=2)
    
    print(f"\n💾 Saved: {analysis_path}")
    
    # Summary
    print()
    print("=" * 60)
    print("📋 SUMMARY - Crops ready for Nyckel Classification")
    print("=" * 60)
    print()
    print("Region crops saved for classification:")
    for analysis in region_analyses:
        print(f"   • {output_dir}/{analysis.crop_file}")
    print()
    print("Defect overlays for review:")
    for analysis in region_analyses:
        print(f"   • {output_dir}/overlay_{analysis.region_name}.png")
    print()
    print("=" * 60)
    print(f"✨ Done! Analyzed {len(aligned_frames)} frames, extracted 5 regions.")
    print("=" * 60)
    print()
    print("💡 Next step: Upload crops to Nyckel for defect classification")
    print("   Recommended labels: pristine, minor_wear, crease, tear, stain")


if __name__ == "__main__":
    main()

