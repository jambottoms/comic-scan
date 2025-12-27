'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Bookmark } from 'lucide-react';
import { getVideoHistory } from '@/lib/history';
import { getSavedScans, SavedScan } from '@/lib/saved-scans';
import FabMenu from '@/components/FabMenu';
import GradeBookModal from '@/components/GradeBookModal';
import TrainingModal from '@/components/TrainingModal';

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  buildTime: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [history, setHistory] = useState<ReturnType<typeof getVideoHistory>>([]);
  const [savedScans, setSavedScans] = useState<SavedScan[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  
  // Modal State
  const [isGradeBookOpen, setIsGradeBookOpen] = useState(false);
  const [isTrainingOpen, setIsTrainingOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'record' | 'upload' | 'train'>('record');

  // Load history and saved scans only on client side after mount to prevent hydration mismatch
  useEffect(() => {
    setIsMounted(true);
    setHistory(getVideoHistory());
    
    // Load saved scans from Supabase
    const loadSavedScans = async () => {
      const scans = await getSavedScans(3);
      setSavedScans(scans);
    };
    loadSavedScans();
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

  const handleTrain = () => {
    setIsTrainingOpen(true);
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
            GradeVault
        </h1>
        
        {versionInfo && (
            <div className="text-gray-600 text-xs mb-8">
              v{versionInfo.version}
            </div>
        )}

        {/* Video History List - Show last 3 */}
        <div className="w-full">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-purple-400">Your Previous Scans</span>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded-full">{Math.min(history.length, 3)}/{history.length}</span>
            </h2>
            
            {!isMounted ? (
            // Show loading state during SSR/hydration to prevent mismatch
            <div className="text-center text-gray-400 py-12 border border-gray-800 rounded-2xl bg-gray-900/50">
                <p>Loading history...</p>
            </div>
            ) : history.length === 0 ? (
            <div className="text-center text-gray-500 py-16 border border-gray-800 rounded-2xl bg-gray-900/50 flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center text-3xl">🎴</div>
                <div>
                    <p className="text-lg font-medium text-white">No scans yet</p>
                    <p className="text-sm mt-1 max-w-xs mx-auto">Tap the + button to grade your first collectible — comics, cards, toys & more.</p>
                </div>
            </div>
            ) : (
            <div className="space-y-3">
                {history.slice(0, 3).map((item) => (
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
        
        {/* Saved Scans Section */}
        <div className="w-full mt-8">
            <Link href="/saved" className="group flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-purple-400" />
                    <span className="text-purple-400">Your Saved Scans</span>
                    {savedScans.length > 0 && (
                      <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-1 rounded-full">{savedScans.length}</span>
                    )}
                </h2>
                <span className="text-gray-500 group-hover:text-purple-400 transition-colors flex items-center gap-1 text-sm">
                    View All
                    <ChevronRight className="w-4 h-4" />
                </span>
            </Link>
            
            {!isMounted ? (
            <div className="text-center text-gray-400 py-8 border border-gray-800 rounded-2xl bg-gray-900/50">
                <p>Loading saved scans...</p>
            </div>
            ) : savedScans.length === 0 ? (
            <div className="text-center text-gray-500 py-12 border border-gray-800 border-dashed rounded-2xl bg-gray-900/30 flex flex-col items-center gap-3">
                <Bookmark className="w-10 h-10 text-gray-700" />
                <div>
                    <p className="text-sm font-medium text-gray-400">No saved scans yet</p>
                    <p className="text-xs mt-1 text-gray-600 max-w-xs mx-auto">Save scans from your grade cards to build your collection.</p>
                </div>
            </div>
            ) : (
            <div className="space-y-3 pb-20">
                {savedScans.map((scan) => (
                <Link
                    key={scan.id}
                    href={`/saved/${scan.id}`}
                    className="block bg-gray-900 hover:bg-gray-800 border border-purple-500/30 hover:border-purple-500/60 rounded-xl p-3 transition-all active:scale-[0.99]"
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
                        Saved {formatDate(new Date(scan.created_at).getTime())}
                        </p>
                    </div>
                    
                    {/* Arrow */}
                    <div className="flex-shrink-0 text-purple-500/60 pr-2">
                        <ChevronRight className="w-6 h-6" />
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
        onTrain={handleTrain}
        isHidden={isGradeBookOpen || isTrainingOpen}
      />

      <GradeBookModal 
        isOpen={isGradeBookOpen}
        onClose={() => setIsGradeBookOpen(false)}
        onSuccess={handleGradeSuccess}
        initialTab={initialTab}
      />

      {isTrainingOpen && (
        <TrainingModal 
          onClose={() => setIsTrainingOpen(false)}
        />
      )}
    </main>
  );
}
