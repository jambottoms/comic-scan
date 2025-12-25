'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getVideoHistory } from '@/lib/history';
import FabMenu from '@/components/FabMenu';
import GradeBookModal from '@/components/GradeBookModal';

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  buildTime: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [history, setHistory] = useState<ReturnType<typeof getVideoHistory>>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  
  // Modal State
  const [isGradeBookOpen, setIsGradeBookOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'record' | 'upload'>('record');

  // Load history only on client side after mount to prevent hydration mismatch
  useEffect(() => {
    setIsMounted(true);
    setHistory(getVideoHistory());
  }, []);

  // Fetch version info on mount
  useEffect(() => {
    fetch('/version.json')
      .then(res => res.json())
      .then(data => setVersionInfo(data))
      .catch(err => {
        console.error('Failed to load version info:', err);
        setVersionInfo({
          version: '0.1.0',
          commitHash: 'unknown',
          commitDate: new Date().toISOString().split('T')[0],
          buildTime: new Date().toISOString(),
        });
      });
  }, []);

  const handleGradeSuccess = (historyId: string) => {
    setIsGradeBookOpen(false);
    // Refresh history if they come back (though we redirect away)
    setHistory(getVideoHistory());
    router.push(`/results/${historyId}`);
  };

  const handleRecord = () => {
    setInitialTab('record');
    setIsGradeBookOpen(true);
  };

  const handleUpload = () => {
    setInitialTab('upload');
    setIsGradeBookOpen(true);
  };

  const handleIdentify = () => {
    // Placeholder for identify functionality
    console.log("Identify clicked");
    // For now, maybe just open record mode? Or do nothing?
    // Let's leave it as a log for now until functionality is defined.
  };

  // Format date for display
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <main className="min-h-screen bg-black text-white p-4 pb-24 flex flex-col items-center overflow-y-auto">
      <div className="w-full max-w-2xl flex flex-col items-center">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">
            ComicScan
        </h1>
        
        {versionInfo && (
            <div className="text-gray-600 text-xs mb-8">
              v{versionInfo.version}
            </div>
        )}

        {/* Video History List */}
        <div className="w-full">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-purple-400">Your Collection</span>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded-full">{history.length}</span>
            </h2>
            
            {!isMounted ? (
            // Show loading state during SSR/hydration to prevent mismatch
            <div className="text-center text-gray-400 py-12 border border-gray-800 rounded-2xl bg-gray-900/50">
                <p>Loading history...</p>
            </div>
            ) : history.length === 0 ? (
            <div className="text-center text-gray-500 py-16 border border-gray-800 rounded-2xl bg-gray-900/50 flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center text-3xl">📚</div>
                <div>
                    <p className="text-lg font-medium text-white">No comics yet</p>
                    <p className="text-sm mt-1 max-w-xs mx-auto">Tap the + button to grade your first comic book or add to your collection.</p>
                </div>
            </div>
            ) : (
            <div className="space-y-3 pb-20">
                {history.map((item) => (
                <Link
                    key={item.id}
                    href={`/results/${item.id}`}
                    className="block bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-purple-500/50 rounded-xl p-3 transition-all active:scale-[0.99]"
                >
                    <div className="flex items-center gap-4">
                    {/* Thumbnail */}
                    <div className="flex-shrink-0 w-20 h-28 rounded-lg overflow-hidden bg-gray-800 shadow-lg relative">
                        {item.thumbnail ? (
                        <img 
                            src={item.thumbnail} 
                            alt={item.title}
                            className="w-full h-full object-cover"
                        />
                        ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <span>No Img</span>
                        </div>
                        )}
                        {/* Grade Badge Overlay */}
                         <div className="absolute top-1 right-1 bg-black/80 backdrop-blur text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                            {item.grade}
                         </div>
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0 py-1">
                        <h3 className="font-bold text-lg text-white truncate leading-tight mb-1">
                        {item.title}
                        </h3>
                        <p className="text-gray-400 text-sm mb-2">
                        Issue #{item.issue}
                        </p>
                        <p className="text-gray-600 text-xs">
                        {formatDate(item.timestamp)}
                        </p>
                    </div>
                    
                    {/* Arrow */}
                    <div className="flex-shrink-0 text-gray-600 pr-2">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                    </div>
                    </div>
                </Link>
                ))}
            </div>
            )}
        </div>
      </div>

      <FabMenu 
        onRecord={handleRecord}
        onUpload={handleUpload}
        onIdentify={handleIdentify}
      />

      <GradeBookModal 
        isOpen={isGradeBookOpen}
        onClose={() => setIsGradeBookOpen(false)}
        onSuccess={handleGradeSuccess}
        initialTab={initialTab}
      />
    </main>
  );
}
