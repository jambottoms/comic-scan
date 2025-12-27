'use client';

import { useState, useEffect } from 'react';
import { Loader2, ScanLine, Sparkles } from 'lucide-react';
import { getVideoById } from '@/lib/history';
import { subscribeToUpdates } from '@/lib/streaming-analysis';
import ResultCard from '@/components/ResultCard';

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
  
  const result = entry?.result || {};
  const isPending = result._pending === true;
  const isAnalyzing = status === 'analyzing' || status === 'uploading';
  const isCVProcessing = status === 'cv_processing';
  const isComplete = status === 'complete';
  const isError = status === 'error';
  
  // Once complete, switch to the full ResultCard for save/delete functionality
  if (isComplete && entry && !isPending) {
    return (
      <ResultCard 
        result={entry.result}
        videoUrl={entry.videoUrl}
        thumbnail={entry.thumbnail}
        embedded={embedded}
      />
    );
  }
  
  const grade = result.estimatedGrade || '...';
  const title = result.title || (isAnalyzing ? 'Analyzing...' : 'Unknown Item');
  const issueNum = result.issue || '';
  const pageQuality = result.pageQuality || "Analyzing...";

  // Skeleton pulse animation class
  const skeleton = "animate-pulse bg-gray-700 rounded";

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
                  <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
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
          
          {/* Status indicator */}
          <div className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-900/50 border-t border-gray-700">
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-purple-400 text-xs font-medium">
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span>AI analyzing video...</span>
              </div>
            )}
            {isCVProcessing && (
              <div className="flex items-center gap-2 text-blue-400 text-xs font-medium">
                <ScanLine className="w-4 h-4 animate-pulse" />
                <span>Deep scan in progress...</span>
              </div>
            )}
            {isComplete && (
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
          ) : result.reasoning ? (
            <div className="text-gray-300 text-sm leading-relaxed">
              {typeof result.reasoning === 'string' 
                ? result.reasoning.split('\n').slice(0, 3).join(' ').substring(0, 200) + '...'
                : JSON.stringify(result.reasoning).substring(0, 200) + '...'
              }
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
                  <span className="text-purple-500 mr-2 mt-1">•</span>
                  <span>{item.defect || item.text || item.description || JSON.stringify(item)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-sm italic">Details will appear here...</p>
          )}
        </div>
      </div>

      {/* CV Analysis Section - Shows skeleton while processing */}
      <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full mb-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
          <ScanLine className="w-4 h-4" />
          Condition Analysis
          {isCVProcessing && <Loader2 className="w-3 h-3 animate-spin text-blue-400 ml-2" />}
        </h3>
        
        {/* Golden Frames Grid - Skeleton or Content */}
        <div className="mb-4">
          <p className="text-gray-400 text-xs mb-2">Golden Frames (Sharpest Captures)</p>
          <div className="grid grid-cols-3 gap-2">
            {result.goldenFrames && result.goldenFrames.length > 0 ? (
              result.goldenFrames.slice(0, 3).map((frame: string, idx: number) => (
                <div key={idx} className="aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900">
                  <img src={frame} alt={`Golden Frame ${idx + 1}`} className="w-full h-full object-cover" />
                </div>
              ))
            ) : (
              [1, 2, 3].map((i) => (
                <div key={i} className={`aspect-[3/4] rounded-lg border border-gray-600 ${isCVProcessing ? skeleton : 'bg-gray-900'}`}>
                  {!isCVProcessing && (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                      Frame {i}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Defect Heatmap - Skeleton or Content */}
        <div className="mb-4">
          <p className="text-gray-400 text-xs mb-2">Defect Heatmap</p>
          {result.defectMask ? (
            <div className="rounded-lg overflow-hidden border border-gray-600 bg-gray-900">
              <img src={result.defectMask} alt="Defect Analysis Heatmap" className="w-full h-auto" />
            </div>
          ) : (
            <div className={`aspect-video rounded-lg border border-gray-600 ${isCVProcessing ? skeleton : 'bg-gray-900'}`}>
              {!isCVProcessing && (
                <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                  Heatmap will appear here
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Region Analysis - Skeleton or Content */}
        <div>
          <p className="text-gray-400 text-xs mb-2">Region Analysis</p>
          <div className="grid grid-cols-5 gap-1">
            {result.regionCrops && Object.keys(result.regionCrops).length > 0 ? (
              ['corner_tl', 'corner_tr', 'spine', 'corner_bl', 'corner_br'].map((region) => (
                result.regionCrops[region] && (
                  <div key={region} className="relative">
                    <div className="aspect-square rounded overflow-hidden border border-gray-600 bg-gray-900">
                      <img 
                        src={result.regionCrops[region]} 
                        alt={region.replace('_', ' ')} 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                    <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center text-gray-300 py-0.5 uppercase">
                      {region.replace('corner_', '').replace('_', '')}
                    </span>
                  </div>
                )
              ))
            ) : (
              ['TL', 'TR', 'Spine', 'BL', 'BR'].map((label, i) => (
                <div key={i} className="relative">
                  <div className={`aspect-square rounded border border-gray-600 ${isCVProcessing ? skeleton : 'bg-gray-900'}`}>
                    {!isCVProcessing && (
                      <div className="w-full h-full flex items-center justify-center text-gray-600 text-[8px]">
                        {label}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Status message */}
        {isCVProcessing && (
          <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-blue-400 text-center animate-pulse">
            High-resolution analysis in progress...
          </div>
        )}
        
        {/* Pixels per MM info */}
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
          <div className="relative w-full" style={{ aspectRatio: '16/9', maxHeight: '400px' }}>
            <video 
              src={entry.videoUrl} 
              controls 
              className="w-full h-full rounded-xl border border-gray-700 object-contain"
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
            <img src={entry.thumbnail} alt="Captured frame" className="w-full h-auto" />
          </div>
        </div>
      )}
    </div>
  );
}

