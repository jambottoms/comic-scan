#!/usr/bin/env python3
"""
Upload CV Analysis to Supabase
==============================
Uploads golden frames, defect masks, and region crops to Supabase Storage
so they can be displayed in the GradeVault web app.

Usage:
    python upload_analysis.py <scan_id> [input_dir]
    
Example:
    python upload_analysis.py video-1234567890-abc123 temp_analysis
"""

import os
import sys
import json
import glob
from pathlib import Path
from typing import Dict, List, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

try:
    from supabase import create_client, Client
except ImportError:
    print("❌ Supabase Python SDK not installed. Run: pip install supabase")
    sys.exit(1)


def get_supabase_client() -> Client:
    """Get Supabase client from environment variables."""
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    
    if not url or not key:
        raise ValueError(
            "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and "
            "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
        )
    
    return create_client(url, key)


def upload_file(supabase: Client, local_path: str, remote_path: str) -> Optional[str]:
    """
    Upload a file to Supabase Storage.
    
    Args:
        supabase: Supabase client
        local_path: Local file path
        remote_path: Path in Supabase storage bucket
    
    Returns:
        Public URL or None if failed
    """
    try:
        with open(local_path, 'rb') as f:
            file_data = f.read()
        
        # Upload to analysis-images bucket
        result = supabase.storage.from_('analysis-images').upload(
            remote_path,
            file_data,
            file_options={"content-type": "image/png", "upsert": "true"}
        )
        
        # Get public URL
        url_data = supabase.storage.from_('analysis-images').get_public_url(remote_path)
        return url_data
        
    except Exception as e:
        print(f"   ❌ Failed to upload {local_path}: {e}")
        return None


def upload_analysis(scan_id: str, input_dir: str = "temp_analysis") -> Dict:
    """
    Upload all CV analysis images for a scan.
    
    Args:
        scan_id: The scan/video ID (e.g., video-1234567890-abc123)
        input_dir: Directory containing analysis images
    
    Returns:
        Dict with URLs for all uploaded images
    """
    supabase = get_supabase_client()
    
    result = {
        "scanId": scan_id,
        "goldenFrames": [],
        "defectMask": None,
        "varianceHeatmap": None,
        "regionCrops": {},
        "regionOverlays": {},
        "pixelsPerMm": None
    }
    
    input_path = Path(input_dir)
    
    # Upload golden frames
    print("📸 Uploading golden frames...")
    golden_frames = sorted(glob.glob(str(input_path / "golden_frame_*_warped.png")))
    if not golden_frames:
        golden_frames = sorted(glob.glob(str(input_path / "golden_frame_*.png")))
    
    for frame_path in golden_frames[:5]:  # Max 5 frames
        filename = os.path.basename(frame_path)
        remote_path = f"{scan_id}/frames/{filename}"
        url = upload_file(supabase, frame_path, remote_path)
        if url:
            result["goldenFrames"].append(url)
            print(f"   ✅ {filename}")
    
    # Upload defect mask
    print("🎭 Uploading defect analysis...")
    defect_mask = input_path / "defect_mask_full.png"
    if defect_mask.exists():
        url = upload_file(supabase, str(defect_mask), f"{scan_id}/defect_mask.png")
        if url:
            result["defectMask"] = url
            print(f"   ✅ defect_mask.png")
    
    # Upload variance heatmap
    variance_map = input_path / "variance_heatmap.png"
    if variance_map.exists():
        url = upload_file(supabase, str(variance_map), f"{scan_id}/variance_heatmap.png")
        if url:
            result["varianceHeatmap"] = url
            print(f"   ✅ variance_heatmap.png")
    
    # Upload region crops
    print("📍 Uploading region crops...")
    regions = ["spine", "corner_tl", "corner_tr", "corner_bl", "corner_br", "surface"]
    
    for region in regions:
        crop_path = input_path / f"crop_{region}.png"
        if crop_path.exists():
            url = upload_file(supabase, str(crop_path), f"{scan_id}/crops/{region}.png")
            if url:
                result["regionCrops"][region] = url
                print(f"   ✅ crop_{region}.png")
        
        overlay_path = input_path / f"overlay_{region}.png"
        if overlay_path.exists():
            url = upload_file(supabase, str(overlay_path), f"{scan_id}/overlays/{region}.png")
            if url:
                result["regionOverlays"][region] = url
    
    # Read metadata for pixels per mm
    metadata_path = input_path / "metadata.json"
    if metadata_path.exists():
        with open(metadata_path) as f:
            metadata = json.load(f)
            if "scan_info" in metadata:
                result["pixelsPerMm"] = metadata["scan_info"].get("average_pixels_per_mm")
    
    return result


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python upload_analysis.py <scan_id> [input_dir]")
        print()
        print("Arguments:")
        print("  scan_id    The video/scan ID from GradeVault (e.g., video-1234567890-abc)")
        print("  input_dir  Directory with analysis images (default: temp_analysis)")
        print()
        print("Example:")
        print("  python upload_analysis.py video-1234567890-abc123")
        sys.exit(1)
    
    scan_id = sys.argv[1]
    input_dir = sys.argv[2] if len(sys.argv) > 2 else "temp_analysis"
    
    print("=" * 60)
    print("📤 Upload CV Analysis to GradeVault")
    print("=" * 60)
    print()
    print(f"Scan ID: {scan_id}")
    print(f"Input directory: {input_dir}")
    print()
    
    try:
        result = upload_analysis(scan_id, input_dir)
        
        # Save result JSON
        output_path = f"{input_dir}/upload_result.json"
        with open(output_path, 'w') as f:
            json.dump(result, f, indent=2)
        
        print()
        print("=" * 60)
        print("✨ Upload Complete!")
        print("=" * 60)
        print()
        print(f"Golden Frames: {len(result['goldenFrames'])}")
        print(f"Defect Mask: {'✅' if result['defectMask'] else '❌'}")
        print(f"Region Crops: {len(result['regionCrops'])}")
        print()
        print(f"Results saved to: {output_path}")
        print()
        print("📋 Add this to your scan result to display images:")
        print(json.dumps({
            "goldenFrames": result["goldenFrames"][:3],
            "defectMask": result["defectMask"],
            "regionCrops": result["regionCrops"],
            "pixelsPerMm": result["pixelsPerMm"]
        }, indent=2))
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

