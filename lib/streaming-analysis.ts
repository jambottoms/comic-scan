/**
 * Streaming Analysis Manager
 * 
 * Manages the progressive loading of analysis results.
 * Creates a pending result immediately, then updates as data arrives.
 */

import { addToHistory, updateHistoryEntry, getVideoById } from './history';
import { adjustGradeWithCVAnalysis } from './grade-adjustment';

export interface PendingResult {
  id: string;
  status: 'uploading' | 'analyzing' | 'cv_processing' | 'complete' | 'error';
  videoUrl: string | null;
  thumbnail: string | null;
  title: string | null;
  issue: string | null;
  grade: string | null;
  itemType: string | null;
  reasoning: string | null;
  goldenFrames: string[] | null;
  defectMask: string | null;
  regionCrops: Record<string, string> | null;
  error: string | null;
  createdAt: number;
}

/**
 * Create a pending result entry immediately after video capture.
 * This allows showing the grade card right away with loading states.
 */
export function createPendingResult(thumbnail: string | null): string {
  const historyId = addToHistory({
    title: "Analyzing...",
    issue: "",
    grade: "...",
    videoUrl: null,
    result: {
      _pending: true,
      _status: 'uploading',
      title: null,
      issue: null,
      estimatedGrade: null,
      reasoning: null,
    },
    thumbnail: thumbnail || undefined,
  });
  
  return historyId;
}

/**
 * Update the pending result with upload completion.
 */
export function updateWithVideoUrl(historyId: string, videoUrl: string): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  updateHistoryEntry(historyId, {
    videoUrl,
    result: {
      ...entry.result,
      _status: 'analyzing',
    },
  });
  
  // Dispatch event for UI update
  dispatchUpdate(historyId, { status: 'analyzing', videoUrl });
}

/**
 * Update the pending result with AI analysis results.
 * Marks as complete since frame extraction happens client-side (fast).
 */
export function updateWithAIResult(historyId: string, aiResult: any): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  updateHistoryEntry(historyId, {
    title: aiResult.title || "Unknown Item",
    issue: aiResult.issue || "",
    grade: aiResult.estimatedGrade || "N/A",
    result: {
      ...entry.result,
      ...aiResult,
      _pending: false,
      _status: 'complete', // Mark complete - frame extraction is fast & client-side
    },
  });
  
  // Dispatch event for UI update
  dispatchUpdate(historyId, { 
    status: 'complete', 
    title: aiResult.title,
    issue: aiResult.issue,
    grade: aiResult.estimatedGrade,
    reasoning: aiResult.reasoning,
    itemType: aiResult.itemType,
  });
}

/**
 * Update the pending result with CV analysis results.
 * Includes grade adjustment based on defect detection.
 */
export function updateWithCVResult(historyId: string, cvResult: any): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  // Adjust grade based on CV damage detection
  let adjustedGrade = entry.grade || '';
  let gradeAdjustment = null;
  let gradeConfidence = null;
  
  if (cvResult.damageScore !== undefined && cvResult.damageScore !== null && entry.grade) {
    const adjustment = adjustGradeWithCVAnalysis(
      entry.grade,
      cvResult.damageScore,
      cvResult.regionScores || {}
    );
    
    adjustedGrade = adjustment.adjustedGrade;
    gradeAdjustment = adjustment.adjustment;
    gradeConfidence = adjustment.confidence;
    
    // Log adjustment for debugging
    if (adjustment.adjustment) {
      console.log(`[CV Grade Adjustment] ${entry.grade} → ${adjustedGrade}: ${adjustment.adjustment}`);
    }
  }
  
  updateHistoryEntry(historyId, {
    grade: adjustedGrade,  // Update with adjusted grade
    result: {
      ...entry.result,
      // Frame data
      goldenFrames: cvResult.goldenFrames,
      frameTimestamps: cvResult.frameTimestamps,
      
      // Defect visualizations
      defectMask: cvResult.defectMask,
      varianceHeatmap: cvResult.varianceHeatmap,
      defectOverlay: cvResult.defectOverlay,
      
      // Region data
      regionCrops: cvResult.regionCrops,
      
      // Defect metrics
      defectPercentage: cvResult.defectPercentage,
      damageScore: cvResult.damageScore,
      regionScores: cvResult.regionScores,
      regionDetails: cvResult.regionDetails,
      
      // Grade adjustment info
      originalGrade: entry.grade,  // Preserve original AI grade
      gradeAdjustment,
      gradeConfidence,
      
      _status: 'complete',
    },
  });
  
  // Dispatch event for UI update with ALL CV data
  dispatchUpdate(historyId, { 
    status: 'complete',
    grade: adjustedGrade,
    goldenFrames: cvResult.goldenFrames,
    defectMask: cvResult.defectMask,
    defectOverlay: cvResult.defectOverlay,
    damageScore: cvResult.damageScore,
    regionScores: cvResult.regionScores,
    regionCrops: cvResult.regionCrops,
    gradeAdjustment,
  });
}

/**
 * Mark the result as errored.
 */
export function updateWithError(historyId: string, error: string): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  updateHistoryEntry(historyId, {
    title: "Analysis Failed",
    grade: "ERR",
    result: {
      ...entry.result,
      _pending: false,
      _status: 'error',
      _error: error,
    },
  });
  
  // Dispatch event for UI update
  dispatchUpdate(historyId, { status: 'error', error });
}

/**
 * Dispatch a custom event for UI updates.
 */
function dispatchUpdate(historyId: string, data: any): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('analysis-update', {
      detail: { historyId, ...data }
    }));
  }
}

/**
 * Subscribe to analysis updates for a specific history ID.
 */
export function subscribeToUpdates(
  historyId: string, 
  callback: (data: any) => void
): () => void {
  const handler = (event: CustomEvent) => {
    if (event.detail.historyId === historyId) {
      callback(event.detail);
    }
  };
  
  window.addEventListener('analysis-update', handler as EventListener);
  
  // Return unsubscribe function
  return () => {
    window.removeEventListener('analysis-update', handler as EventListener);
  };
}

