/**
 * CV Analysis Client
 * 
 * Triggers the Python CV pipeline for detailed defect analysis.
 * Runs in the background after the main AI analysis completes.
 */

export interface CVAnalysisResult {
  success: boolean;
  scanId?: string;
  goldenFrames?: string[];
  frameTimestamps?: number[];
  defectMask?: string;
  varianceHeatmap?: string;
  regionCrops?: Record<string, string>;
  defectPercentage?: number;
  error?: string;
  skipped?: boolean;
}

/**
 * Trigger CV analysis for a video.
 * This runs in the background and doesn't block the UI.
 * 
 * @param videoUrl - Public URL of the video in Supabase
 * @param scanId - The scan/history ID
 * @param itemType - Type of collectible
 * @returns Promise with analysis results
 */
export async function triggerCVAnalysis(
  videoUrl: string,
  scanId: string,
  itemType: 'comic' | 'card' | 'toy' = 'card'
): Promise<CVAnalysisResult> {
  try {
    const response = await fetch('/api/cv-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoUrl,
        scanId,
        itemType,
      }),
    });

    const result = await response.json();
    
    if (!response.ok) {
      const errorMsg = result.error || result.details || result.message || `HTTP ${response.status}`;
      console.error('[CV Analysis] API error:', response.status, errorMsg, result);
      return {
        success: false,
        error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg),
      };
    }

    return result;
  } catch (error) {
    console.error('[CV Analysis] Network error:', error);
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Start CV analysis in the background.
 * Updates the history entry with CV results when complete.
 * 
 * @param videoUrl - Public URL of the video
 * @param historyId - The history entry ID
 * @param itemType - Type of collectible
 */
export function startBackgroundCVAnalysis(
  videoUrl: string,
  historyId: string,
  itemType: 'comic' | 'card' | 'toy' = 'card'
): void {
  // Fire and forget - don't await
  triggerCVAnalysis(videoUrl, historyId, itemType)
    .then((result) => {
      if (result.success && !result.skipped) {
        console.log('[CV Analysis] Background analysis complete:', result);
        
        // Update history entry with CV results
        updateHistoryWithCVResults(historyId, result);
      } else if (result.skipped) {
        console.log('[CV Analysis] Skipped (not configured)');
      } else {
        console.warn('[CV Analysis] Failed:', result.error);
      }
    })
    .catch((error) => {
      console.error('[CV Analysis] Background error:', error);
    });
}

/**
 * Update a history entry with CV analysis results.
 */
function updateHistoryWithCVResults(historyId: string, cvResult: CVAnalysisResult): void {
  try {
    const historyKey = 'comic-scan-history';
    const historyStr = localStorage.getItem(historyKey);
    
    if (!historyStr) return;
    
    const history = JSON.parse(historyStr);
    const entryIndex = history.findIndex((h: any) => h.id === historyId);
    
    if (entryIndex === -1) return;
    
    // Merge CV results into the result object
    history[entryIndex].result = {
      ...history[entryIndex].result,
      goldenFrames: cvResult.goldenFrames,
      frameTimestamps: cvResult.frameTimestamps,
      defectMask: cvResult.defectMask,
      varianceHeatmap: cvResult.varianceHeatmap,
      regionCrops: cvResult.regionCrops,
      defectPercentage: cvResult.defectPercentage,
    };
    
    localStorage.setItem(historyKey, JSON.stringify(history));
    console.log('[CV Analysis] History updated with CV results');
    
    // Dispatch event so UI can update if viewing this result
    window.dispatchEvent(new CustomEvent('cv-analysis-complete', {
      detail: { historyId, cvResult }
    }));
    
  } catch (error) {
    console.error('[CV Analysis] Failed to update history:', error);
  }
}

