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

      // Listen for analysis updates (including multi-frame Gemini analysis)
      const handleAnalysisUpdate = (e: CustomEvent) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/687f9f08-c30c-4c86-ad3f-6622e9cc4b71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:30',message:'Analysis update event',data:{eventHistoryId:e.detail?.historyId,pageId:id,matches:e.detail?.historyId===id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        if (e.detail?.historyId === id) {
          console.log('[ResultPage] Analysis update received, reloading item');
          loadItem();
        }
      };

      window.addEventListener('analysis-update' as any, handleAnalysisUpdate);
      
      return () => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/687f9f08-c30c-4c86-ad3f-6622e9cc4b71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:39',message:'Cleaning up event listener',data:{id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        window.removeEventListener('analysis-update' as any, handleAnalysisUpdate);
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
            historyId={id}
            result={videoItem.result} 
            videoUrl={videoItem.videoUrl} 
            thumbnail={videoItem.thumbnail} 
        />
    </div>
  );
}

