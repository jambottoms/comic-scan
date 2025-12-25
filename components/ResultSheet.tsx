'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Video, Upload, ScanLine } from 'lucide-react';
import ResultCard from '@/components/ResultCard';

interface ResultSheetProps {
  isOpen: boolean;
  onClose: () => void;
  result: any;
  videoUrl: string | null;
  thumbnail?: string;
  savedScanId?: string;
  onDelete?: () => void;
}

export default function ResultSheet({ 
  isOpen, 
  onClose, 
  result, 
  videoUrl, 
  thumbnail, 
  savedScanId, 
  onDelete 
}: ResultSheetProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Handle open animation
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure render happens before animation starts
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }
  }, [isOpen]);

  // Handle close animation
  const handleClose = () => {
    setIsClosing(true);
    setIsVisible(false);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200); // Faster animation duration
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col justify-end transition-all duration-200 ease-out ${isVisible && !isClosing ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/0 pointer-events-none'}`}>
      <div 
        className={`w-full bg-gray-900 border-t border-gray-800 rounded-t-3xl shadow-2xl overflow-hidden flex flex-col transition-transform duration-200 ease-out ${isVisible && !isClosing ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ height: '95vh' }}
      >
        
        {/* Header */}
        <div className="p-4 flex items-center justify-between bg-gray-900 z-20 relative border-b border-gray-800">
            <h2 className="text-xl font-bold text-white pl-2">Comic Grade</h2>
            <button onClick={handleClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
                <ChevronDown size={28} />
            </button>
        </div>

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto bg-gray-900 pb-8">
            <div className="p-4 flex justify-center">
                <ResultCard 
                    result={result} 
                    videoUrl={videoUrl} 
                    thumbnail={thumbnail} 
                    savedScanId={savedScanId} 
                    onDelete={() => {
                        if (onDelete) onDelete();
                        handleClose();
                    }}
                    embedded={true} // Add embedded prop to adjust internal layout if needed
                />
            </div>
        </div>
      </div>
    </div>
  );
}

