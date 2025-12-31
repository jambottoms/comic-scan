# Phase 2 Progress Polling Fix - Mobile iOS Safari

**Date:** 2025-12-30  
**Issue:** Phase 2 (CV Analysis) loads indefinitely with no progress updates on mobile iOS Safari via Vercel.

## Root Cause

The progress polling system was never starting because of a critical missing link between the database status and the UI state:

1. **Phase 2 Server Action** updated the Supabase database `status` field to `'cv_processing'`
2. **BUT** the localStorage `_status` field (used by UI components) was NEVER updated to match
3. **Result:** The `StreamingResultCard` polling trigger condition (`status === 'cv_processing'`) was never satisfied
4. **Therefore:** Progress polling never started, and the UI showed indefinite loading

## The Missing Link

The app uses two separate storage systems:
- **Supabase Database**: Server-side source of truth (updated by Server Actions)
- **localStorage**: Client-side cache (used by UI components for immediate reactivity)

There was NO mechanism to sync the database `status='cv_processing'` to localStorage `_status='cv_processing'` when Phase 2 started.

## Solution

### 1. Create Status Sync Function
Added `updateWithCVProcessing()` to `lib/streaming-analysis.ts`:
```typescript
export function updateWithCVProcessing(historyId: string): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  updateHistoryEntry(historyId, {
    result: {
      ...entry.result,
      _status: 'cv_processing', // Set status to trigger polling
    },
  });
  
  // Dispatch event for UI update
  dispatchUpdate(historyId, { status: 'cv_processing' });
}
```

### 2. Call Immediately When Phase 2 Starts
Modified `components/GradeBookModal.tsx` to call the sync function BEFORE starting Phase 2:
```typescript
console.log('[MOBILE DEBUG] Starting Phase 2 for job:', historyId);
// CRITICAL: Update localStorage status IMMEDIATELY so polling starts
updateWithCVProcessing(historyId);

const phase2Promise = analyzePhase2({
  videoUrl: videoUpload.url,
  jobId: historyId,
  itemType: 'comic',
});
```

### 3. Initialize Database Status Early
Modified `app/actions/analyze-phase-2.ts` to set BOTH database fields immediately:
```typescript
// Update status at the START of Phase 2 (critical for mobile polling)
await supabase.from('analysis_jobs').update({
  frames_status: 'processing',
  cv_status: 'processing', // Set cv_status immediately so polling starts!
  status: 'cv_processing', // Also update main status field
  progress_percentage: 0, // Initialize progress
  progress_message: 'Initializing CV analysis...',
  progress_step: 'init',
  updated_at: new Date().toISOString()
}).eq('id', jobId);
```

### 4. Enhanced Mobile Debugging
Added visible on-screen debug info in `components/analysis/CVAnalysisCard.tsx`:
```typescript
{/* Mobile Debug Info - Visible on screen */}
<div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 font-mono">
  <div>Status: {status}</div>
  <div>Polling: {isProcessing && !isComplete ? 'ENABLED' : 'DISABLED'}</div>
  <div>JobID: {historyId?.slice(0, 20)}...</div>
  <div>Progress: {progress.percentage}% | {progress.step}</div>
  <div>Message: {progress.message}</div>
</div>
```

### 5. Improved Progress Polling Logging
Enhanced `lib/use-progress-polling.ts` to log structured progress data:
```typescript
console.log('[Progress Poll] Data received:', {
  percentage: data.progress_percentage,
  message: data.progress_message,
  step: data.progress_step,
  cv_status: data.cv_status,
  status: data.status
});
```

## Files Changed

1. **`lib/streaming-analysis.ts`**: Added `updateWithCVProcessing()` function
2. **`components/GradeBookModal.tsx`**: 
   - Import and call `updateWithCVProcessing()` 
   - Added debug logging for Phase 2
3. **`app/actions/analyze-phase-2.ts`**: Initialize all status fields at Phase 2 start
4. **`components/analysis/CVAnalysisCard.tsx`**: 
   - Import `useEffect` 
   - Add mobile debug UI
5. **`lib/use-progress-polling.ts`**: Enhanced logging

## How It Works Now

1. User uploads video → Phase 1 (AI) starts
2. Phase 2 (CV) starts in parallel:
   - ✅ **`updateWithCVProcessing()`** called → sets localStorage `_status='cv_processing'` + dispatches event
   - ✅ UI receives event → updates `status` state to `'cv_processing'`
   - ✅ Polling trigger condition satisfied → `useProgressPolling()` starts polling
   - ✅ Database status initialized → `status='cv_processing'`, `progress_percentage=0`
3. Modal CV worker runs:
   - Updates database `progress_percentage` from 0 → 100
   - Polling hook detects changes every 1 second
4. Modal completes:
   - Phase 2 continues with Gemini multi-frame analysis
   - Final status updated to `'complete'`

## Testing

To verify the fix on iOS Safari mobile:
1. Open Vercel deployment on iPhone
2. Upload and scan a comic
3. After Phase 1 completes, check the CV Analysis Card
4. **Expected:** Debug info shows `Status: cv_processing`, `Polling: ENABLED`
5. **Expected:** Progress percentage updates from 0% → 100% in real-time
6. **Expected:** No indefinite loading

## Related Issues

- Previous fix: Added 5-minute timeout to prevent infinite hanging (PHASE2_FIX_SUMMARY.md)
- Previous fix: Mobile progress polling optimizations (MOBILE_FIXES_SUMMARY.md)

This fix addresses the core synchronization issue that prevented those optimizations from working.

