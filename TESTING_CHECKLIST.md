# Progressive Analysis Pipeline - Testing Checklist

## Pre-Deployment Checks

- [ ] Supabase `analysis_jobs` table created successfully
- [ ] All environment variables set in Vercel:
  - [ ] `GOOGLE_API_KEY`
  - [ ] `MODAL_CV_WEBHOOK_URL`
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_KEY`
  - [ ] `NEXT_PUBLIC_SUPABASE_URL`
  - [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Code deployed to Vercel (no build errors)
- [ ] Modal worker is running (check Modal dashboard)

---

## Functional Testing

### Test 1: Basic Video Upload & Analysis
**Steps:**
1. Open the app in browser
2. Click "+" button → "Record" tab
3. Capture front cover (optional)
4. Capture back cover (optional)
5. Record 5-10 second video of comic book
6. Stop recording

**Expected Results:**
- [ ] Video uploads without errors
- [ ] Results page opens immediately (not blocked)
- [ ] Within 18-20 seconds: AI results appear (title, grade, reasoning)
- [ ] Purple "CV verification" indicator appears below card
- [ ] Within 40-45 seconds: Golden frames appear
- [ ] Within 40-45 seconds: Grade Scorecard appears
- [ ] CV indicator disappears when complete
- [ ] Final hybrid grade displayed

**Timing Benchmarks:**
- Time to first result (AI): _______ seconds (target: < 20s)
- Total processing time: _______ seconds (target: < 45s)

---

### Test 2: Database State Verification
**Steps:**
1. After completing Test 1, open Supabase SQL Editor
2. Run query:
```sql
SELECT 
  id, 
  status, 
  ai_status, 
  frames_status, 
  cv_status, 
  final_grade,
  created_at,
  ai_completed_at,
  cv_completed_at
FROM analysis_jobs 
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected Results:**
- [ ] Job exists in database
- [ ] `status` = 'complete'
- [ ] `ai_status` = 'complete'
- [ ] `frames_status` = 'complete'
- [ ] `cv_status` = 'complete'
- [ ] `final_grade` has a value (e.g., "9.2")
- [ ] `ai_completed_at` is ~18s after `created_at`
- [ ] `cv_completed_at` is ~40s after `created_at`

---

### Test 3: Error Handling - Unknown Item
**Steps:**
1. Upload a video of something that's NOT a collectible (e.g., your face, a plant)
2. Wait for analysis to complete

**Expected Results:**
- [ ] Phase 1 completes but returns error
- [ ] Error message displayed to user (not a crash)
- [ ] Phase 2 does NOT run
- [ ] Database job status = 'failed' with error message
- [ ] No infinite loading state

---

### Test 4: Concurrent Uploads
**Steps:**
1. Open app in 3 different browser tabs (or 3 devices)
2. Upload 3 different videos simultaneously
3. Monitor all 3 tabs

**Expected Results:**
- [ ] All 3 videos upload successfully
- [ ] All 3 show AI results within 20s
- [ ] All 3 show CV results within 45s
- [ ] No cross-contamination of results
- [ ] Database has 3 separate job records
- [ ] All 3 jobs complete independently

---

### Test 5: Modal Worker Failure
**Steps:**
1. Temporarily disable Modal webhook (set `MODAL_CV_WEBHOOK_URL` to invalid URL)
2. Upload a video
3. Wait for analysis

**Expected Results:**
- [ ] Phase 1 completes successfully (AI results shown)
- [ ] Phase 2 fails gracefully
- [ ] User still sees AI grade and reasoning
- [ ] Console shows warning (not crash)
- [ ] Database shows `ai_status` = 'complete', `cv_status` = 'failed'

---

### Test 6: Network Interruption
**Steps:**
1. Start uploading a video
2. Turn off WiFi mid-upload
3. Turn WiFi back on
4. Complete the upload

**Expected Results:**
- [ ] Upload resumes or shows error (doesn't hang)
- [ ] User gets clear feedback about network issue
- [ ] No orphaned jobs in database

---

## UI/UX Testing

### Visual States
- [ ] **Uploading:** Shows progress bar
- [ ] **Analyzing:** Shows skeleton loaders and spinner
- [ ] **AI Complete:** Shows grade + purple CV indicator
- [ ] **Fully Complete:** Shows all sections without loaders
- [ ] **Error:** Shows clear error message (not blank screen)

### Progressive Disclosure
- [ ] Title appears immediately after AI completes
- [ ] Grade appears immediately after AI completes
- [ ] Reasoning/defects appear immediately after AI completes
- [ ] CV indicator shows while Phase 2 runs
- [ ] Golden frames appear after Phase 2 completes
- [ ] Grade Scorecard appears after Phase 2 completes
- [ ] Hybrid grade replaces AI grade after Phase 2 completes

### Mobile Responsiveness
- [ ] All states work on mobile (iPhone Safari)
- [ ] CV indicator visible and readable on small screens
- [ ] No horizontal scrolling
- [ ] Touch targets are large enough

---

## Performance Testing

### Browser DevTools Timeline
1. Open DevTools → Network tab
2. Upload a video
3. Measure:

- [ ] Video upload time: _______ seconds
- [ ] Time until first API response: _______ seconds
- [ ] Time until AI results render: _______ seconds
- [ ] Time until CV results render: _______ seconds

### Vercel Function Logs
1. Open Vercel dashboard → Functions tab
2. Upload a video
3. Check logs:

- [ ] `[Phase 1]` logs appear
- [ ] `[Phase 2]` logs appear (in parallel)
- [ ] Phase 1 completes before Phase 2
- [ ] No timeout errors
- [ ] No 500 errors

---

## Edge Cases

### Long Videos (>30 seconds)
- [ ] Upload warning shown (if file > 100MB)
- [ ] Analysis still completes (may take longer)
- [ ] No timeout errors

### Poor Quality Video
- [ ] Blurry video: AI returns lower confidence grade
- [ ] Dark video: AI may fail to identify, shows error
- [ ] Shaky video: Modal extracts fewer golden frames

### Multiple Issues on Same Comic
- [ ] All defects detected by AI
- [ ] All regions analyzed by CV
- [ ] Grade reflects cumulative damage

---

## Regression Testing

### Existing Features (Should Still Work)
- [ ] Upload from file (not just camera)
- [ ] Training tab (defect annotation)
- [ ] Saved scans page
- [ ] Grade Rules page
- [ ] History on homepage
- [ ] Thumbnail generation
- [ ] Video playback in results

---

## Acceptance Criteria

All of the following must be true:

- [ ] ✅ Time to first result: < 20 seconds (was 74s)
- [ ] ✅ Total processing time: < 45 seconds (was 74s)
- [ ] ✅ Both phases run in parallel
- [ ] ✅ UI shows progressive states
- [ ] ✅ No quality regression in grading accuracy
- [ ] ✅ Error handling works gracefully
- [ ] ✅ Database tracks job state correctly
- [ ] ✅ Concurrent uploads don't interfere
- [ ] ✅ Mobile experience is smooth
- [ ] ✅ No blocking UI states

---

## Sign-Off

**Tested by:** ___________________  
**Date:** ___________________  
**Build version:** ___________________  
**Status:** [ ] Pass [ ] Fail [ ] Pass with issues  

**Issues found:**
1. 
2. 
3. 

**Notes:**

