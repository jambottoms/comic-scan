'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, ScanLine, Sparkles, Camera, Bookmark, Trash2, Maximize2 } from 'lucide-react';
import { getVideoById, updateHistoryEntry } from '@/lib/history';
import { subscribeToUpdates } from '@/lib/streaming-analysis';
import { extractFramesFromVideo, ExtractedFrame } from '@/lib/frame-extractor';
import { saveScan, deleteSavedScan, isScanSaved } from '@/lib/saved-scans';
import { useProgressPolling } from '@/lib/use-progress-polling';
import ImageViewerModal from './ImageViewerModal';
import HybridGradeDisplay from './HybridGradeDisplay';
import GradeScorecard from './GradeScorecard';

interface StreamingResultCardProps {
  historyId: string;
  embedded?: boolean;
}

/**
 * A streaming-aware result card that progressively shows content
 * as analysis completes.
 */
export default function StreamingResultCard({ historyId, embedded = false }: StreamingResultCardProps) {
  const [entry, setEntry] = useState(() => getVideoById(historyId));
  const [status, setStatus] = useState<string>(entry?.result?._status || 'uploading');
  
  // Subscribe to real-time updates
  useEffect(() => {
    // Initial load
    const current = getVideoById(historyId);
    if (current) {
      setEntry(current);
      setStatus(current.result?._status || 'uploading');
    }
    
    // Reset extraction flag when historyId changes (new video)
    extractionAttemptedRef.current = false;
    
    // Subscribe to updates
    const unsubscribe = subscribeToUpdates(historyId, (data) => {
      if (data.status) {
        setStatus(data.status);
      }
      // Reload entry from storage
      const updated = getVideoById(historyId);
      if (updated) {
        setEntry(updated);
      }
    });
    
    return unsubscribe;
  }, [historyId]);
  
  // Poll for updates as a fallback (every 500ms while pending)
  useEffect(() => {
    if (status === 'complete' || status === 'error') return;
    
    const interval = setInterval(() => {
      const current = getVideoById(historyId);
      if (current) {
        setEntry(current);
        const newStatus = current.result?._status;
        if (newStatus) setStatus(newStatus);
        if (newStatus === 'complete' || newStatus === 'error') {
          clearInterval(interval);
        }
      }
    }, 500);
    
    return () => clearInterval(interval);
  }, [historyId, status]);
  
  // Client-side frame extraction (fast, no server needed)
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [framesError, setFramesError] = useState<string | null>(null);
  const extractionAttemptedRef = useRef(false);
  
  
  // Save state
  const [isSaved, setIsSaved] = useState(false);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Image Viewer State
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageTitle, setSelectedImageTitle] = useState<string>("");
  const [selectedImageDesc, setSelectedImageDesc] = useState<string>("");
  const [selectedImageTimestamp, setSelectedImageTimestamp] = useState<string>("");

  const openImageViewer = (url: string, title: string, desc: string, timestamp?: number | string) => {
    setSelectedImage(url);
    setSelectedImageTitle(title);
    setSelectedImageDesc(desc);
    
    if (typeof timestamp === 'number') {
      const mins = Math.floor(timestamp / 60);
      const secs = Math.floor(timestamp % 60);
      setSelectedImageTimestamp(`${mins}:${secs.toString().padStart(2, '0')}`);
    } else if (typeof timestamp === 'string') {
      setSelectedImageTimestamp(timestamp);
    } else {
      setSelectedImageTimestamp("");
    }
    
    setImageViewerOpen(true);
  };
  
  // Check if already saved
  useEffect(() => {
    const checkSaved = async () => {
      const title = entry?.result?.title;
      const issue = entry?.result?.issue;
      const grade = entry?.result?.estimatedGrade;
      
      if (title && grade) {
        const existingId = await isScanSaved(title, issue || '', grade);
        if (existingId) {
          setIsSaved(true);
          setCurrentSavedId(existingId);
        }
      }
    };
    checkSaved();
  }, [entry?.result?.title, entry?.result?.issue, entry?.result?.estimatedGrade]);
  
  const handleSave = async () => {
    if (isSaving || !entry) return;
    setIsSaving(true);
    
    try {
      const saved = await saveScan({
        title: entry.result?.title || 'Unknown Item',
        issue: entry.result?.issue || '',
        grade: entry.result?.estimatedGrade || 'N/A',
        videoUrl: entry.videoUrl || undefined,
        thumbnail: entry.thumbnail,
        result: entry.result,
      });
      
      if (saved) {
        setIsSaved(true);
        setCurrentSavedId(saved.id);
      }
    } catch (error) {
      console.error('Failed to save scan:', error);
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleUnsave = async () => {
    if (isDeleting || !currentSavedId) return;
    setIsDeleting(true);
    
    try {
      const success = await deleteSavedScan(currentSavedId);
      if (success) {
        setIsSaved(false);
        setCurrentSavedId(null);
      }
    } catch (error) {
      console.error('Failed to delete saved scan:', error);
    } finally {
      setIsDeleting(false);
    }
  };
  
  useEffect(() => {
    const videoUrl = entry?.videoUrl;
    
    // Skip if already attempted extraction for this video
    if (extractionAttemptedRef.current) return;
    
    // Skip if no video URL, already have frames, or already loading
    if (!videoUrl || extractedFrames.length > 0 || framesLoading) return;
    // Skip if result already has golden frames (check all paths)
    const existingFrames = 
      entry?.result?.goldenFrames ||
      entry?.result?.cvAnalysis?.goldenFrames ||
      entry?.result?.cvAnalysis?.images?.goldenFrames ||
      entry?.result?.hybridGrade?.cvAnalysis?.goldenFrames ||
      entry?.result?.hybridGrade?.cvAnalysis?.images?.goldenFrames ||
      [];
    if (existingFrames.length > 0) return;
    
    // Mark as attempted to prevent re-runs
    extractionAttemptedRef.current = true;
    setFramesLoading(true);
    setFramesError(null);
    
    extractFramesFromVideo(videoUrl, 5)
      .then((frames) => {
        setFramesLoading(false);
        
        // Only update if we got frames
        if (frames.length > 0) {
          setExtractedFrames(frames);
          
          // Save to history so they persist
          const goldenFrameUrls = frames.map(f => f.dataUrl);
          const frameTimestamps = frames.map(f => f.timestamp);
          
          updateHistoryEntry(historyId, {
            result: {
              ...entry?.result,
              goldenFrames: goldenFrameUrls,
              frameTimestamps: frameTimestamps,
            }
          });
        } else {
          // No frames extracted (CORS or other issue) - silently fail
          // The video is still available for viewing
          console.log('[StreamingResultCard] No frames extracted - video may have CORS restrictions');
        }
      })
      .catch((err) => {
        // Graceful degradation - don't show error to user
        console.warn('[StreamingResultCard] Frame extraction failed:', err.message);
        setFramesLoading(false);
        // Don't set framesError - we'll just show video thumbnail or placeholders
      });
  }, [entry?.videoUrl, extractedFrames.length, framesLoading, historyId]);
  
  // Simulated progress for loading states
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let target = 0;
    let speed = 50;

    if (status === 'uploading') {
      target = 45;
      speed = 100;
    } else if (status === 'analyzing') {
      target = 90;
      speed = 150;
    } else if (status === 'cv_processing') {
      target = 95;
      speed = 200;
    } else if (status === 'complete') {
      target = 100;
      speed = 20;
    }

    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= target) return prev;
        // Decelerate as we get closer
        const remaining = target - prev;
        const step = Math.max(0.5, remaining / 10); 
        return Math.min(target, prev + (Math.random() * step));
      });
    }, speed);

    return () => clearInterval(timer);
  }, [status]);

  const result = entry?.result || {};
  const isPending = result._pending === true;
  const isAnalyzing = status === 'analyzing' || status === 'uploading';
  const isAIComplete = result._aiReady === true || status === 'ai_complete';
  const isCVPending = status === 'ai_complete' || status === 'frames_ready';
  const isCVProcessing = status === 'cv_processing';
  const isComplete = status === 'complete';
  const isFullyComplete = status === 'complete' && result._cvReady === true;
  const isError = status === 'error';
  
  // Real-time progress polling for Phase 2 (CV analysis)
  const cvProgress = useProgressPolling(historyId, isCVPending && !isFullyComplete);
  
  // DEBUG: Log polling status
  useEffect(() => {
    console.log('[StreamingResultCard] Polling status:', {
      historyId,
      status,
      isCVPending,
      isFullyComplete,
      pollingEnabled: isCVPending && !isFullyComplete,
      cvProgress
    });
  }, [historyId, status, isCVPending, isFullyComplete, cvProgress]);
  
  // DEBUG: Log what data we actually have
  useEffect(() => {
    if (isComplete && result) {
      console.log('[StreamingResultCard] COMPLETE - Data check:', {
        hasHybridGrade: !!result.hybridGrade,
        hasGoldenFrames: !!result.goldenFrames,
        goldenFramesCount: result.goldenFrames?.length || 0,
        hasCvAnalysis: !!result.cvAnalysis,
        cvDamageScore: result.cvAnalysis?.damageScore,
        hasDetailedAnalysis: !!result.detailedAnalysis,
        estimatedGrade: result.estimatedGrade,
        regionScoresKeys: Object.keys(result.cvAnalysis?.regionScores || {}),
        resultKeys: Object.keys(result),
      });
    }
  }, [isComplete, result]);
  
  // Note: We no longer switch to ResultCard on complete - StreamingResultCard
  // handles everything including frames and deep scan button
  
  const grade = result.estimatedGrade || '...';
  const title = result.title || (isAnalyzing ? 'Analyzing...' : 'Unknown Item');
  const issueNum = result.issue || '';
  const pageQuality = result.pageQuality || "Analyzing...";
  
  // Normalize golden frames data paths - check all possible locations
  const normalizedGoldenFrames: string[] = 
    result.goldenFrames || 
    result.cvAnalysis?.goldenFrames ||
    result.cvAnalysis?.images?.goldenFrames ||
    result.hybridGrade?.cvAnalysis?.goldenFrames ||
    result.hybridGrade?.cvAnalysis?.images?.goldenFrames ||
    [];

  const normalizedTimestamps: number[] =
    result.frameTimestamps ||
    result.cvAnalysis?.frameTimestamps ||
    result.cvAnalysis?.images?.frameTimestamps ||
    result.hybridGrade?.cvAnalysis?.frameTimestamps ||
    result.hybridGrade?.cvAnalysis?.images?.frameTimestamps ||
    [];
  
  // Normalize CV analysis data
  const cvData = result.hybridGrade?.cvAnalysis || result.cvAnalysis || {};
  const cvImages = cvData.images || cvData;
  const regionScores = cvData.regionScores || {};
  const defectLabels = cvData.defectLabels || {};
  const damageScore = cvData.damageScore;
  

  // Skeleton pulse animation class
  const skeleton = "animate-pulse bg-gray-700 rounded";

  // Helper to find defect description for a golden frame/extracted frame
  const getFrameDescription = (timestampVal: number): { title: string, desc: string } => {
    let title = "Frame Capture";
    let desc = "High-resolution capture from video analysis.";
    
    // Try to find matching defect in reasoning
    // Note: We need to parse reasoning similar to ResultCard if it's a string
    // For now, we'll check if it's an array of objects which is the new format
    if (result.reasoning && Array.isArray(result.reasoning)) {
       const match = result.reasoning.find((item: any) => {
         const itemTime = item.timestamp; // Assuming backend provides timestamp in object
         if (typeof itemTime === 'number') {
           return Math.abs(itemTime - timestampVal) < 3.0;
         }
         return false;
       });
       
       if (match) {
         title = "Defect Detected";
         desc = match.defect || match.text || match.description || "Anomaly detected at this timestamp.";
       }
    } else if (typeof result.reasoning === 'string') {
      // Basic string matching for timestamps like (0:15)
      // This is a simplified version of ResultCard's logic
      const timeStr = `${Math.floor(timestampVal / 60)}:${Math.floor(timestampVal % 60).toString().padStart(2, '0')}`;
      if (result.reasoning.includes(timeStr)) {
        // Find the sentence containing this timestamp
        const sentences = result.reasoning.split(/[.!?]+/);
        const match = sentences.find((s: string) => s.includes(timeStr));
        if (match) {
          title = "Defect Note";
          desc = match.trim();
        }
      }
    }
    
    return { title, desc };
  };

  return (
    <div className={`w-full max-w-2xl flex flex-col items-center ${embedded ? '' : 'min-h-screen bg-gray-900 text-white p-4 overflow-y-auto'}`}>
      
      {/* The Result Card - CGC Slab Style */}
      <div className="bg-gray-800 p-6 rounded-xl border-2 border-purple-500 max-w-2xl w-full shadow-2xl mb-4 relative overflow-hidden">
        
        {/* Scanning animation overlay for pending state */}
        {(isAnalyzing || isPending) && (
          <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-scan-line" />
          </div>
        )}
        
        {/* CGC Slab Style Header */}
        <div className="bg-gradient-to-b from-gray-900 to-gray-800 border-2 border-gray-600 rounded-lg p-0 overflow-hidden mb-4">
          {/* Top colored strip */}
          <div className={`h-1 w-full ${isAnalyzing ? 'bg-gradient-to-r from-purple-600 via-blue-500 to-purple-600 animate-gradient-x' : 'bg-gradient-to-r from-blue-600 to-purple-600'}`}></div>
          
          <div className="flex flex-row p-3">
            {/* Left: Grade Box */}
            <div className="flex-shrink-0 flex flex-col w-20 bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden mr-4">
              <div className="bg-gray-800 text-center py-1 border-b border-gray-600">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Grade</span>
              </div>
              <div className="flex-1 flex items-center justify-center bg-white min-h-[60px]">
                {isAnalyzing ? (
                  <div className="flex flex-col items-center justify-center">
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin mb-0.5" />
                    <span className="text-[10px] font-bold text-gray-500 font-mono">{Math.round(progress)}%</span>
                  </div>
                ) : (
                  <span className="text-3xl font-black text-black">{grade}</span>
                )}
              </div>
              <div className="bg-gray-100 text-center py-1 border-t border-gray-200">
                <span className={`text-[9px] font-bold uppercase whitespace-nowrap px-1 ${isAnalyzing ? 'text-gray-400' : 'text-gray-600'}`}>
                  {isAnalyzing ? '...' : pageQuality}
                </span>
              </div>
            </div>

            {/* Right: Title and Issue Info */}
            <div className="flex-1 flex flex-col justify-center min-w-0">
              {isAnalyzing ? (
                <>
                  <div className={`${skeleton} h-6 w-3/4 mb-2`}></div>
                  <div className={`${skeleton} h-5 w-1/4 mb-2`}></div>
                </>
              ) : (
                <>
                  <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight leading-none mb-1 truncate">
                    {title}
                  </h2>
                  <div className="flex items-center gap-2 text-gray-300">
                    <span className="text-lg font-bold">{issueNum ? `#${issueNum}` : ''}</span>
                  </div>
                </>
              )}
              <div className="text-xs text-gray-500 mt-1 font-mono uppercase tracking-wide">
                GradeVault • {new Date().getFullYear()}
              </div>
            </div>
          </div>
          
          {/* Status indicator + Save button */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-900/50 border-t border-gray-700">
            <div className="flex items-center gap-2">
              {isAnalyzing && (
                <div className="flex items-center gap-2 text-purple-400 text-xs font-medium">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                  <span>AI analyzing video...</span>
                </div>
              )}
              {(isComplete || isCVProcessing) && !isError && (
                <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
                  <span>✓ Analysis complete</span>
                </div>
              )}
              {isError && (
                <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
                  <span>✕ Analysis failed: {result._error || 'Unknown error'}</span>
                </div>
              )}
            </div>
            
            {/* Save/Unsave Button */}
            {!isAnalyzing && !isError && (
              isSaved ? (
                <button
                  onClick={handleUnsave}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 rounded text-xs font-semibold uppercase tracking-wide transition-all"
                >
                  {isDeleting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                  <span>Remove</span>
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold uppercase tracking-wide transition-all"
                >
                  {isSaving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Bookmark className="w-3 h-3" />
                  )}
                  <span>Save</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Summary Section - Skeleton or Content */}
        <div className="mb-4 pb-4 border-b border-gray-700">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Analysis Summary</h3>
          {isAnalyzing ? (
            <div className="space-y-2">
              <div className={`${skeleton} h-4 w-full`}></div>
              <div className={`${skeleton} h-4 w-5/6`}></div>
              <div className={`${skeleton} h-4 w-4/6`}></div>
            </div>
          ) : result.summary ? (
            <div className="text-gray-300 text-sm leading-relaxed line-clamp-3">
              {result.summary}
            </div>
          ) : result.reasoning && typeof result.reasoning === 'string' ? (
            <div className="text-gray-300 text-sm leading-relaxed line-clamp-3">
              {result.reasoning}
            </div>
          ) : (
            <p className="text-gray-500 text-sm italic">No summary available</p>
          )}
        </div>

        {/* Grading Details - Skeleton or Content */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
            Defects & Notes
          </h3>
          {isAnalyzing ? (
            <ul className="space-y-2">
              {[1, 2, 3].map((i) => (
                <li key={i} className="flex items-start">
                  <span className="text-purple-500 mr-2 mt-1">•</span>
                  <div className={`${skeleton} h-4 flex-1`} style={{ width: `${70 + i * 10}%` }}></div>
                </li>
              ))}
            </ul>
          ) : result.reasoning && Array.isArray(result.reasoning) ? (
            <ul className="space-y-2">
              {result.reasoning.map((item: any, index: number) => (
                <li key={index} className="flex items-start text-gray-300 text-sm">
                  {/* Timestamp if available */}
                  {item.timestamp && (
                    <span className="text-[10px] font-mono text-green-500 bg-green-900/20 px-1.5 rounded mr-2 mt-0.5">
                      {item.timestamp}
                    </span>
                  )}
                  
                  <span className="flex-1">
                    {/* Defect Name - Note format */}
                    {item.defect ? (
                      <>
                        <strong className="text-white font-semibold">{item.defect}</strong>
                        <span className="mx-1 text-gray-500">-</span>
                        <span className="text-gray-300">{item.note || item.text}</span>
                      </>
                    ) : (
                      <span>{item.text || item.description || JSON.stringify(item)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-sm italic">Details will appear here...</p>
          )}
        </div>
        
        {/* CV Processing Indicator - Show when AI is complete but CV is pending */}
        {isAIComplete && isCVPending && !isComplete && (
          <div className="mt-4 p-3 bg-purple-900/20 rounded-lg border border-purple-700 animate-pulse">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              <span className="text-sm text-purple-300 font-medium">
                AI analysis complete • Running computer vision verification...
              </span>
            </div>
            <div className="mt-2 text-xs text-gray-400">
              Analyzing golden frames, detecting defects, and verifying grade accuracy...
            </div>
          </div>
        )}
      </div>

      {/* Hybrid Grade Display - AI + CV Analysis */}
      {result.hybridGrade && (
        <div className="max-w-2xl w-full mb-4">
          <HybridGradeDisplay hybridGrade={result.hybridGrade} />
        </div>
      )}

      {/* Grading Scorecard - Full Breakdown (when CV data available) */}
      {isCVPending && !result.hybridGrade && (
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full mb-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-purple-400" />
            Computer Vision Analysis
            <Loader2 className="w-3 h-3 animate-spin text-purple-400 ml-auto" />
          </h3>
          
          {/* Skeleton for region analysis */}
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`${skeleton} w-24 h-4`}></div>
                <div className={`${skeleton} flex-1 h-3`}></div>
                <div className={`${skeleton} w-12 h-4`}></div>
              </div>
            ))}
          </div>
          
          <p className="text-xs text-gray-500 italic text-center mt-4">
            Analyzing spine, corners, and surface for defects...
          </p>
        </div>
      )}
      
      {(result.hybridGrade || Object.keys(regionScores).length > 0) && !isAnalyzing && (
        <GradeScorecard
          hybridGrade={result.hybridGrade}
          cvAnalysis={cvData}
          regionScores={regionScores}
          defectLabels={defectLabels}
          defectBreakdown={result.hybridGrade?.defectBreakdown}
        />
      )}
      
      {/* AI Grade Summary Card - Always show when we have AI data but no CV */}
      {!result.hybridGrade && !isAnalyzing && result.estimatedGrade && (
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full mb-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-purple-400" />
            Grade Analysis
          </h3>
          
          {/* Grade Breakdown */}
          <div className="space-y-3">
            {/* Main Grade */}
            <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
              <div>
                <div className="text-xs text-gray-400 uppercase">Estimated Grade</div>
                <div className="text-lg font-bold text-white">
                  {result.gradingScale || 'CGC'} Scale
                </div>
              </div>
              <div className={`text-3xl font-black font-mono ${
                parseFloat(result.estimatedGrade) >= 9.0 ? 'text-green-400' :
                parseFloat(result.estimatedGrade) >= 7.0 ? 'text-yellow-400' :
                parseFloat(result.estimatedGrade) >= 5.0 ? 'text-orange-400' :
                'text-red-400'
              }`}>
                {result.estimatedGrade}
              </div>
            </div>
            
            {/* Item Details */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              {result.itemType && (
                <div className="p-2 bg-gray-900/30 rounded">
                  <span className="text-gray-500 text-xs">Type:</span>
                  <span className="text-gray-300 ml-1 capitalize">{result.itemType}</span>
                </div>
              )}
              {result.year && (
                <div className="p-2 bg-gray-900/30 rounded">
                  <span className="text-gray-500 text-xs">Year:</span>
                  <span className="text-gray-300 ml-1">{result.year}</span>
                </div>
              )}
              {result.variant && (
                <div className="p-2 bg-gray-900/30 rounded col-span-2">
                  <span className="text-gray-500 text-xs">Variant:</span>
                  <span className="text-gray-300 ml-1">{result.variant}</span>
                </div>
              )}
            </div>
            
            {/* Defect Count Summary */}
            {Array.isArray(result.reasoning) && result.reasoning.length > 0 && (
              <div className="p-3 bg-gray-900/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400 uppercase">Defects Identified</span>
                  <span className={`text-sm font-bold ${
                    result.reasoning.length <= 2 ? 'text-green-400' :
                    result.reasoning.length <= 5 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {result.reasoning.length} found
                  </span>
                </div>
                
                {/* Defect tags */}
                <div className="flex flex-wrap gap-1.5">
                  {result.reasoning.slice(0, 6).map((item: any, idx: number) => (
                    <span 
                      key={idx}
                      className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300"
                    >
                      {item.defect || item.text || 'Defect'}
                    </span>
                  ))}
                  {result.reasoning.length > 6 && (
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-600 text-gray-400">
                      +{result.reasoning.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* Analysis Note */}
            <div className="text-xs text-gray-500 italic text-center pt-2 border-t border-gray-700">
              AI analysis complete • Deep CV scan available for enhanced accuracy
            </div>
          </div>
        </div>
      )}

      {/* CV Analysis Section - Fast client-side extraction */}
      <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full mb-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Camera className="w-4 h-4" />
          Key Frames
          {(framesLoading || isCVPending) && <Loader2 className="w-3 h-3 animate-spin text-blue-400 ml-2" />}
        </h3>
        
        {/* CV Processing Status with Real-Time Progress */}
        {isCVPending && !normalizedGoldenFrames.length && (
          <div className="mb-4 p-3 bg-blue-900/20 rounded-lg border border-blue-700/50">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="text-sm text-blue-300 font-medium">{cvProgress.message || 'Processing golden frames...'}</span>
            </div>
            
            {/* Progress Bar */}
            {cvProgress.percentage > 0 && (
              <div className="mt-2 mb-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{cvProgress.step.replace(/_/g, ' ')}</span>
                  <span>{cvProgress.percentage}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-500 ease-out"
                    style={{ width: `${cvProgress.percentage}%` }}
                  />
                </div>
              </div>
            )}
            
            <p className="text-xs text-gray-400 mt-2">
              Extracting high-quality frames, analyzing defects with computer vision, and verifying grade accuracy.
            </p>
          </div>
        )}
        
        {/* Golden Frames Grid - Fast client-side extraction */}
        <div className="mb-4">
          <p className="text-gray-400 text-xs mb-2">
            {isCVPending && !normalizedGoldenFrames.length ? 'Extracting frames from video...' : 
             framesLoading ? 'Extracting frames...' : 'Video Captures (Tap to Enlarge)'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {/* Show extracted frames (client-side), or stored goldenFrames, or loading state */}
            {/* Logic: 1. Client extracted frames, 2. Server golden frames (new array), 3. Server golden frames (old array) */}
            {extractedFrames.length > 0 ? (
              extractedFrames.slice(0, 3).map((frame, idx) => {
                const { title, desc } = getFrameDescription(frame.timestamp);
                return (
                  <button 
                    key={idx} 
                    className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900 group hover:border-purple-500 transition-colors"
                    onClick={() => openImageViewer(frame.dataUrl, title, desc, frame.timestampFormatted)}
                  >
                    <img src={frame.dataUrl} alt={`Frame at ${frame.timestampFormatted}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-0.5 font-mono">
                      {frame.timestampFormatted}
                    </div>
                  </button>
                );
              })
            ) : normalizedGoldenFrames.length > 0 ? (
              normalizedGoldenFrames.slice(0, 3).map((frame: string, idx: number) => {
                const timestamp = normalizedTimestamps[idx] ?? 0;
                const { title, desc } = getFrameDescription(timestamp);
                return (
                  <button 
                    key={idx} 
                    className="aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900 relative group hover:border-purple-500 transition-colors"
                    onClick={() => openImageViewer(frame, title, desc, timestamp)}
                  >
                    <img src={frame} alt={`Golden Frame ${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-0.5 font-mono">
                      {timestamp.toFixed(2)}s
                    </div>
                  </button>
                );
              })
            ) : (framesLoading || isCVPending) ? (
              [1, 2, 3].map((i) => (
                <div key={i} className={`aspect-[3/4] rounded-lg border border-gray-600 ${skeleton} relative`}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-gray-600 animate-spin" />
                  </div>
                </div>
              ))
            ) : !entry?.videoUrl ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="aspect-[3/4] rounded-lg border border-gray-600 bg-gray-900">
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                    Waiting...
                  </div>
                </div>
              ))
            ) : (
               /* Fallback if no frames extracted - show thumbnail or placeholder */
               entry?.thumbnail ? (
                 <div className="col-span-3">
                   <button
                     className="w-full aspect-video rounded-lg overflow-hidden border border-gray-600 bg-gray-900 relative group hover:border-purple-500 transition-colors"
                     onClick={() => entry.thumbnail && openImageViewer(entry.thumbnail, 'Video Thumbnail', 'First frame captured from video', 0)}
                   >
                     <img src={entry.thumbnail} alt="Video thumbnail" className="w-full h-full object-cover" />
                     <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                       <Maximize2 className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                     </div>
                     <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-xs text-center text-gray-300 py-1">
                       Tap to view • Video available for playback
                     </div>
                   </button>
                 </div>
               ) : (
                 <div className="col-span-3 text-gray-500 text-xs text-center py-4 italic">
                   Video frames will appear here
                 </div>
               )
            )}
          </div>
          
          {/* Show remaining frames in a second row if we have 5 */}
          {extractedFrames.length > 3 && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {extractedFrames.slice(3).map((frame, idx) => {
                const { title, desc } = getFrameDescription(frame.timestamp);
                return (
                  <button 
                    key={idx + 3} 
                    className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900 group hover:border-purple-500 transition-colors"
                    onClick={() => openImageViewer(frame.dataUrl, title, desc, frame.timestampFormatted)}
                  >
                    <img src={frame.dataUrl} alt={`Frame at ${frame.timestampFormatted}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-0.5 font-mono">
                      {frame.timestampFormatted}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          
          {/* Show remaining server-side golden frames in a second row if we have more than 3 */}
          {!extractedFrames.length && normalizedGoldenFrames.length > 3 && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {normalizedGoldenFrames.slice(3).map((frame: string, idx: number) => {
                const timestamp = normalizedTimestamps[idx + 3] ?? 0;
                const { title, desc } = getFrameDescription(timestamp);
                return (
                  <button 
                    key={idx + 3} 
                    className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900 group hover:border-purple-500 transition-colors"
                    onClick={() => openImageViewer(frame, title, desc, timestamp)}
                  >
                    <img src={frame} alt={`Golden Frame ${idx + 4}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-0.5 font-mono">
                      {timestamp.toFixed(2)}s
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Multi-Frame Analysis Results (from Gemini) */}
        {result.detailedAnalysis && (
          <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-xs uppercase tracking-wide flex items-center gap-2">
                <span>🔬 Multi-Frame Analysis</span>
                <span className="text-[10px] text-gray-500 normal-case">(AI verified)</span>
              </span>
              {result.detailedAnalysis.confidence && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                  result.detailedAnalysis.confidence === 'high' ? 'bg-green-900/50 text-green-400' :
                  result.detailedAnalysis.confidence === 'medium' ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-red-900/50 text-red-400'
                }`}>
                  {result.detailedAnalysis.confidence} confidence
                </span>
              )}
            </div>
            
            {/* Confirmed Defects */}
            {result.detailedAnalysis.confirmedDefects?.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 mb-1">Confirmed Defects:</p>
                <div className="space-y-1">
                  {result.detailedAnalysis.confirmedDefects.map((defect: any, i: number) => (
                    <div key={i} className={`text-xs px-2 py-1 rounded ${
                      defect.severity === 'severe' ? 'bg-red-900/30 text-red-300' :
                      defect.severity === 'moderate' ? 'bg-orange-900/30 text-orange-300' :
                      'bg-yellow-900/30 text-yellow-300'
                    }`}>
                      <span className="font-medium">{defect.type}</span>
                      <span className="text-gray-400"> · </span>
                      <span>{defect.location}</span>
                      <span className="text-gray-400"> · </span>
                      <span className="opacity-75">{defect.severity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Possible Artifacts (glare, not damage) */}
            {result.detailedAnalysis.possibleArtifacts?.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 mb-1">Possible Glare/Artifacts (not damage):</p>
                <div className="text-xs text-gray-400 italic">
                  {result.detailedAnalysis.possibleArtifacts.join(', ')}
                </div>
              </div>
            )}
            
            {/* Grade Adjustment from multi-frame analysis */}
            {result.detailedAnalysis.adjustmentReason && (
              <div className="p-2 bg-blue-900/20 rounded border border-blue-700/30">
                <p className="text-xs text-blue-300">
                  📊 <span className="font-medium">Analysis:</span> {result.detailedAnalysis.adjustmentReason}
                </p>
              </div>
            )}
          </div>
        )}
        
        {/* Show region crops if available from CV pipeline */}
        {result.regionCrops && Object.keys(result.regionCrops).length > 0 && (
          <div>
            <p className="text-gray-400 text-xs mb-2">Frame Regions</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(result.regionCrops)
                .filter(region => region !== 'full_frame') // Don't show full frame
                .slice(0, 4) // Show max 4 regions
                .map((region) => {
                const regionName = region.replace('_', ' ');
                const regionTitle = region === 'center' ? 'Center Area' :
                                   region === 'top_left' ? 'Top Left' :
                                   region === 'top_right' ? 'Top Right' :
                                   region === 'bottom_left' ? 'Bottom Left' :
                                   region === 'bottom_right' ? 'Bottom Right' :
                                   region.replace('_', ' ').replace('corner ', '');
                return result.regionCrops[region] && (
                  <button 
                    key={region} 
                    className="relative group w-full"
                    onClick={() => openImageViewer(
                      result.regionCrops[region],
                      regionTitle,
                      `Detailed crop of ${regionTitle.toLowerCase()}.`
                    )}
                  >
                    <div className="aspect-square rounded overflow-hidden border border-gray-600 bg-gray-900 group-hover:border-purple-500 transition-colors">
                      <img 
                        src={result.regionCrops[region]} 
                        alt={regionTitle} 
                        className="w-full h-full object-cover" 
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                      </div>
                    </div>
                    <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center text-gray-300 py-0.5 uppercase">
                      {regionName}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Pixels per MM info if available */}
        {result.pixelsPerMm && (
          <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
            <span>Resolution: {result.pixelsPerMm.toFixed(1)} px/mm</span>
            <span>≈ {(result.pixelsPerMm * 25.4).toFixed(0)} DPI</span>
          </div>
        )}
      </div>

      {/* Video Preview */}
      {entry?.videoUrl && (
        <div className="mb-6 w-full max-w-2xl">
          <p className="text-gray-400 text-sm mb-2 text-center">Video Preview:</p>
          <div className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-black">
            <video 
              src={entry.videoUrl} 
              controls 
              playsInline
              className="w-full h-auto max-h-[80vh]"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}

      {/* Thumbnail fallback if no video yet */}
      {!entry?.videoUrl && entry?.thumbnail && (
        <div className="mb-6 w-full max-w-2xl">
          <p className="text-gray-400 text-sm mb-2 text-center">Captured Frame:</p>
          <div className="rounded-xl border border-gray-700 overflow-hidden">
            <img 
              src={entry.thumbnail} 
              alt="Captured frame" 
              className="w-full h-auto cursor-pointer" 
              onClick={() => openImageViewer(entry.thumbnail || "", "Captured Frame", "Thumbnail of the video scan.")}
            />
          </div>
        </div>
      )}
      
      {/* Image Viewer Modal */}
      <ImageViewerModal
        isOpen={imageViewerOpen}
        onClose={() => setImageViewerOpen(false)}
        imageUrl={selectedImage}
        title={selectedImageTitle}
        description={selectedImageDesc}
        timestamp={selectedImageTimestamp}
      />
    </div>
  );
}

