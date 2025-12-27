#!/usr/bin/env python3
"""
Perspective Warp for Comic Book Grading
========================================
Detects comic book corners and unwarps to a flat 2D rectangle.

Uses:
- Contour detection to find the 4 corners of the comic
- Perspective transform to flatten the image
- Calculates pixels_per_mm based on standard comic dimensions
"""

import cv2
import numpy as np
import json
import os
import sys
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional
import glob


# Standard Collectible Dimensions (in mm)
# Comic Books (Modern Age)
COMIC_WIDTH_MM = 168.275
COMIC_HEIGHT_MM = 260.35

# Trading Cards (Standard - MTG, Pokemon, Sports)
CARD_WIDTH_MM = 63.5    # 2.5 inches
CARD_HEIGHT_MM = 88.9   # 3.5 inches

# Default dimensions (can be overridden via CLI)
DEFAULT_WIDTH_MM = COMIC_WIDTH_MM
DEFAULT_HEIGHT_MM = COMIC_HEIGHT_MM


@dataclass
class ScanMetadata:
    """Metadata for a processed comic scan."""
    source_file: str
    output_file: str
    pixels_per_mm_x: float
    pixels_per_mm_y: float
    pixels_per_mm_avg: float
    output_width_px: int
    output_height_px: int
    comic_width_mm: float
    comic_height_mm: float
    corners_detected: List[List[int]]
    detection_method: str


def order_corners(pts: np.ndarray) -> np.ndarray:
    """
    Order corner points as: top-left, top-right, bottom-right, bottom-left.
    
    Args:
        pts: Array of 4 points
    
    Returns:
        Ordered array of 4 points
    """
    rect = np.zeros((4, 2), dtype=np.float32)
    
    # Sum of coordinates: top-left has smallest, bottom-right has largest
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # Top-left
    rect[2] = pts[np.argmax(s)]  # Bottom-right
    
    # Difference of coordinates: top-right has smallest, bottom-left has largest
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # Top-right
    rect[3] = pts[np.argmax(diff)]  # Bottom-left
    
    return rect


def detect_comic_corners_contour(image: np.ndarray) -> Optional[np.ndarray]:
    """
    Detect comic book corners using contour detection.
    
    Args:
        image: Input BGR image
    
    Returns:
        Array of 4 corner points, or None if detection fails
    """
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Edge detection with Canny
    edges = cv2.Canny(blurred, 50, 150)
    
    # Dilate edges to close gaps
    kernel = np.ones((3, 3), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=2)
    
    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return None
    
    # Sort contours by area (largest first)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    
    # Find the largest quadrilateral
    for contour in contours[:5]:  # Check top 5 largest contours
        # Approximate the contour to a polygon
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        
        # If we found a quadrilateral
        if len(approx) == 4:
            # Verify it's large enough (at least 10% of image area)
            area = cv2.contourArea(approx)
            image_area = image.shape[0] * image.shape[1]
            
            if area > 0.1 * image_area:
                corners = approx.reshape(4, 2).astype(np.float32)
                return order_corners(corners)
    
    return None


