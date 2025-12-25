'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bookmark, ChevronRight, Trash2 } from 'lucide-react';
import { getSavedScans, deleteSavedScan, SavedScan } from '@/lib/saved-scans';

export default function SavedScansPage() {
  const [savedScans, setSavedScans] = useState<SavedScan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load all saved scans
  useEffect(() => {
    const loadScans = async () => {
      const scans = await getSavedScans();
      setSavedScans(scans);
      setIsLoading(false);
    };
    loadScans();
  }, []);

  // Handle delete
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (deletingId) return;
    setDeletingId(id);

    try {
      const success = await deleteSavedScan(id);
      if (success) {
        setSavedScans(scans => scans.filter(s => s.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete saved scan:', error);
    } finally {
      setDeletingId(null);
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <main className="min-h-screen bg-black text-white p-4 pb-24 flex flex-col items-center overflow-y-auto">
      <div className="w-full max-w-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/"
            className="p-2 -ml-2 text-gray-400 hover:text-purple-400 transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400 flex items-center gap-2">
              <Bookmark className="w-6 h-6 text-purple-400" />
              Saved Scans
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {savedScans.length} {savedScans.length === 1 ? 'comic' : 'comics'} in your collection
            </p>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center text-gray-400 py-12 border border-gray-800 rounded-2xl bg-gray-900/50">
            <p>Loading your collection...</p>
          </div>
        ) : savedScans.length === 0 ? (
          <div className="text-center text-gray-500 py-16 border border-gray-800 border-dashed rounded-2xl bg-gray-900/30 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
              <Bookmark className="w-8 h-8 text-gray-600" />
            </div>
            <div>
              <p className="text-lg font-medium text-white">No saved scans yet</p>
              <p className="text-sm mt-1 max-w-xs mx-auto">
                Grade a comic and tap &quot;Save to Collection&quot; to add it here.
              </p>
            </div>
            <Link
              href="/"
              className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Grade Your First Comic
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {savedScans.map((scan) => (
              <Link
                key={scan.id}
                href={`/saved/${scan.id}`}
                className="block bg-gray-900 hover:bg-gray-800 border border-purple-500/30 hover:border-purple-500/60 rounded-xl p-3 transition-all active:scale-[0.99] group"
              >
                <div className="flex items-center gap-4">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0 w-20 h-28 rounded-lg overflow-hidden bg-gray-800 shadow-lg relative">
                    {scan.thumbnail ? (
                      <img 
                        src={scan.thumbnail} 
                        alt={scan.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">
                        <Bookmark className="w-6 h-6" />
                      </div>
                    )}
                    {/* Grade Badge Overlay */}
                    <div className="absolute top-1 right-1 bg-purple-600/90 backdrop-blur text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      {scan.grade}
                    </div>
                  </div>
                  
                  {/* Info */}
                  <div className="flex-1 min-w-0 py-1">
                    <h3 className="font-bold text-lg text-white truncate leading-tight mb-1">
                      {scan.title}
                    </h3>
                    <p className="text-gray-400 text-sm mb-2">
                      Issue #{scan.issue}
                    </p>
                    <p className="text-gray-600 text-xs">
                      Saved {formatDate(scan.created_at)}
                    </p>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <button
                      onClick={(e) => handleDelete(e, scan.id)}
                      disabled={deletingId === scan.id}
                      className="p-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove from collection"
                    >
                      <Trash2 className={`w-5 h-5 ${deletingId === scan.id ? 'animate-pulse' : ''}`} />
                    </button>
                    <div className="text-purple-500/60 pr-2">
                      <ChevronRight className="w-6 h-6" />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

