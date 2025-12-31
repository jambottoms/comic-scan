'use client';

import { useState, useEffect, useMemo } from 'react';
import { getVideoById } from '@/lib/history';
import { subscribeToUpdates } from '@/lib/streaming-analysis';
import VideoPreviewCard from './analysis/VideoPreviewCard';
import TotalAnalysisCard from './analysis/TotalAnalysisCard';
import MathComponentCard from './analysis/MathComponentCard';
import AIAnalysisCard from './analysis/AIAnalysisCard';
import CVAnalysisCard from './analysis/CVAnalysisCard';
import ImageViewerModal from './ImageViewerModal';

interface GradingAnalysisViewProps {
  historyId: string;
}

export default function GradingAnalysisView({ historyId }: GradingAnalysisViewProps) {
  const [entry, setEntry] = useState(() => getVideoById(historyId));
  const [status, setStatus] = useState<string>(entry?.result?._status || 'uploading');
  
  // Image Viewer State
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageTitle, setSelectedImageTitle] = useState<string>("");
  const [selectedImageDesc, setSelectedImageDesc] = useState<string>("");

  const handleOpenImage = (url: string, title: string, desc: string) => {
    setSelectedImage(url);
    setSelectedImageTitle(title);
    setSelectedImageDesc(desc);
    setImageViewerOpen(true);
  };

  // Subscribe to real-time updates
  useEffect(() => {
    const current = getVideoById(historyId);
    if (current) {
      setEntry(current);
      setStatus(current.result?._status || 'uploading');
    }
    
    const unsubscribe = subscribeToUpdates(historyId, (data) => {
      if (data.status) {
        setStatus(data.status);
      }
      const updated = getVideoById(historyId);
      if (updated) {
        setEntry(updated);
      }
    });
    
    return unsubscribe;
  }, [historyId]);

  // Polling fallback
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
    }, 1000);
    
    return () => clearInterval(interval);
  }, [historyId, status]);

  if (!entry) {
    return <div className="min-h-screen bg-gray-900 text-white p-4 flex items-center justify-center">Loading...</div>;
  }

  const result = entry.result || {};
  const isAnalyzing = status === 'analyzing' || status === 'uploading';
  
  // MEMOIZE expensive computations to prevent recalculating on every render
  const { showAI, showCV, showMath, displayDefects } = useMemo(() => {
    // Phase Logic
    const ai = status !== 'uploading'; // Show AI card once uploading finishes (analyzing starts)
    const cv = status === 'ai_complete' || status === 'frames_ready' || status === 'cv_processing' || status === 'complete';
    const math = ai; // Show math card with AI results, update with CV later

    // Construct defects list for Math card
    const aiDefects = result.reasoning && Array.isArray(result.reasoning) ? result.reasoning : [];
    const cvDefects = result.hybridGrade?.defectBreakdown || [];
    const defects = cvDefects.length > 0 ? cvDefects : aiDefects;

    // DEBUG: Log what we're passing to MathComponentCard
    console.log('[GradingAnalysisView] Passing to MathComponentCard:', {
      displayDefects: defects,
      regionGrades: result.hybridGrade?.cvAnalysis?.regionGrades || result.hybridGrade?.nyckelRegions,
      finalGrade: result.hybridGrade?.displayGrade || result.estimatedGrade,
      fullHybridGrade: result.hybridGrade,
      status
    });

    return {
      showAI: ai,
      showCV: cv,
      showMath: math,
      displayDefects: defects
    };
  }, [status, result.reasoning, result.hybridGrade?.defectBreakdown, result.hybridGrade, result.estimatedGrade]);

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center min-h-screen bg-gray-900 text-white p-4 pb-20">
      
      {/* 1. Top Summary Card */}
      <TotalAnalysisCard 
        status={status}
        aiGrade={result.estimatedGrade}
        hybridGrade={result.hybridGrade}
      />

      {/* 2. Video Preview */}
      <VideoPreviewCard 
        videoUrl={entry.videoUrl}
        thumbnail={entry.thumbnail}
        status={status}
        onOpenImage={handleOpenImage}
      />

      {/* 3. Math Breakdown (The "Receipt") */}
      {showMath && (
        <MathComponentCard 
          defects={displayDefects}
          regionGrades={result.hybridGrade?.cvAnalysis?.regionGrades || result.hybridGrade?.nyckelRegions}
          finalGrade={result.hybridGrade?.displayGrade || result.estimatedGrade}
        />
      )}

      {/* 4. Phase 1: AI Analysis Details */}
      {showAI && (
        <AIAnalysisCard 
          isAnalyzing={isAnalyzing}
          result={result}
        />
      )}

      {/* 5. Phase 2: Computer Vision Details */}
      {showCV && (
        <CVAnalysisCard 
          historyId={historyId}
          status={status}
          result={result}
          onOpenImage={handleOpenImage}
        />
      )}

      {/* Image Viewer Modal */}
      <ImageViewerModal
        isOpen={imageViewerOpen}
        onClose={() => setImageViewerOpen(false)}
        imageUrl={selectedImage}
        title={selectedImageTitle}
        description={selectedImageDesc}
      />
    </div>
  );
}
