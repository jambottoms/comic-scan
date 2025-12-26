#!/usr/bin/env python3
"""
Golden Frame Selector for Comic Book Grading
============================================
Extracts the top 5 sharpest, most stable frames from a video.

Uses:
- Laplacian Variance for sharpness scoring
- Optical Flow (Farneback) for motion detection
- Only selects frames with near-zero camera movement
"""

import cv2
import numpy as np
import os
import sys
from pathlib import Path
from dataclasses import dataclass
from typing import List, Tuple


@dataclass
class FrameCandidate:
    """Represents a candidate frame with its quality metrics."""
    frame_number: int
    sharpness: float
    motion_magnitude: float
    frame_data: np.ndarray


def calculate_sharpness(frame: np.ndarray) -> float:
    """
    Calculate frame sharpness using Laplacian Variance.
    Higher values indicate sharper images.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    variance = laplacian.var()
    return variance


def calculate_motion(prev_gray: np.ndarray, curr_gray: np.ndarray) -> float:
    """
    Calculate motion magnitude using Farneback Optical Flow.
    Returns the mean magnitude of motion vectors.
    """
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray,
        curr_gray,
        None,
        pyr_scale=0.5,
        levels=3,
        winsize=15,
        iterations=3,
        poly_n=5,
        poly_sigma=1.2,
        flags=0
    )
    
    # Calculate magnitude of flow vectors
    magnitude, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
    mean_magnitude = np.mean(magnitude)
    
    return mean_magnitude


def process_video(video_path: str, motion_threshold: float = 1.0) -> List[FrameCandidate]:
    """
    Process video and extract candidate frames with low motion.
    
    Args:
        video_path: Path to the input video file
        motion_threshold: Maximum allowed motion magnitude (default: 1.0 pixels)
    
    Returns:
        List of FrameCandidate objects sorted by sharpness (descending)
    """
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    print(f"📹 Video Info:")
    print(f"   Total frames: {total_frames}")
    print(f"   FPS: {fps:.2f}")
    print(f"   Duration: {total_frames / fps:.2f}s")
    print(f"   Motion threshold: {motion_threshold} pixels")
    print()
    
    candidates: List[FrameCandidate] = []
    prev_gray = None
    frame_number = 0
    
    print("🔍 Analyzing frames...")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Calculate sharpness for every frame
        sharpness = calculate_sharpness(frame)
        
        # Calculate motion (skip first frame)
        if prev_gray is not None:
            motion = calculate_motion(prev_gray, curr_gray)
            
            # Only consider frames with low motion
            if motion <= motion_threshold:
                candidates.append(FrameCandidate(
                    frame_number=frame_number,
                    sharpness=sharpness,
                    motion_magnitude=motion,
                    frame_data=frame.copy()
                ))
        
        prev_gray = curr_gray
        frame_number += 1
        
        # Progress indicator
        if frame_number % 30 == 0:
            progress = (frame_number / total_frames) * 100
            print(f"   Progress: {progress:.1f}% ({frame_number}/{total_frames})", end='\r')
    
    cap.release()
    print(f"\n   ✅ Analyzed {frame_number} frames")
    print(f"   📊 Found {len(candidates)} stable frames (motion ≤ {motion_threshold})")
    
    # Sort by sharpness (highest first)
    candidates.sort(key=lambda x: x.sharpness, reverse=True)
    
    return candidates


def select_golden_frames(
    candidates: List[FrameCandidate],
    num_frames: int = 5,
    min_frame_gap: int = 10
) -> List[FrameCandidate]:
    """
    Select top N golden frames with temporal spacing.
    
    Args:
        candidates: List of candidate frames sorted by sharpness
        num_frames: Number of frames to select
        min_frame_gap: Minimum frames between selections (avoid duplicates)
    
    Returns:
        List of selected golden frames
    """
    selected: List[FrameCandidate] = []
    
    for candidate in candidates:
        # Check if this frame is far enough from already selected frames
        too_close = False
        for selected_frame in selected:
            if abs(candidate.frame_number - selected_frame.frame_number) < min_frame_gap:
                too_close = True
                break
        
        if not too_close:
            selected.append(candidate)
        
        if len(selected) >= num_frames:
            break
    
    return selected


def save_golden_frames(
    frames: List[FrameCandidate],
    output_dir: str = "temp_analysis"
) -> List[str]:
    """
    Save golden frames as lossless PNGs.
    
    Args:
        frames: List of golden frames to save
        output_dir: Directory to save frames
    
    Returns:
        List of saved file paths
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    saved_paths: List[str] = []
    
    print(f"\n💾 Saving {len(frames)} golden frames to {output_dir}/")
    
    for rank, frame in enumerate(frames, 1):
        filename = f"golden_frame_{rank:02d}_f{frame.frame_number:05d}.png"
        filepath = output_path / filename
        
        # Save as lossless PNG (compression level 9 for smallest size)
        cv2.imwrite(
            str(filepath),
            frame.frame_data,
            [cv2.IMWRITE_PNG_COMPRESSION, 9]
        )
        
        saved_paths.append(str(filepath))
        print(f"   [{rank}] {filename}")
        print(f"       Frame #{frame.frame_number} | Sharpness: {frame.sharpness:.2f} | Motion: {frame.motion_magnitude:.3f}px")
    
    return saved_paths


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python frame_selector.py <video_path> [motion_threshold]")
        print()
        print("Arguments:")
        print("  video_path       Path to input video file")
        print("  motion_threshold Maximum motion in pixels (default: 1.0)")
        print()
        print("Example:")
        print("  python frame_selector.py comic_scan.mp4 0.5")
        sys.exit(1)
    
    video_path = sys.argv[1]
    motion_threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    
    if not os.path.exists(video_path):
        print(f"❌ Error: Video file not found: {video_path}")
        sys.exit(1)
    
    print("=" * 60)
    print("🎬 Golden Frame Selector - Comic Book Grading")
    print("=" * 60)
    print()
    
    # Process video
    candidates = process_video(video_path, motion_threshold)
    
    if not candidates:
        print("\n❌ No stable frames found! Try increasing the motion threshold.")
        sys.exit(1)
    
    # Select top 5 golden frames
    golden_frames = select_golden_frames(candidates, num_frames=5, min_frame_gap=15)
    
    if not golden_frames:
        print("\n❌ Could not select golden frames.")
        sys.exit(1)
    
    # Save to temp_analysis folder
    saved_paths = save_golden_frames(golden_frames, "temp_analysis")
    
    print()
    print("=" * 60)
    print(f"✨ Done! Saved {len(saved_paths)} golden frames.")
    print("=" * 60)
    
    return saved_paths


if __name__ == "__main__":
    main()

