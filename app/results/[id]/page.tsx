'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getVideoById } from '@/lib/history';
import ResultSheet from '@/components/ResultSheet';

export const dynamic = 'force-dynamic';  // Prevent caching of server actions

export default function ResultPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [videoItem, setVideoItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      const loadItem = () => {
        const item = getVideoById(id);
        if (item) {
          setVideoItem(item);
        }
        setLoading(false);
      };

      loadItem();

      // Listen for CV analysis updates
      const handleCVUpdate = (e: CustomEvent) => {
        if (e.detail?.historyId === id) {
          console.log('[ResultPage] CV analysis update received, reloading item');
          loadItem();
        }
      };

      window.addEventListener('cv-analysis-complete' as any, handleCVUpdate);
      
      return () => {
        window.removeEventListener('cv-analysis-complete' as any, handleCVUpdate);
      };
    }
  }, [id]);

  const handleClose = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white p-4 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!videoItem) {
    return (
      <div className="min-h-screen bg-black text-white p-4 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Video Not Found</h1>
          <p className="text-gray-400 mb-4">The video you're looking for doesn't exist or has been deleted.</p>
          <button onClick={handleClose} className="text-purple-400 hover:text-purple-300 underline">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // We render the ResultSheet immediately as "open" to trigger the slide-up animation
  // The underlying page background can be black or the dashboard if we were using parallel routes
  return (
    <div className="min-h-screen bg-black">
        <ResultSheet 
            isOpen={true} 
            onClose={handleClose}
            result={videoItem.result} 
            videoUrl={videoItem.videoUrl} 
            thumbnail={videoItem.thumbnail} 
        />
    </div>
  );
}

