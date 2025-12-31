'use client';

import { useEffect, useState } from 'react';
import { Camera, Loader2, Maximize2, Flame, Grid3X3, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProgressPolling } from '@/lib/use-progress-polling';
import GradeScorecard from '../GradeScorecard';
import { REGION_DISPLAY_NAMES, type RegionName } from '@/lib/grading-config';

interface CVAnalysisCardProps {
  historyId: string;
  status: string;
  result: any;
  onOpenImage: (url: string, title: string, desc: string) => void;
}

/**
 * Get color class based on grade value
 */
function getGradeColor(grade: number): string {
  if (grade >= 9.0) return 'text-green-400 border-green-500';
  if (grade >= 7.0) return 'text-yellow-400 border-yellow-500';
  if (grade >= 5.0) return 'text-orange-400 border-orange-500';
  return 'text-red-400 border-red-500';
}

function getGradeBg(grade: number): string {
  if (grade >= 9.0) return 'bg-green-500/20';
  if (grade >= 7.0) return 'bg-yellow-500/20';
  if (grade >= 5.0) return 'bg-orange-500/20';
  return 'bg-red-500/20';
}

export default function CVAnalysisCard({
  historyId,
  status,
  result,
  onOpenImage
}: CVAnalysisCardProps) {
  const isComplete = status === 'complete';
  const isProcessing = status === 'ai_complete' || status === 'frames_ready' || status === 'cv_processing';
  
  // State for frame carousel
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  
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
  
  // Extract CV images (new multi-frame format)
  const images = cvData.images || cvData;
  
  // NEW: Multi-frame structural heatmaps and defect overlays
  const structuralHeatmaps: Array<{frameIndex: number; url: string; damageScore: number}> = 
    images.structuralHeatmaps || [];
  const defectOverlays: Array<{frameIndex: number; url: string; defectCounts: any}> = 
    images.defectOverlays || [];
  const bestFrameIndex: number = images.bestFrameIndex ?? 0;
  
  // Fallback to old format if new format not available
  const varianceHeatmap = images.varianceMap || images.varianceHeatmap || cvData.varianceMap;
  const defectMask = images.defectMask || cvData.defectMask;
  
  // Region crops and overlays
  const regionCrops = images.regionCrops || images.regions || cvData.regionCrops || {};
  const regionOverlays = images.regionOverlays || cvData.regionOverlays || {};
  
  // Nyckel grades for region display
  const nyckelGrades = result.hybridGrade?.nyckelRegions || cvData.regionGrades || {};
  
  // Check what data we have
  const hasNewHeatmaps = structuralHeatmaps.length > 0;
  const hasNewOverlays = defectOverlays.length > 0;
  const hasOldHeatmaps = varianceHeatmap || defectMask;
  const hasHeatmaps = hasNewHeatmaps || hasNewOverlays || hasOldHeatmaps;
  const hasRegionCrops = Object.keys(regionCrops).length > 0 || Object.keys(nyckelGrades).length > 0;
  
  // Set initial frame to best frame
  useEffect(() => {
    if (structuralHeatmaps.length > 0) {
      setSelectedFrameIndex(bestFrameIndex);
    }
  }, [bestFrameIndex, structuralHeatmaps.length]);
  
  // Get current frame's data
  const currentHeatmap = structuralHeatmaps.find(h => h.frameIndex === selectedFrameIndex);
  const currentOverlay = defectOverlays.find(o => o.frameIndex === selectedFrameIndex);
  
  // Frame navigation
  const numFrames = Math.max(structuralHeatmaps.length, defectOverlays.length, 1);
  const canGoLeft = selectedFrameIndex > 0;
  const canGoRight = selectedFrameIndex < numFrames - 1;

  return (
    <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-xl border border-gray-700 mb-6 shadow-lg">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Computer Vision Analysis
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
          
          {/* Mobile Debug Info */}
          <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 font-mono">
            <div>Status: {status}</div>
            <div>Polling: {isProcessing && !isComplete ? 'ENABLED' : 'DISABLED'}</div>
            <div>Progress: {progress.percentage}% | {progress.step}</div>
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

      {/* Damage Visualization - NEW Multi-Frame Heatmaps */}
      {(hasHeatmaps || isComplete) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Flame className="w-3 h-3 text-orange-400" />
              <h4 className="text-[10px] font-bold text-gray-500 uppercase">Damage Visualization</h4>
            </div>
            
            {/* Frame selector (if multiple frames) */}
            {numFrames > 1 && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setSelectedFrameIndex(i => Math.max(0, i - 1))}
                  disabled={!canGoLeft}
                  className="p-1 rounded bg-gray-700 disabled:opacity-30 hover:bg-gray-600"
                >
                  <ChevronLeft className="w-3 h-3 text-gray-300" />
                </button>
                <span className="text-[10px] text-gray-400 font-mono">
                  Frame {selectedFrameIndex + 1}/{numFrames}
                  {selectedFrameIndex === bestFrameIndex && (
                    <span className="ml-1 text-green-400">★ Best</span>
                  )}
                </span>
                <button 
                  onClick={() => setSelectedFrameIndex(i => Math.min(numFrames - 1, i + 1))}
                  disabled={!canGoRight}
                  className="p-1 rounded bg-gray-700 disabled:opacity-30 hover:bg-gray-600"
                >
                  <ChevronRight className="w-3 h-3 text-gray-300" />
                </button>
              </div>
            )}
          </div>
          
          <p className="text-[10px] text-gray-500 mb-3">
            Structural damage heatmap and color-coded defect overlay for selected frame.
          </p>
          
          <div className="grid grid-cols-2 gap-3">
            {/* Structural Heatmap */}
            <div className="space-y-1">
              <span className="text-[9px] text-gray-500 uppercase">Structural Heatmap</span>
              {isProcessing && !currentHeatmap && !varianceHeatmap ? (
                <div className={`aspect-[3/4] ${skeleton} flex items-center justify-center`}>
                  <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                </div>
              ) : currentHeatmap?.url || varianceHeatmap ? (
                <button
                  onClick={() => onOpenImage(
                    currentHeatmap?.url || varianceHeatmap, 
                    `Structural Heatmap${currentHeatmap ? ` (Frame ${selectedFrameIndex + 1})` : ''}`, 
                    `Edge/gradient analysis showing creases, tears, spine stress. ${currentHeatmap ? `Damage: ${currentHeatmap.damageScore.toFixed(1)}%` : ''}`
                  )}
                  className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 group hover:border-orange-500 transition-colors w-full"
                >
                  <img 
                    src={currentHeatmap?.url || varianceHeatmap} 
                    alt="Structural Heatmap" 
                    className="w-full h-full object-cover" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-2">
                    <div className="flex-1">
                      <span className="text-[9px] text-orange-300 font-medium">Creases & Tears</span>
                      {currentHeatmap?.damageScore !== undefined && (
                        <div className="text-[8px] text-gray-300">
                          {currentHeatmap.damageScore.toFixed(1)}% damage
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />
                  </div>
                </button>
              ) : (
                <div className="aspect-[3/4] bg-gray-700/50 rounded-lg flex items-center justify-center border border-gray-600">
                  <span className="text-[9px] text-gray-500">Not available</span>
                </div>
              )}
            </div>
            
            {/* Defect Overlay (Color-Coded) */}
            <div className="space-y-1">
              <span className="text-[9px] text-gray-500 uppercase">Defect Overlay</span>
              {isProcessing && !currentOverlay && !defectMask ? (
                <div className={`aspect-[3/4] ${skeleton} flex items-center justify-center`}>
                  <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                </div>
              ) : currentOverlay?.url || defectMask ? (
                <button
                  onClick={() => onOpenImage(
                    currentOverlay?.url || defectMask, 
                    `Defect Overlay${currentOverlay ? ` (Frame ${selectedFrameIndex + 1})` : ''}`, 
                    "Yellow = stains/foxing, Red = tears/creases, Cyan = surface wear"
                  )}
                  className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 group hover:border-red-500 transition-colors w-full"
                >
                  <img 
                    src={currentOverlay?.url || defectMask} 
                    alt="Defect Overlay" 
                    className="w-full h-full object-cover" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-2">
                    <div className="flex-1">
                      <span className="text-[9px] text-red-300 font-medium">Color-Coded</span>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-[7px] text-yellow-300">●Stains</span>
                        <span className="text-[7px] text-red-300">●Tears</span>
                        <span className="text-[7px] text-cyan-300">●Wear</span>
                      </div>
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />
                  </div>
                </button>
              ) : (
                <div className="aspect-[3/4] bg-gray-700/50 rounded-lg flex items-center justify-center border border-gray-600">
                  <span className="text-[9px] text-gray-500">Not available</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Defect Legend */}
          {(currentOverlay || defectMask) && (
            <div className="mt-3 p-2 bg-gray-900/50 rounded-lg">
              <div className="flex flex-wrap gap-3 text-[9px]">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                  <span className="text-gray-400">Stains / Foxing</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-gray-400">Tears / Creases</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
                  <span className="text-gray-400">Surface Wear</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Region Crops Gallery */}
      {(hasRegionCrops || isComplete) && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Grid3X3 className="w-3 h-3 text-cyan-400" />
            <h4 className="text-[10px] font-bold text-gray-500 uppercase">Region Close-ups</h4>
          </div>
          <p className="text-[10px] text-gray-500 mb-3">
            Individual region crops analyzed by ML classifier.
          </p>
          
          <div className="grid grid-cols-3 gap-2">
            {/* Show skeleton if processing */}
            {isProcessing && !hasRegionCrops ? (
              ['spine', 'corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'surface'].map(region => (
                <div key={region} className="space-y-1">
                  <div className={`aspect-square ${skeleton}`}></div>
                  <div className={`h-3 ${skeleton} w-2/3`}></div>
                </div>
              ))
            ) : (
              /* Render actual region crops or nyckel grades */
              ['spine', 'corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'surface'].map(region => {
                const cropUrl = regionCrops[region];
                const overlayUrl = regionOverlays[region];
                const nyckelData = nyckelGrades[region];
                const grade = nyckelData?.grade ?? (10 - (regionScores[region] || 0) / 10.5);
                const label = nyckelData?.label || defectLabels[region]?.[0] || 'pristine';
                const confidence = nyckelData?.confidence;
                
                const displayName = REGION_DISPLAY_NAMES[region as RegionName] || region;
                const gradeColorClass = getGradeColor(grade);
                const gradeBgClass = getGradeBg(grade);
                
                return (
                  <div key={region} className="space-y-1">
                    {cropUrl ? (
                      <button
                        onClick={() => onOpenImage(overlayUrl || cropUrl, displayName, `Grade: ${grade.toFixed(1)} - ${label}`)}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 group transition-colors ${gradeColorClass.split(' ')[1] || 'border-gray-600'} hover:scale-105`}
                      >
                        <img src={cropUrl} alt={displayName} className="w-full h-full object-cover" />
                        {/* Grade badge overlay */}
                        <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${gradeBgClass} ${gradeColorClass.split(' ')[0]}`}>
                          {grade.toFixed(1)}
                        </div>
                        {/* Label at bottom */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                          <span className="text-[8px] text-white truncate block">{label !== 'pristine' ? label.replace(/_/g, ' ') : '✓'}</span>
                        </div>
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                        </div>
                      </button>
                    ) : nyckelData ? (
                      /* No image but have grade data */
                      <div className={`aspect-square rounded-lg border-2 ${gradeColorClass.split(' ')[1] || 'border-gray-600'} ${gradeBgClass} flex flex-col items-center justify-center`}>
                        <span className={`text-lg font-bold ${gradeColorClass.split(' ')[0]}`}>
                          {grade.toFixed(1)}
                        </span>
                        <span className="text-[8px] text-gray-400 truncate max-w-full px-1">
                          {label !== 'pristine' ? label.replace(/_/g, ' ') : '✓ Clean'}
                        </span>
                        {confidence && (
                          <span className="text-[7px] text-gray-500">{(confidence * 100).toFixed(0)}%</span>
                        )}
                      </div>
                    ) : (
                      /* Placeholder */
                      <div className="aspect-square bg-gray-700/30 rounded-lg border border-gray-700 flex items-center justify-center">
                        <span className="text-[9px] text-gray-600">—</span>
                      </div>
                    )}
                    <div className="text-[9px] text-gray-400 text-center truncate">{displayName}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Defect Ledger (Scorecard stripped to just defects) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-3 h-3 text-red-400" />
          <h4 className="text-[10px] font-bold text-gray-500 uppercase">Detected Issues</h4>
        </div>
        {isProcessing && !result.hybridGrade ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className={`${skeleton} w-16 h-4`}></div>
                <div className={`${skeleton} flex-1 h-3`}></div>
              </div>
            ))}
            <p className="text-xs text-center text-gray-500 mt-2 animate-pulse">
              Classifying defects...
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
