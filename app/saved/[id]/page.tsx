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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadScan = async () => {
      if (id) {
        const scan = await getSavedScanById(id);
        setSavedScan(scan);
        setLoading(false);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white p-4 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!savedScan) {
    return (
      <div className="min-h-screen bg-black text-white p-4 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Saved Scan Not Found</h1>
          <p className="text-gray-400 mb-4">The saved scan you&apos;re looking for doesn&apos;t exist or has been deleted.</p>
          <button onClick={() => router.push('/saved')} className="text-purple-400 hover:text-purple-300 underline">
            Return to Saved Scans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
        <ResultSheet 
            isOpen={true}
            onClose={handleClose}
            result={savedScan.result} 
            videoUrl={savedScan.video_url} 
            thumbnail={savedScan.thumbnail || undefined}
            savedScanId={savedScan.id}
            onDelete={handleDelete}
        />
    </div>
  );
}

