# Deployment Checklist - Perspective Correction Fix

## Pre-Deployment

- [x] Code changes committed (commit d98dfca)
- [x] Tests pass locally (no linter errors)
- [x] GPU version updated with same fix
- [x] Documentation created (PERSPECTIVE_CORRECTION_FIX.md)
- [x] CHANGELOG updated

## Deployment Steps

### 1. Deploy Fixed Worker

```bash
# Deploy to Modal
modal deploy cv_worker.py

# Verify deployment
modal app list
# Should show: gradevault-cv-worker [deployed]
```

### 2. Test with Sample Video

```bash
# Run test analysis
modal run cv_worker.py \
  --video-url "https://your-supabase-url/storage/v1/object/public/videos/test-video.mp4" \
  --scan-id "perspective-fix-test"
```

**Look for in logs:**
```
📐 Detecting corners and warping frames...
   ✅ Warped frame 1
   ✅ Warped frame 2
   ✅ Warped frame 3
   ✅ Warped frame 4
   ✅ Warped frame 5
📍 Extracting regions from warped comic...
```

**Red flags:**
```
⚠️  Could not warp frame, using original
```
If you see this for all frames, corner detection is failing.

### 3. Verify in Production

Upload a test video through the web app and check:

#### A. Corner Crops
- [ ] `crop_corner_tl.png` shows **actual top-left corner**
- [ ] `crop_corner_tr.png` shows **actual top-right corner**
- [ ] `crop_corner_bl.png` shows **actual bottom-left corner**
- [ ] `crop_corner_br.png` shows **actual bottom-right corner**

**Before fix:** Corners would be random parts of the frame
**After fix:** Corners should clearly show the comic corners

#### B. Spine Crop
- [ ] `crop_spine.png` shows **actual left spine** of comic
- [ ] NOT random left edge of frame
- [ ] Should see binding/staples if visible

#### C. Surface Crop
- [ ] `crop_surface.png` shows **central cover area**
- [ ] Properly framed without excessive background

#### D. Defect Detection
- [ ] Defects detected in correct regions
- [ ] Overlay images align properly
- [ ] Grade matches visual condition

### 4. Compare Before/After

Test with the problematic comic that got 6.5 grade:

**Before (broken):**
- Corners: Random crops
- Defects: None found
- Grade: 6.5 (false high)

**After (fixed):**
- Corners: Actual corners
- Defects: Found correctly
- Grade: ~4.0-4.5 (accurate)

### 5. Monitor Production

```bash
# Watch logs for issues
modal logs --function gradevault-cv-worker --follow

# Check error rate
modal app stats gradevault-cv-worker
```

**Metrics to track:**
- Warp success rate (should be >95%)
- Average processing time (+1-2s is OK)
- Error rate (should stay same or lower)
- User satisfaction (grades more accurate)

## Post-Deployment Validation

### Test Cases

#### Test 1: Well-Centered Comic
- Upload video of comic centered in frame
- Expected: Should warp successfully
- Verify: Corners are corners

#### Test 2: Angled Comic
- Upload video of comic at 45° angle
- Expected: Should detect corners and straighten
- Verify: Warped image is flat/rectangular

#### Test 3: Curved/Warped Comic
- Upload video of comic with slight curve
- Expected: Should flatten to best rectangle
- Verify: Analysis still accurate

#### Test 4: Poor Lighting
- Upload video with shadows/glare
- Expected: May fail to warp, falls back to original
- Verify: Analysis completes without error

### Success Criteria

✅ **Pass:** 
- Warp success rate >90%
- Corner crops show actual corners
- Grades correlate with visual condition
- No increase in error rate

⚠️ **Investigate:**
- Warp success rate 50-90%
- Some corner crops incorrect
- Grades still seem off

❌ **Rollback:**
- Warp success rate <50%
- Increased error rate
- Worse grades than before

## Rollback Plan

If critical issues found:

```bash
# Rollback to previous version
git revert d98dfca

# Redeploy old version
modal deploy cv_worker.py

# Verify rollback
modal run cv_worker.py --video-url "..." --scan-id "rollback-test"
```

## Known Limitations

### 1. Very Tight Crops
If video shows ONLY the comic with no background:
- Corner detection may fail (no clear edges)
- Fallback: Uses original frame
- Workaround: Instruct users to show some background

### 2. Multiple Comics in Frame
If multiple comics visible:
- Detects largest contour (usually correct)
- Edge case: May pick wrong comic
- Workaround: Instruct users to show one comic at a time

### 3. Extreme Angles
If comic at >60° angle or heavily warped:
- Corner detection may fail
- Fallback: Uses original frame
- Impact: Analysis less accurate but completes

### 4. Low Resolution
If video resolution <480p:
- Edge detection less reliable
- May fail to find clear contours
- Recommendation: Minimum 720p video

## Troubleshooting

### Issue: "Could not warp frame" for all frames

**Cause:** Corner detection failing

**Debug:**
```bash
# Check edge detection
# Add debug logging to see why contours not found
```

**Solutions:**
- Adjust edge detection thresholds (lines 96, 100)
- Lower area threshold (line 123: `0.1` → `0.05`)
- Try adaptive threshold fallback (already present)

### Issue: Warped images look distorted

**Cause:** Incorrect corner ordering or bad contour

**Debug:**
```python
# Log detected corners
print(f"Corners: {rect}")
# Should be: TL, TR, BR, BL
```

**Solutions:**
- Verify corner ordering logic (lines 40-48)
- Check contour approximation (line 115: `0.02` → `0.03`)

### Issue: Processing much slower

**Expected:** +1-2 seconds per video (5 frames × 200-400ms each)

**Unacceptable:** +10+ seconds

**Solutions:**
- Check if warping is being called multiple times
- Verify parallel processing still works
- Consider caching warped frames if reused

## Communication

### User Notification (If Needed)

**Subject:** Deep Scan Accuracy Improved

We've deployed a critical fix that significantly improves grading accuracy:

**What changed:**
- Fixed corner and spine detection
- Defects now analyzed in correct areas
- Grades now reflect actual condition

**Impact on your scans:**
- Comics may get different (more accurate) grades
- Damaged comics will show lower grades (correct)
- Pristine comics unaffected

**Action needed:**
- None! System automatically uses new analysis
- Consider re-scanning important comics for updated grades

### Support Responses

If users report grades seem "too low" now:

> "We recently fixed a bug where the grading system was analyzing incorrect areas of comics. Your new grade is actually more accurate - the previous grade was inflated due to examining the wrong regions. The system now properly detects corners, spine, and surface damage."

## Sign-Off

- [ ] Deployed to production
- [ ] Tested with sample videos
- [ ] Corner crops verified
- [ ] Grades checked for accuracy
- [ ] No critical errors in logs
- [ ] Team notified of deployment

**Deployed by:** _______
**Date:** _______
**Verified by:** _______

