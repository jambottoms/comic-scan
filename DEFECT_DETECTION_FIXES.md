# Deep Scan Defect Detection - Critical Issues & Fixes

## 🔴 Problems Identified

### 1. **CV Results Not Fully Saved**
The `updateWithCVResult()` function in `lib/streaming-analysis.ts` is NOT saving:
- `damageScore` (overall 0-100 damage rating)
- `regionScores` (per-region damage scores)
- `regionDetails` (detailed metrics)
- `defectOverlay` (visual defect overlay)

**Current (lines 104-128):**
```typescript
updateHistoryEntry(historyId, {
  result: {
    ...entry.result,
    goldenFrames: cvResult.goldenFrames,
    defectMask: cvResult.defectMask,
    varianceHeatmap: cvResult.varianceHeatmap,
    regionCrops: cvResult.regionCrops,
    defectPercentage: cvResult.defectPercentage,  // ✅ Saved
    // ❌ damageScore NOT saved!
    // ❌ regionScores NOT saved!
    // ❌ regionDetails NOT saved!
    // ❌ defectOverlay NOT saved!
  },
});
```

**Fix:**
```typescript
updateHistoryEntry(historyId, {
  result: {
    ...entry.result,
    goldenFrames: cvResult.goldenFrames,
    defectMask: cvResult.defectMask,
    varianceHeatmap: cvResult.varianceHeatmap,
    defectOverlay: cvResult.defectOverlay,        // ✅ ADD THIS
    regionCrops: cvResult.regionCrops,
    defectPercentage: cvResult.defectPercentage,
    damageScore: cvResult.damageScore,             // ✅ ADD THIS
    regionScores: cvResult.regionScores,           // ✅ ADD THIS
    regionDetails: cvResult.regionDetails,         // ✅ ADD THIS
  },
});
```

### 2. **Defect Detection Threshold Too High**
Line 398 in `cv_worker.py`:
```python
defect_threshold = 0.25  # 25% of max combined score
```

This is TOO high and misses subtle but important damage. For a book in "bad shape", this would only detect very severe damage.

**Problem:**
- Creases that catch light: Missed
- Minor tears: Missed
- Surface wear: Missed
- Corner dings: Missed
- Only detects: Severe tears, major folds

**Fix:**
```python
# Adaptive threshold based on score distribution
defect_mean = np.mean(defect_score_map)
defect_std = np.std(defect_score_map)
defect_threshold = defect_mean + (1.5 * defect_std)  # More sensitive

# OR use multiple thresholds for severity levels
threshold_minor = 0.10    # Minor defects (10%)
threshold_moderate = 0.20  # Moderate defects (20%)
threshold_severe = 0.35    # Severe defects (35%)
```

### 3. **Single Frame Primary Analysis**
The enhanced algorithm only uses ONE frame for most analysis:
```python
# Line 321
reference = frames[0]  # Only using first (sharpest) frame!
```

**Problem:**
- Doesn't leverage multiple viewing angles
- Misses defects that only show up in certain lighting
- Variance analysis (which needs multiple frames) is underweighted

**Fix:**
- Analyze ALL 5 golden frames
- Create per-frame defect maps
- Combine using MAX or MEAN
- Defects visible in ANY frame should be detected

### 4. **Defect Overlay Not Uploaded**
Line 571 in `cv_worker.py` (`upload_results` function):
```python
# Upload defect mask
if analysis.get("defect_mask_path"):
    result["defectMask"] = upload_to_supabase_storage(...)

# Upload variance heatmap  
if analysis.get("variance_heatmap_path"):
    result["varianceHeatmap"] = upload_to_supabase_storage(...)

# ❌ defect_overlay_path is NOT uploaded!
```

**Fix:**
```python
# Upload defect overlay
if analysis.get("defect_overlay_path"):
    remote_path = f"{scan_id}/defect_overlay.png"
    with open(analysis["defect_overlay_path"], 'rb') as f:
        file_data = f.read()
    result["defectOverlay"] = upload_to_supabase_storage(
        supabase_url, supabase_key, bucket, remote_path, file_data
    )
```

