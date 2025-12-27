'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getVideoById } from '@/lib/history';
import ResultSheet from '@/components/ResultSheet';

export default function ResultPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [videoItem, setVideoItem] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    if (id) {
      const loadItem = () => {
        const item = getVideoById(id);
        if (item) {
          setVideoItem(item);
        }
      };

      loadItem();

      // Listen for analysis updates (including multi-frame Gemini analysis)
      const handleAnalysisUpdate = (e: CustomEvent) => {
        if (e.detail?.historyId === id) {
          console.log('[ResultModal] Analysis update received, reloading item');
          loadItem();
        }
      };

      window.addEventListener('analysis-update' as any, handleAnalysisUpdate);
      
      return () => {
        window.removeEventListener('analysis-update' as any, handleAnalysisUpdate);
      };
    }
  }, [id]);

  const handleClose = () => {
    router.back();
  };

  // Render immediately with streaming support
  // Pass historyId for streaming updates
  return (
    <ResultSheet 
        isOpen={true} 
        onClose={handleClose}
        historyId={id}
        result={videoItem?.result} 
        videoUrl={videoItem?.videoUrl} 
        thumbnail={videoItem?.thumbnail}
        isLoading={!mounted}
        isStreaming={videoItem?.result?._pending === true}
    />
  );
}
