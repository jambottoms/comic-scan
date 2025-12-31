# Grading System Improvements - Implementation Summary

## 🎯 Overview

We've implemented major improvements to fix the grading accuracy issues you reported, where all regions were returning 10.0 and the fusion grades were inconsistent.

---

## ✅ Changes Made

### 1. **Object Detection Before Region Extraction** ✅ 
**Problem:** The CV pipeline was analyzing the edges of the video frame, not the comic itself.

**Solution:** Added `detect_comic_boundaries()` function that uses edge detection to find the comic book within the frame before extracting regions.

**File:** `cv_worker.py`
```python
def detect_comic_boundaries(frame):
    """Detects the comic book object using edge detection"""
    # Uses Canny edge detection + contour finding
    # Returns (x, y, w, h) bounding box
    # Validates: comic must be at least 30% of frame
```

**Impact:** Region crops now analyze the **actual comic**, not background/edges.

---

### 2. **Debug Visualizations** ✅
**Problem:** No way to see what regions were being analyzed.

**Solution:** Added `create_debug_visualization()` that draws:
- Green rectangle around detected comic
- Colored rectangles for each region (spine=blue, corners=yellow/magenta/orange/cyan, surface=purple)
- Region labels

**File:** `cv_worker.py`

**Output:** A debug image is uploaded to Supabase at `{scan_id}/debug_regions.png` showing:
- Whether the comic was detected or if it's using the full frame
- Exact region boundaries being analyzed

**Access:** This image is included in `cvAnalysis.images.debugVisualization` in the analysis result.

---

### 3. **Confidence Threshold & Debug Logging** ✅
**Problem:** Nyckel was returning default/untrained labels with 100% confidence, leading to all 10.0 grades.

**Solution:** 
- Added confidence threshold (< 30% = fallback to 5.5 grade)
- Added debug logging to see what Nyckel actually returns
- Better error handling for untrained models

**File:** `cv_worker.py` - Line 310-323
```python
# DEBUG: Log what Nyckel is returning
print(f"      DEBUG {region_name}: label={label}, confidence={confidence:.2f}, grade={grade}")

# IMPORTANT: If confidence is too low, don't trust the result
if confidence < 0.3:
    print(f"      ⚠️ Low confidence ({confidence:.2f}) for {region_name}, using fallback grade")
    grade = 5.5
    label = "uncertain"
```

---

### 4. **Grade/Condition Training Labels** ✅
**Problem:** No way to train the region grading classifier with proper condition labels.

**Solution:** Added a new "Grade/Condition" section in the Train AI tab with 6 labels:
- **pristine** (10.0)
- **near_mint** (9.2)
- **minor_wear** (7.5)
- **moderate_wear** (5.5)
- **heavy_wear** (3.5)
- **damaged** (2.0)

**File:** `components/GradeBookModal.tsx`

**Usage:** 
1. Tap "Train AI"
2. Take photo of comic
3. Crop to specific region (e.g., spine)
4. Select condition label (e.g., "heavy_wear")
5. Submit → Trains Nyckel Region Function

---

### 5. **Static Photo Region Training Infrastructure** ✅
**Problem:** Video frames have motion blur and are low quality for training.

**Solution:** Created `train-from-static-photo.ts` server action that:
- Accepts high-quality static photos (front/back/spine)
- Detects comic boundaries
- Extracts region crops (spine, corners, surface)
- Uploads to Nyckel with labels

**File:** `app/actions/train-from-static-photo.ts`

**Future:** This can be integrated to automatically extract training samples from user-provided static photos during analysis.

---

## 📊 Key Technical Details

### Region Definitions (cv_worker.py)
```python
REGIONS = {
    "spine": {"x_start": 0.0, "x_end": 0.08, "y_start": 0.0, "y_end": 1.0},
    "corner_tl": {"x_start": 0.0, "x_end": 0.15, "y_start": 0.0, "y_end": 0.12},
    "corner_tr": {"x_start": 0.85, "x_end": 1.0, "y_start": 0.0, "y_end": 0.12},
    "corner_bl": {"x_start": 0.0, "x_end": 0.15, "y_start": 0.88, "y_end": 1.0},
    "corner_br": {"x_start": 0.85, "x_end": 1.0, "y_start": 0.88, "y_end": 1.0},
    "surface": {"x_start": 0.20, "x_end": 0.80, "y_start": 0.20, "y_end": 0.80}
}
```

### Grade Label Mapping (cv_worker.py)
```python
LABEL_TO_GRADE = {
    "pristine": 10.0,
    "near_mint": 9.2,
    "minor_wear": 7.5,
    "moderate_wear": 5.5,
    "heavy_wear": 3.5,
    "damaged": 2.0,
}
```

---

## 🚀 Next Steps - ACTION REQUIRED

### 1. **Deploy Updated CV Worker** ⚠️
```bash
cd /Users/ojhornung/comic-scan
modal deploy cv_worker.py
```

This is **CRITICAL** - none of the CV improvements will work until you deploy.

### 2. **Train Your Nyckel Region Function** ⚠️
Your Nyckel Region Function (`NYCKEL_REGION_FUNCTION_ID`) appears to be **untrained or under-trained**, which is why everything returns 10.0.