### 5. **No Integration with AI Grading**
The CV analysis runs but doesn't influence the grade!

**Current Flow:**
```
AI Analysis (Gemini) → Grade assigned
   ↓
CV Analysis runs → Detailed defect scores calculated
   ↓
Grade NOT updated! ❌
```

**Should be:**
```
AI Analysis (Gemini) → Initial grade assigned
   ↓
CV Analysis runs → Detailed defect scores calculated
   ↓
Grade adjusted based on CV findings ✅
   - High damage score → Downgrade
   - Perfect CV scan + high AI grade → Confirm grade
   - Mismatch → Flag for review
```

## 🔧 Complete Fix Plan

### Priority 1: Save All CV Results (CRITICAL)

**File: `lib/streaming-analysis.ts` (lines 104-128)**

```typescript
export function updateWithCVResult(historyId: string, cvResult: any): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  updateHistoryEntry(historyId, {
    result: {
      ...entry.result,
      // Frame data
      goldenFrames: cvResult.goldenFrames,
      frameTimestamps: cvResult.frameTimestamps,
      
      // Defect visualizations
      defectMask: cvResult.defectMask,
      varianceHeatmap: cvResult.varianceHeatmap,
      defectOverlay: cvResult.defectOverlay,  // ✅ ADD
      
      // Region data
      regionCrops: cvResult.regionCrops,
      
      // Defect metrics
      defectPercentage: cvResult.defectPercentage,
      damageScore: cvResult.damageScore,       // ✅ ADD
      regionScores: cvResult.regionScores,     // ✅ ADD
      regionDetails: cvResult.regionDetails,   // ✅ ADD
      
      _status: 'complete',
    },
  });
  
  // Dispatch event with ALL CV data
  dispatchUpdate(historyId, { 
    status: 'complete',
    goldenFrames: cvResult.goldenFrames,
    defectMask: cvResult.defectMask,
    defectOverlay: cvResult.defectOverlay,
    damageScore: cvResult.damageScore,
    regionScores: cvResult.regionScores,
    regionCrops: cvResult.regionCrops,
  });
}
```

### Priority 2: Lower Defect Threshold & Multi-Frame Analysis

**File: `cv_worker.py` (lines 293-523)**

