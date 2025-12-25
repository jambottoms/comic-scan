'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSavedScanById, SavedScan } from '@/lib/saved-scans';
import ResultSheet from '@/components/ResultSheet';

export default function SavedScanPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [savedScan, setSavedScan] = useState<SavedScan | null>(null);

  useEffect(() => {
    const loadScan = async () => {
      if (id) {
        const scan = await getSavedScanById(id);
        setSavedScan(scan);
      }
    };
    loadScan();
  }, [id]);

  // Handle deletion - redirect to saved page
  const handleDelete = () => {
    router.replace('/saved');
  };

  const handleClose = () => {
    router.back();
  };

  // Render immediately with isOpen=true
  return (
    <ResultSheet 
        isOpen={true}
        onClose={handleClose}
        result={savedScan?.result} 
        videoUrl={savedScan?.video_url || null} 
        thumbnail={savedScan?.thumbnail || undefined}
        savedScanId={savedScan?.id}
        onDelete={handleDelete}
        isLoading={!savedScan} // Pass loading state
    />
  );
}