def detect_comic_corners_adaptive(image: np.ndarray) -> Optional[np.ndarray]:
    """
    Alternative corner detection using adaptive thresholding.
    Falls back to this if standard contour detection fails.
    
    Args:
        image: Input BGR image
    
    Returns:
        Array of 4 corner points, or None if detection fails
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Adaptive thresholding
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY, 11, 2
    )
    
    # Morphological operations to clean up
    kernel = np.ones((5, 5), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    
    # Invert if needed (comic should be white/light on dark background)
    if np.mean(thresh) > 127:
        thresh = cv2.bitwise_not(thresh)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return None
    
    # Find largest contour
    largest = max(contours, key=cv2.contourArea)
    
    # Get minimum area rectangle
    rect = cv2.minAreaRect(largest)
    box = cv2.boxPoints(rect)
    corners = box.astype(np.float32)
    
    # Verify size
    area = cv2.contourArea(corners)
    image_area = image.shape[0] * image.shape[1]
    
    if area > 0.1 * image_area:
        return order_corners(corners)
    
    return None


def detect_corners(image: np.ndarray) -> Tuple[Optional[np.ndarray], str]:
    """
    Detect comic book corners using multiple methods.
    
    Args:
        image: Input BGR image
    
    Returns:
        Tuple of (corners array, detection method name)
    """
    # Try contour detection first
    corners = detect_comic_corners_contour(image)
    if corners is not None:
        return corners, "contour_quadrilateral"
    
    # Fall back to adaptive thresholding
    corners = detect_comic_corners_adaptive(image)
    if corners is not None:
        return corners, "adaptive_threshold"
    
    return None, "failed"


def perspective_transform(
    image: np.ndarray,
    corners: np.ndarray,
    target_width: Optional[int] = None,
    target_height: Optional[int] = None
) -> Tuple[np.ndarray, int, int]:
    """
    Apply perspective transform to unwarp the comic.
    
    Args:
        image: Input BGR image
        corners: 4 corner points (ordered: TL, TR, BR, BL)
        target_width: Output width (auto-calculated if None)
        target_height: Output height (auto-calculated if None)
    
    Returns:
        Tuple of (warped image, width, height)
    """
    tl, tr, br, bl = corners
    
    # Calculate output dimensions if not specified
    if target_width is None:
        # Width = max of top edge and bottom edge
        width_top = np.linalg.norm(tr - tl)
        width_bottom = np.linalg.norm(br - bl)
        target_width = int(max(width_top, width_bottom))
    
    if target_height is None:
        # Height = max of left edge and right edge
        height_left = np.linalg.norm(bl - tl)
        height_right = np.linalg.norm(br - tr)
        target_height = int(max(height_left, height_right))
    
    # Destination points for the flat rectangle
    dst = np.array([
        [0, 0],
        [target_width - 1, 0],
        [target_width - 1, target_height - 1],
        [0, target_height - 1]
    ], dtype=np.float32)
    
    # Calculate perspective transform matrix
    M = cv2.getPerspectiveTransform(corners, dst)
    
    # Apply the transform
    warped = cv2.warpPerspective(
        image, M, (target_width, target_height),
        flags=cv2.INTER_LANCZOS4,  # High-quality interpolation
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0)
    )
    
    return warped, target_width, target_height


def calculate_pixels_per_mm(
    width_px: int,
    height_px: int,
    item_type: str = "comic"
) -> Tuple[float, float, float]:
    """
    Calculate pixels per mm based on collectible dimensions.
    
    Args:
        width_px: Output image width in pixels
        height_px: Output image height in pixels
        item_type: Type of collectible ("comic", "card")
    
    Returns:
        Tuple of (px_per_mm_x, px_per_mm_y, px_per_mm_avg)
    """
    if item_type == "card":
        width_mm = CARD_WIDTH_MM
        height_mm = CARD_HEIGHT_MM
    else:  # Default to comic
        width_mm = COMIC_WIDTH_MM
        height_mm = COMIC_HEIGHT_MM
    
    px_per_mm_x = width_px / width_mm
    px_per_mm_y = height_px / height_mm
    px_per_mm_avg = (px_per_mm_x + px_per_mm_y) / 2
    
    return px_per_mm_x, px_per_mm_y, px_per_mm_avg


def process_golden_frame(
    input_path: str,
    output_dir: str = "temp_analysis"
) -> Optional[ScanMetadata]:
    """
    Process a single golden frame.
    
    Args:
        input_path: Path to input image
        output_dir: Directory for output files
    
    Returns:
        ScanMetadata object or None if processing fails
    """
    print(f"\n📄 Processing: {os.path.basename(input_path)}")
    
    # Load image
    image = cv2.imread(input_path)
    if image is None:
        print(f"   ❌ Could not load image")
        return None
    
    print(f"   Input size: {image.shape[1]} x {image.shape[0]} px")
    
    # Detect corners
    corners, method = detect_corners(image)
    
    if corners is None:
        print(f"   ❌ Could not detect comic corners")
        return None
    
    print(f"   ✅ Corners detected using: {method}")
    print(f"   📍 Corners: TL={corners[0].astype(int).tolist()}, TR={corners[1].astype(int).tolist()}")
    print(f"              BR={corners[2].astype(int).tolist()}, BL={corners[3].astype(int).tolist()}")
    
    # Apply perspective transform
    warped, width_px, height_px = perspective_transform(image, corners)
    
    print(f"   📐 Output size: {width_px} x {height_px} px")
    
    # Calculate pixels per mm
    px_mm_x, px_mm_y, px_mm_avg = calculate_pixels_per_mm(width_px, height_px)
    
    print(f"   📏 Resolution: {px_mm_avg:.2f} px/mm (≈ {px_mm_avg * 25.4:.0f} DPI)")
    
    # Generate output filename
    input_name = Path(input_path).stem
    output_filename = f"{input_name}_warped.png"
    output_path = Path(output_dir) / output_filename
    
    # Save warped image as lossless PNG
    cv2.imwrite(
        str(output_path),
        warped,
        [cv2.IMWRITE_PNG_COMPRESSION, 9]
    )
    
    print(f"   💾 Saved: {output_filename}")
    
    # Create metadata
    metadata = ScanMetadata(
        source_file=os.path.basename(input_path),
        output_file=output_filename,
        pixels_per_mm_x=round(px_mm_x, 4),
        pixels_per_mm_y=round(px_mm_y, 4),
        pixels_per_mm_avg=round(px_mm_avg, 4),
        output_width_px=width_px,
        output_height_px=height_px,
        comic_width_mm=COMIC_WIDTH_MM,
        comic_height_mm=COMIC_HEIGHT_MM,
        corners_detected=corners.astype(int).tolist(),
        detection_method=method
    )
    
    return metadata


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        # Default: process all golden frames in temp_analysis
        input_pattern = "temp_analysis/golden_frame_*.png"
    else:
        input_pattern = sys.argv[1]
    
    # Check for --type argument
    item_type = "comic"  # Default
    for i, arg in enumerate(sys.argv):
        if arg == "--type" and i + 1 < len(sys.argv):
            item_type = sys.argv[i + 1].lower()
            break
    
    print("=" * 60)
    print("📐 Perspective Warp - Collectibles Grading")
    print("=" * 60)
    print()
    
    if item_type == "card":
        print(f"Item Type: Trading Card")
        print(f"Standard Dimensions: {CARD_WIDTH_MM} x {CARD_HEIGHT_MM} mm")
    else:
        print(f"Item Type: Comic Book")
        print(f"Standard Dimensions: {COMIC_WIDTH_MM} x {COMIC_HEIGHT_MM} mm")
    
    # Find input files
    if os.path.isfile(input_pattern):
        input_files = [input_pattern]
    else:
        input_files = sorted(glob.glob(input_pattern))
    
    if not input_files:
        print(f"\n❌ No files found matching: {input_pattern}")
        print("\nUsage:")
        print("  python perspect_warp.py                    # Process all golden frames")
        print("  python perspect_warp.py path/to/image.png  # Process single image")
        print("  python perspect_warp.py 'temp_analysis/*.png'  # Process pattern")
        sys.exit(1)
    
    print(f"\n📁 Found {len(input_files)} file(s) to process")
    
    # Process each file
    output_dir = "temp_analysis"
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    all_metadata: List[ScanMetadata] = []
    
    for input_path in input_files:
        metadata = process_golden_frame(input_path, output_dir)
        if metadata:
            all_metadata.append(metadata)
    
    # Save metadata to JSON
    if all_metadata:
        metadata_path = Path(output_dir) / "metadata.json"
        
        # Calculate aggregate statistics
        avg_px_mm = np.mean([m.pixels_per_mm_avg for m in all_metadata])
        
        output_data = {
            "scan_info": {
                "comic_width_mm": COMIC_WIDTH_MM,
                "comic_height_mm": COMIC_HEIGHT_MM,
                "average_pixels_per_mm": round(avg_px_mm, 4),
                "average_dpi": round(avg_px_mm * 25.4, 1),
                "total_frames_processed": len(all_metadata)
            },
            "frames": [asdict(m) for m in all_metadata]
        }
        
        with open(metadata_path, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"\n💾 Saved metadata: {metadata_path}")
        print(f"   Average resolution: {avg_px_mm:.2f} px/mm (≈ {avg_px_mm * 25.4:.0f} DPI)")
    
    print()
    print("=" * 60)
    print(f"✨ Done! Processed {len(all_metadata)}/{len(input_files)} frames.")
    print("=" * 60)


if __name__ == "__main__":
    main()