```python
def run_glint_analysis(golden_frames: list, output_dir: str) -> dict:
    """
    Enhanced multi-frame defect analysis.
    Analyzes ALL frames to catch defects visible in any lighting/angle.
    """
    import cv2
    import numpy as np
    from scipy import ndimage
    
    if len(golden_frames) < 1:
        return {"error": "Need at least 1 frame for analysis"}
    
    # Load all frames
    frames = []
    for gf in golden_frames:
        img = cv2.imread(gf['path'])
        if img is not None:
            frames.append(img)
    
    if len(frames) < 1:
        return {"error": "Could not load frames"}
    
    # Ensure all frames same size
    reference_shape = frames[0].shape
    frames = [f for f in frames if f.shape == reference_shape]
    h, w = frames[0].shape[:2]
    output_path = Path(output_dir)
    
    # =========================================
    # ANALYZE ALL FRAMES (not just first!)
    # =========================================
    frame_defect_maps = []
    
    for idx, frame in enumerate(frames):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_float = gray.astype(np.float32)
        
        # Multi-scale edge detection
        edges_fine = cv2.Canny(gray, 20, 80)       # MORE SENSITIVE
        edges_medium = cv2.Canny(gray, 40, 120)
        edges_strong = cv2.Canny(gray, 70, 180)
        edge_combined = (edges_fine * 0.4 + edges_medium * 0.4 + edges_strong * 0.2).astype(np.float32)
        
        # Texture analysis
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        laplacian_abs = np.abs(laplacian)
        
        sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        sobel_magnitude = np.sqrt(sobel_x**2 + sobel_y**2)
        
        # Local texture variation
        kernel_size = 5
        local_mean = ndimage.uniform_filter(gray_float, size=kernel_size)
        local_sqr_mean = ndimage.uniform_filter(gray_float**2, size=kernel_size)
        local_std = np.sqrt(np.maximum(local_sqr_mean - local_mean**2, 0))
        
        # Normalize
        def safe_normalize(arr):
            arr_max = arr.max()
            return arr / arr_max if arr_max > 0 else arr
        
        edge_norm = safe_normalize(edge_combined)
        laplacian_norm = safe_normalize(laplacian_abs)
        sobel_norm = safe_normalize(sobel_magnitude)
        texture_norm = safe_normalize(local_std)
        
        # Per-frame defect score
        frame_defect_score = (
            edge_norm * 0.35 +
            laplacian_norm * 0.25 +
            sobel_norm * 0.25 +
            texture_norm * 0.15
        )
        
        frame_defect_maps.append(frame_defect_score)
    
    # =========================================
    # COMBINE ALL FRAMES - MAX POOLING
    # =========================================
    # If a defect appears in ANY frame, it's real
    combined_defect_map = np.maximum.reduce(frame_defect_maps)
    
    # Also compute variance across frames
    if len(frames) >= 2:
        gray_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]
        stack = np.stack(gray_frames, axis=0)
        variance_map = np.var(stack, axis=0)
        variance_norm = safe_normalize(variance_map)
        
        # Blend with variance (creases catch light differently)
        combined_defect_map = combined_defect_map * 0.85 + variance_norm * 0.15
    
    # =========================================
    # ADAPTIVE THRESHOLDING
    # =========================================
    # Use statistical threshold, not fixed
    mean_score = np.mean(combined_defect_map)
    std_score = np.std(combined_defect_map)
    
    # Three severity levels
    threshold_minor = mean_score + (0.5 * std_score)    # Very sensitive
    threshold_moderate = mean_score + (1.5 * std_score)  # Medium
    threshold_severe = mean_score + (2.5 * std_score)    # Severe only
    
    # Create multi-level masks
    defect_minor = (combined_defect_map > threshold_minor).astype(np.uint8) * 255
    defect_moderate = (combined_defect_map > threshold_moderate).astype(np.uint8) * 255
    defect_severe = (combined_defect_map > threshold_severe).astype(np.uint8) * 255
    
    # Use moderate as primary mask
    defect_mask = defect_moderate.copy()
    
    # Morphological cleanup
    kernel = np.ones((3, 3), np.uint8)
    defect_mask = cv2.morphologyEx(defect_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    defect_mask = cv2.morphologyEx(defect_mask, cv2.MORPH_OPEN, kernel)
    
    # [Rest of region analysis continues...]
    # [Use combined_defect_map for scoring]
```

### Priority 3: Upload Defect Overlay

**File: `cv_worker.py` (lines 571+)**

Add after variance heatmap upload:

```python
# Upload defect overlay
if analysis.get("defect_overlay_path"):
    remote_path = f"{scan_id}/defect_overlay.png"
    with open(analysis["defect_overlay_path"], 'rb') as f:
        file_data = f.read()
    result["defectOverlay"] = upload_to_supabase_storage(
        supabase_url, supabase_key, bucket, remote_path, file_data
    )
    print(f"   ✅ Uploaded defect overlay")
```

### Priority 4: Grade Integration Logic

**New File: `lib/grade-adjustment.ts`**

