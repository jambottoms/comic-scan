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
      const item = getVideoById(id);
      if (item) {
        setVideoItem(item);
      }
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
