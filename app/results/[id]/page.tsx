'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getVideoById } from '@/lib/history';
import ResultCard from '@/components/ResultCard';

export default function ResultPage() {
  const params = useParams();
  const id = params.id as string;
  const [videoItem, setVideoItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      const item = getVideoById(id);
      if (item) {
        setVideoItem(item);
      }
      setLoading(false);
    }
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!videoItem) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Video Not Found</h1>
          <p className="text-gray-400 mb-4">The video you're looking for doesn't exist or has been deleted.</p>
          <a href="/" className="text-purple-400 hover:text-purple-300 underline">
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <ResultCard result={videoItem.result} videoUrl={videoItem.videoUrl} thumbnail={videoItem.thumbnail} />;
}