```typescript
/**
 * Adjust grade based on CV analysis results.
 * Returns updated grade and explanation.
 */
export function adjustGradeWithCVAnalysis(
  aiGrade: string,
  damageScore: number,
  regionScores: Record<string, number>
): { grade: string; adjustment: string | null } {
  
  // Extract numeric grade from AI (e.g., "9.4" from "Near Mint 9.4")
  const gradeMatch = aiGrade.match(/(\d+\.?\d*)/);
  const numericGrade = gradeMatch ? parseFloat(gradeMatch[1]) : null;
  
  if (!numericGrade) return { grade: aiGrade, adjustment: null };
  
  // Check for severe mismatches
  const highGrade = numericGrade >= 8.5;  // Near Mint or better
  const highDamage = damageScore >= 40;    // Significant damage detected
  
  // Critical regions (corners, spine)
  const criticalRegions = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'spine'];
  const criticalDamage = criticalRegions.some(r => (regionScores[r] || 0) >= 50);
  
  // Adjustment logic
  if (highGrade && (highDamage || criticalDamage)) {
    // AI says high grade but CV finds significant damage
    const adjustedGrade = Math.max(numericGrade - 1.5, 5.0);
    return {
      grade: formatGrade(adjustedGrade),
      adjustment: `Downgraded from ${aiGrade} due to CV-detected damage (score: ${damageScore.toFixed(1)})`
    };
  }
  
  if (numericGrade >= 7.0 && damageScore >= 30) {
    // Moderate grade with moderate damage
    const adjustedGrade = numericGrade - 0.5;
    return {
      grade: formatGrade(adjustedGrade),
      adjustment: `Minor adjustment for detected wear (damage score: ${damageScore.toFixed(1)})`
    };
  }
  
  // No adjustment needed
  return { grade: aiGrade, adjustment: null };
}

function formatGrade(numeric: number): string {
  if (numeric >= 9.8) return `Gem Mint ${numeric.toFixed(1)}`;
  if (numeric >= 9.0) return `Mint ${numeric.toFixed(1)}`;
  if (numeric >= 8.0) return `Near Mint ${numeric.toFixed(1)}`;
  if (numeric >= 6.5) return `Fine ${numeric.toFixed(1)}`;
  if (numeric >= 4.5) return `Very Good ${numeric.toFixed(1)}`;
  return `Good ${numeric.toFixed(1)}`;
}
```

## 🧪 Testing Protocol

### Test 1: Verify CV Results Saved
1. Upload video
2. Wait for deep scan
3. Check browser console: `JSON.parse(localStorage.getItem('scan-history'))`
4. Verify result includes `damageScore`, `regionScores`, `defectOverlay`

### Test 2: Damaged Book Detection
1. Upload video of book in "bad shape"
2. Check Modal logs for: `📊 Overall Damage Score: XX/100`
3. Verify score is > 30 (not 0)
4. Check defect overlay shows red highlights on damage

### Test 3: Grade Adjustment
1. Upload damaged book
2. AI assigns grade (e.g., "8.5")
3. CV detects damage (score > 40)
4. Grade should adjust down to ~7.0
5. Adjustment message should appear in UI

## 📊 Expected Results After Fixes

**Before:**
- Damage Score: 0.0 (for damaged book) ❌
- Region Scores: Not visible ❌
- Grade: Not adjusted ❌
- Defect Overlay: Not showing ❌

**After:**
- Damage Score: 35-65 (for damaged book) ✅
- Region Scores: Visible with color coding ✅
- Grade: Adjusted down if mismatch ✅
- Defect Overlay: Shows red highlights on damage ✅

## 🚀 Implementation Order

1. **Fix 1** (5 min): Add missing fields to `streaming-analysis.ts`
2. **Fix 2** (10 min): Lower threshold & multi-frame analysis in `cv_worker.py`
3. **Fix 3** (2 min): Upload defect overlay in `cv_worker.py`
4. **Deploy** (2 min): `modal deploy cv_worker.py`
5. **Test** (10 min): Upload damaged book and verify results
6. **Fix 4** (15 min): Implement grade adjustment logic
7. **Final Test** (10 min): End-to-end test with grade adjustment

**Total Time:** ~1 hour to make deep scan actually useful!

## 📝 Summary

The deep scan IS detecting defects (the code is there), but the results aren't being **saved, displayed, or used**. These fixes will:

✅ Save all CV metrics
✅ Make detection more sensitive
✅ Show defect overlays in UI
✅ Adjust grades based on CV findings
✅ Provide real value for grading accuracy