**Training Process:**
1. Open your app
2. Tap FAB → "Train AI"
3. Take a photo of a comic region (e.g., a worn spine)
4. Crop to JUST that region (zoom in close)
5. Select the condition (e.g., "heavy_wear")
6. Submit
7. Repeat **20-50 times per label** for best results

**Training Tips:**
- **Variety:** Different lighting, angles, comic types
- **Accuracy:** Crop tightly to the region you're labeling
- **Balance:** Try to get similar numbers of each condition
- **Focus on extremes first:** pristine and damaged are easiest to identify

### 3. **Check Debug Visualization**
After your next analysis:
1. Open the grade results
2. Look for the debug visualization image (should be in CV analysis section)
3. Verify:
   - Green box is around the comic (not edges)
   - Region boxes are positioned correctly on the comic

---

## 🔍 Troubleshooting

### All regions still returning 10.0?
**Cause:** Nyckel Region Function is not trained yet.
**Fix:** Train the model as described above (20-50 samples per label).

### AI grade is 0 but comic is not worthless?
**Cause:** AI analysis prompt or Gemini interpretation issue.
**Investigation:** Check the AI analysis text in the Grade Results. Does it describe the comic accurately?
**Potential Fix:** May need to adjust the Gemini prompt in `analyze-phase-1.ts`.

### Spine grade way off?
**Cause 1:** Object detection failed, analyzing frame edge instead.
**Fix:** Check debug visualization to confirm comic detection worked.

**Cause 2:** Spine region definition is incorrect for your use case.
**Fix:** Adjust spine region in `cv_worker.py` REGIONS dict (currently leftmost 8% of comic).

### CV grade 0.5 but looks better?
**Cause:** Nyckel returning very low confidence labels or "damaged" for uncertain regions.
**Fix:** Train more samples, especially in the middle ranges (minor_wear, moderate_wear).

---

## 📝 Answers to Your Questions

### Q1: Can we use static photos to train regions better?
**Answer:** YES! ✅

**Benefits:**
- Better quality (no motion blur)
- User can frame specific regions
- Already integrated in Phase 1

**Implementation:**
- Infrastructure is ready (`train-from-static-photo.ts`)
- Can be automated or manual via Train AI tab
- Static photos → better training data → better grades

### Q2: Do I need a new Nyckel bucket?
**Answer:** NO! ✅

**Existing Setup:**
- `NYCKEL_DEFECT_FUNCTION_ID` - For defect classification (already working)
- `NYCKEL_REGION_FUNCTION_ID` - For region grading (needs training)
- Supabase `training-data` bucket - Already exists

**What you need to do:**
- Just train the REGION function with the new grade labels
- The infrastructure is all set up

---

## 🎓 Understanding "Regions" vs "Fusion"

### Regions Tab
**Data Source:** Nyckel ML Region Classifier (`NYCKEL_REGION_FUNCTION_ID`)

**What it shows:**
- Individual grade for each region (spine, corners, surface)
- Based on cropped region images analyzed by ML
- Each region gets a label (pristine, near_mint, etc.) → converted to grade (10.0, 9.2, etc.)

**Current Issue:** Returning all 10.0 because model is untrained.

### Fusion Tab
**Data Source:** Combines AI + CV + Nyckel grades

**What it shows:**
- AI Grade: From Gemini video analysis (Phase 1)
- CV Grade: Average of all Nyckel region grades (Phase 2)
- Final Grade: Weighted fusion of AI + CV
- Agreement: How close AI and CV grades are

**Current Issue:** 
- CV = 0.5 (likely from low-confidence Nyckel results)
- AI = 0 (Gemini interpretation issue?)
- Fusion confused by conflicting inputs

---

## 🔧 Files Modified

1. **cv_worker.py** - Core CV analysis
   - Added object detection
   - Added debug visualization
   - Added confidence threshold
   - Enhanced logging

2. **components/GradeBookModal.tsx** - Train AI UI
   - Added GRADE_LABELS
   - Added Grade/Condition section
   - Updated submit logic

3. **app/actions/train-from-static-photo.ts** - NEW
   - Server action for static photo training
   - Region extraction from photos
   - Nyckel integration

---

## 📈 Expected Results After Training

With **20-50 training samples per grade label**, you should see:

### Regions Tab ✅
- Spine: 3.5 (heavy_wear) - if worn spine
- Corner TL: 9.2 (near_mint) - if pristine corner
- Corner TR: 7.5 (minor_wear) - if slight damage
- Surface: 8.0+ (near_mint) - if clean
- etc.

### Fusion Tab ✅
- AI Grade: 7.5 (from Gemini analysis)
- CV Grade: 7.2 (average of region grades)
- Agreement: Strong (Δ0.3)
- Final Grade: 7.3 (fused)

---

## 💡 Pro Tips

1. **Train incrementally:** Add 5-10 samples, run analysis, see if it improved, repeat
2. **Use debug viz:** Always check if object detection worked
3. **Static photos are key:** Use the front/back/spine photos for best training data
4. **Log everything:** Check terminal output for Nyckel responses (DEBUG lines)
5. **Confidence matters:** Low confidence = model is guessing = needs more training

---

**Questions or issues?** Check the debug logs in the terminal when you run an analysis!

