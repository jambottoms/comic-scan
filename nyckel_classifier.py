#!/usr/bin/env python3
"""
Nyckel Classifier for Comic Book Grading
=========================================
Integrates with Nyckel ML to classify defects in comic book regions.

Uses:
- Nyckel Image Classification API
- Crops from glint_analyzer.py
"""

import os
import sys
import json
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict

# Load environment from .env file
from dotenv import load_dotenv
load_dotenv()

try:
    from nyckel import Credentials, ImageClassificationFunction
except ImportError:
    print("❌ Nyckel SDK not installed. Run: pip install nyckel")
    sys.exit(1)


# Nyckel function ID (created during setup)
FUNCTION_ID = "dk9p25arxhpsqexb"

# Default labels for collectible defect classification
# Works for comics, trading cards, toys, and other collectibles
DEFAULT_LABELS = [
    "pristine",      # No visible defects (Gem Mint / 10)
    "near_mint",     # Minimal wear, nearly perfect (9-9.5)
    "minor_wear",    # Light surface wear, minor edge wear (7-8.5)
    "moderate_wear", # Visible wear, light creasing (5-6.5)
    "heavy_wear",    # Significant damage, creases, tears (3-4.5)
    "damaged",       # Major defects, missing pieces (1-2.5)
]

# Region names to process (adaptable for different collectible types)
# Comics: spine + 4 corners
# Cards: 4 corners + surface
# Toys: joints, paint, accessories
REGIONS = ["spine", "corner_tl", "corner_tr", "corner_bl", "corner_br", "surface"]


@dataclass
class ClassificationResult:
    """Result from Nyckel classification."""
    region: str
    label: str
    confidence: float
    all_predictions: Dict[str, float]


def get_credentials() -> Credentials:
    """
    Get Nyckel credentials from environment variables.
    
    Returns:
        Nyckel Credentials object
    """
    client_id = os.getenv('NYCKEL_CLIENT_ID')
    client_secret = os.getenv('NYCKEL_CLIENT_SECRET')
    
    if not client_id or not client_secret:
        raise ValueError(
            "Missing Nyckel credentials. Set NYCKEL_CLIENT_ID and "
            "NYCKEL_CLIENT_SECRET environment variables or create a .env file."
        )
    
    return Credentials(client_id=client_id, client_secret=client_secret)


def get_function(credentials: Credentials, function_id: str = FUNCTION_ID) -> ImageClassificationFunction:
    """
    Get existing Nyckel function by ID.
    
    Args:
        credentials: Nyckel credentials
        function_id: The function ID
    
    Returns:
        ImageClassificationFunction object
    """
    return ImageClassificationFunction(credentials=credentials, function_id=function_id)


def create_function(credentials: Credentials, name: str = "comic-defect-classifier") -> ImageClassificationFunction:
    """
    Create a new image classification function.
    
    Args:
        credentials: Nyckel credentials
        name: Function name
    
    Returns:
        ImageClassificationFunction object
    """
    print(f"📝 Creating new Nyckel function: {name}")
    
    func = ImageClassificationFunction.create(credentials=credentials, name=name)
    print(f"   ✅ Created function ID: {func.function_id}")
    
    # Create default labels
    print(f"   📌 Creating labels...")
    func.create_labels(DEFAULT_LABELS)
    for label in DEFAULT_LABELS:
        print(f"      • {label}")
    
    return func


def add_training_sample(
    func: ImageClassificationFunction,
    image_path: str,
    label: str
) -> bool:
    """
    Add a training sample to the function.
    
    Args:
        func: Nyckel function
        image_path: Path to image file
        label: Label for this sample
    
    Returns:
        True if successful
    """
    try:
        func.create_samples([(image_path, label)])
        return True
    except Exception as e:
        print(f"   ❌ Failed to add sample: {e}")
        return False


def classify_image(
    func: ImageClassificationFunction,
    image_path: str,
    region_name: str = "unknown"
) -> Optional[ClassificationResult]:
    """
    Classify an image using Nyckel.
    
    Args:
        func: Nyckel function
        image_path: Path to image file
        region_name: Name of the region for context
    
    Returns:
        ClassificationResult or None if failed
    """
    try:
        results = func.invoke([image_path])
        
        if not results:
            return None
        
        result = results[0]
        
        # Handle both prediction object and error
        if hasattr(result, 'label_name'):
            return ClassificationResult(
                region=region_name,
                label=result.label_name,
                confidence=result.confidence,
                all_predictions={}
            )
        else:
            print(f"   ⚠️  Unexpected result type: {result}")
            return None
            
    except Exception as e:
        print(f"   ❌ Classification failed: {e}")
        return None


def classify_all_regions(
    func: ImageClassificationFunction,
    input_dir: str = "temp_analysis"
) -> List[ClassificationResult]:
    """
    Classify all region crops from glint analyzer.
    
    Args:
        func: Nyckel function
        input_dir: Directory containing crop files
    
    Returns:
        List of ClassificationResult objects
    """
    results: List[ClassificationResult] = []
    
    for region_name in REGIONS:
        crop_path = os.path.join(input_dir, f"crop_{region_name}.png")
        
        if not os.path.exists(crop_path):
            print(f"   ⚠️  Missing: {crop_path}")
            continue
        
        print(f"   🔍 Classifying: {region_name}...")
        result = classify_image(func, crop_path, region_name)
        
        if result:
            results.append(result)
            confidence_bar = "█" * int(result.confidence * 10)
            print(f"      → {result.label} ({result.confidence:.1%}) {confidence_bar}")
    
    return results


