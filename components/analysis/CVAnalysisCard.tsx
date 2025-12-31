'use client';

import { useEffect } from 'react';
import { Camera, Loader2, ScanLine, Maximize2 } from 'lucide-react';
import { useProgressPolling } from '@/lib/use-progress-polling';
import GradeScorecard from '../GradeScorecard';

interface CVAnalysisCardProps {
  historyId: string;
  status: string;
  result: any;
  onOpenImage: (url: string, title: string, desc: string) => void;
}

export default function CVAnalysisCard({
  historyId,
  status,
  result,
  onOpenImage
}: CVAnalysisCardProps) {
  const isComplete = status === 'complete';
  const isProcessing = status === 'ai_complete' || status === 'frames_ready' || status === 'cv_processing';
  
  // Enable polling if processing and not complete
  const progress = useProgressPolling(historyId, isProcessing && !isComplete);
  const skeleton = "animate-pulse bg-gray-700 rounded";
  
  // Mobile debugging
  useEffect(() => {
    if (isProcessing && !isComplete) {
      console.log('[CVAnalysisCard] MOBILE DEBUG:', {
        historyId,
        status,
        isProcessing,
        isComplete,
        pollingEnabled: isProcessing && !isComplete,
        progressPercentage: progress.percentage,
        progressMessage: progress.message,
        progressStep: progress.step
      });
    }
  }, [historyId, status, isProcessing, isComplete, progress]);

  // Data extraction
  const normalizedGoldenFrames: string[] = 
    result.goldenFrames || 
    result.cvAnalysis?.goldenFrames ||
    result.hybridGrade?.cvAnalysis?.goldenFrames || 
    [];
    
  const cvData = result.hybridGrade?.cvAnalysis || result.cvAnalysis || {};
  const regionScores = cvData.regionScores || {};
  const defectLabels = cvData.defectLabels || {};

  return (
    <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-xl border border-gray-700 mb-6 shadow-lg">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Computer Vision (Phase 2)
          </h3>
        </div>
        {isProcessing && (
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{progress.message || 'Processing...'}</span>
          </div>
        )}
      </div>

      {/* Progress Bar (Visible during processing) */}
      {isProcessing && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{progress.step ? progress.step.replace(/_/g, ' ') : 'Analyzing'}</span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all duration-500 ease-out"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          
          {/* Mobile Debug Info - Visible on screen */}
          <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 font-mono">
            <div>Status: {status}</div>
            <div>Polling: {isProcessing && !isComplete ? 'ENABLED' : 'DISABLED'}</div>
            <div>JobID: {historyId?.slice(0, 20)}...</div>
            <div>Progress: {progress.percentage}% | {progress.step}</div>
            <div>Message: {progress.message}</div>
          </div>
        </div>
      )}

      {/* Golden Frames Section */}
      <div className="mb-6">
        <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-3">Golden Frames</h4>
        <div className="grid grid-cols-3 gap-2">
          {isProcessing && normalizedGoldenFrames.length === 0 ? (
            [1, 2, 3].map(i => (
              <div key={i} className={`aspect-[3/4] ${skeleton} flex items-center justify-center`}>
                <Loader2 className="w-6 h-6 text-gray-600 animate-spin" />
              </div>
            ))
          ) : normalizedGoldenFrames.length > 0 ? (
            normalizedGoldenFrames.slice(0, 3).map((frame, idx) => (
              <button
                key={idx}
                onClick={() => onOpenImage(frame, `Golden Frame ${idx + 1}`, "AI-selected best frame for grading.")}
                className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 group hover:border-blue-500 transition-colors"
              >
                <img src={frame} alt={`Frame ${idx}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100" />
                </div>
              </button>
            ))
          ) : (
            <div className="col-span-3 text-xs text-gray-500 italic text-center py-4">
              No frames extracted.
            </div>
          )}
        </div>
      </div>

      {/* Region Analysis / Scorecard */}
      <div>
        <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-3">Defect Analysis</h4>
        {isProcessing && !result.hybridGrade ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className={`${skeleton} w-24 h-4`}></div>
                <div className={`${skeleton} flex-1 h-3`}></div>
                <div className={`${skeleton} w-12 h-4`}></div>
              </div>
            ))}
            <p className="text-xs text-center text-gray-500 mt-2 animate-pulse">
              Scanning spine, corners, and surface...
            </p>
          </div>
        ) : (
          <GradeScorecard
            hybridGrade={result.hybridGrade}
            cvAnalysis={cvData}
            regionScores={regionScores}
            defectLabels={defectLabels}
            defectBreakdown={result.hybridGrade?.defectBreakdown}
          />
        )}
      </div>
    </div>
  );
}
