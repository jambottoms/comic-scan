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
  
  // Try to load immediately during render if possible, 
  // but be careful of hydration mismatches.
  // Since getVideoById uses localStorage, we must wait for mount.
  // However, we can render the sheet immediately in a loading state.

  useEffect(() => {
    if (id) {
      const item = getVideoById(id);
      if (item) {
        setVideoItem(item);
      }
    }
  }, [id]);

  const handleClose = () => {
    router.back();
  };

  // Render immediately with isOpen=true
  // If videoItem is null, ResultSheet will handle the loading state or show skeleton
  return (
    <ResultSheet 
        isOpen={true} 
        onClose={handleClose}
        result={videoItem?.result} 
        videoUrl={videoItem?.videoUrl} 
        thumbnail={videoItem?.thumbnail}
        isLoading={!videoItem} // Pass loading state
    />
  );
}
