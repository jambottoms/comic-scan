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

  const handleClose = () => {
    router.back();
  };

  // While loading or if not found, we don't want to block the user completely
  // but we also don't want to show nothing if it takes a moment.
  // Since this is local storage, it should be instant.
  if (loading) {
    return null;
  }

  if (!videoItem) {
    return null; // Don't show anything if item doesn't exist (or maybe show an error toast?)
  }

  return (
    <ResultSheet 
        isOpen={true} 
        onClose={handleClose}
        result={videoItem.result} 
        videoUrl={videoItem.videoUrl} 
        thumbnail={videoItem.thumbnail} 
    />
  );
}