def save_results(
    results: List[ClassificationResult],
    output_path: str = "temp_analysis/classification_results.json"
) -> None:
    """
    Save classification results to JSON.
    
    Args:
        results: List of classification results
        output_path: Output file path
    """
    output_data = {
        "function_id": FUNCTION_ID,
        "classifications": [asdict(r) for r in results],
        "summary": {
            "total_regions": len(results),
            "regions_by_label": {}
        }
    }
    
    # Count by label
    for r in results:
        label = r.label
        if label not in output_data["summary"]["regions_by_label"]:
            output_data["summary"]["regions_by_label"][label] = []
        output_data["summary"]["regions_by_label"][label].append(r.region)
    
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\n💾 Saved: {output_path}")


def main():
    """Main entry point."""
    print("=" * 60)
    print("🤖 Nyckel Classifier - Comic Book Grading")
    print("=" * 60)
    print()
    
    # Parse arguments
    command = sys.argv[1] if len(sys.argv) > 1 else "classify"
    
    # Get credentials
    try:
        credentials = get_credentials()
        print("✅ Credentials loaded from environment")
    except ValueError as e:
        print(f"❌ {e}")
        sys.exit(1)
    
    if command == "create":
        # Create new function
        name = sys.argv[2] if len(sys.argv) > 2 else "comic-defect-classifier"
        func = create_function(credentials, name)
        print(f"\n💡 Update FUNCTION_ID in script to: {func.function_id}")
    
    elif command == "info":
        # Show function info
        func = get_function(credentials)
        print(f"\n📋 Function Info:")
        print(f"   ID: {func.function_id}")
        print(f"   Name: {func.name}")
        print(f"   Labels: {func.label_count}")
        print(f"   Samples: {func.sample_count}")
        print(f"   Trained: {func.has_trained_model}")
    
    elif command == "train":
        # Add training samples
        if len(sys.argv) < 4:
            print("Usage: python nyckel_classifier.py train <image_path> <label>")
            print(f"\nLabels: {', '.join(DEFAULT_LABELS)}")
            sys.exit(1)
        
        image_path = sys.argv[2]
        label = sys.argv[3]
        
        if not os.path.exists(image_path):
            print(f"❌ File not found: {image_path}")
            sys.exit(1)
        
        if label not in DEFAULT_LABELS:
            print(f"⚠️  Unknown label: {label}")
            print(f"   Available: {', '.join(DEFAULT_LABELS)}")
        
        func = get_function(credentials)
        print(f"\n📚 Adding training sample: {image_path} → {label}")
        
        if add_training_sample(func, image_path, label):
            print("   ✅ Sample added successfully")
            print(f"   📊 Total samples: {func.sample_count}")
    
    elif command == "classify":
        # Classify all regions
        input_dir = sys.argv[2] if len(sys.argv) > 2 else "temp_analysis"
        
        func = get_function(credentials)
        
        if not func.has_trained_model():
            print(f"\n⚠️  Model not trained yet!")
            print(f"   Add training samples with: python nyckel_classifier.py train <image> <label>")
            print(f"   Current samples: {func.sample_count}")
            print(f"\n   Need at least 2 samples per label for training.")
            sys.exit(1)
        
        print(f"\n🔬 Classifying regions from: {input_dir}/")
        results = classify_all_regions(func, input_dir)
        
        if results:
            save_results(results, os.path.join(input_dir, "classification_results.json"))
            
            # Print summary
            print()
            print("=" * 60)
            print("📊 CLASSIFICATION SUMMARY")
            print("=" * 60)
            
            for result in results:
                emoji = "✅" if result.label == "pristine" else "⚠️"
                print(f"   {emoji} {result.region}: {result.label} ({result.confidence:.1%})")
        else:
            print("\n❌ No regions classified. Run glint_analyzer.py first.")
    
    elif command == "test":
        # Test connection
        print("\n🧪 Testing Nyckel connection...")
        try:
            func = get_function(credentials)
            print(f"   ✅ Connection successful!")
            print(f"   📋 Function: {func.name} ({func.function_id})")
            print(f"   📊 Labels: {func.label_count}, Samples: {func.sample_count}")
            print(f"   🎯 Trained: {func.has_trained_model()}")
        except Exception as e:
            print(f"   ❌ Connection failed: {e}")
    
    else:
        print("Usage: python nyckel_classifier.py <command> [args]")
        print()
        print("Commands:")
        print("  test                     Test Nyckel connection")
        print("  info                     Show function details")
        print("  create [name]            Create new classification function")
        print("  train <image> <label>    Add training sample")
        print("  classify [input_dir]     Classify all region crops")
        print()
        print(f"Function ID: {FUNCTION_ID}")
        print(f"Labels: {', '.join(DEFAULT_LABELS)}")


if __name__ == "__main__":
    main()
