/**
 * Streaming Analysis Manager
 * 
 * Manages the progressive loading of analysis results.
 * Creates a pending result immediately, then updates as data arrives.
 */

import { addToHistory, updateHistoryEntry, getVideoById } from './history';

export interface PendingResult {
  id: string;
  status: 'uploading' | 'analyzing' | 'complete' | 'error';
  videoUrl: string | null;
  thumbnail: string | null;
  title: string | null;
  issue: string | null;
  grade: string | null;
  itemType: string | null;
  reasoning: string | null;
  goldenFrames: string[] | null;
  detailedAnalysis: any | null;
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
 * Update the result with golden frames and detailed analysis from server.
 * Grade adjustment is now handled by Gemini directly.
 */
export function updateWithDetailedResult(historyId: string, detailedResult: any): void {
  const entry = getVideoById(historyId);
  if (!entry) return;
  
  updateHistoryEntry(historyId, {
    grade: detailedResult.estimatedGrade || entry.grade,
    result: {
      ...entry.result,
      // Golden frames from Modal
      goldenFrames: detailedResult.goldenFrames,
      frameTimestamps: detailedResult.frameTimestamps,
      
      // Detailed analysis from Gemini multi-frame
      detailedAnalysis: detailedResult.detailedAnalysis,
      
      _status: 'complete',
    },
  });
  
  // Dispatch event for UI update
  dispatchUpdate(historyId, { 
    status: 'complete',
    grade: detailedResult.estimatedGrade || entry.grade,
    goldenFrames: detailedResult.goldenFrames,
    detailedAnalysis: detailedResult.detailedAnalysis,
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

