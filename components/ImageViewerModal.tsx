'use client';

import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useState, useEffect } from 'react';

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  title?: string;
  description?: string;
  timestamp?: string; // e.g. "0:15"
}

export default function ImageViewerModal({
  isOpen,
  onClose,
  imageUrl,
  title,
  description,
  timestamp
}: ImageViewerModalProps) {
  const [scale, setScale] = useState(1);
  const [isClosing, setIsClosing] = useState(false);
  const [showControls, setShowControls] = useState(true);
  
  // Reset scale when image changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setIsClosing(false);
      setShowControls(true);
      // Prevent scrolling on body
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, imageUrl]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  // Toggle controls on tap/click
  const toggleControls = (e: React.MouseEvent) => {
    // Don't toggle if clicking a button
    if ((e.target as HTMLElement).closest('button')) return;
    setShowControls(prev => !prev);
  };

  if (!isOpen && !isClosing) return null;
  if (!imageUrl) return null;

  return (
    <div 
      className={`fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}
      onClick={toggleControls}
    >
      {/* Top Bar - Transparent with gradient */}
      <div 
        className={`absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex flex-col">
          <div className="text-white/70 font-mono text-[10px] uppercase tracking-widest">
            {timestamp ? `TIME: ${timestamp}` : 'IMAGE VIEWER'}
          </div>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          className="p-2 bg-gray-800/60 hover:bg-gray-700/80 rounded-full text-white backdrop-blur-md transition-all border border-gray-600/50"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Image Container */}
      <div className="flex-1 w-full h-full flex items-center justify-center overflow-hidden relative">
        <div 
          className="relative transition-transform duration-200 ease-out will-change-transform"
          style={{ transform: `scale(${scale})` }}
        >
          <img 
            src={imageUrl} 
            alt={title || "Enlarged view"} 
            className="max-w-full max-h-[100vh] object-contain select-none"
            draggable={false}
          />
        </div>
      </div>
      
      {/* Zoom Controls */}
      <div 
        className={`absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <button 
          onClick={(e) => { e.stopPropagation(); setScale(s => Math.min(s + 0.5, 3)); }}
          className="p-3 bg-gray-800/60 hover:bg-gray-700/80 rounded-full text-white backdrop-blur-md transition-all border border-gray-600/50 shadow-lg"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); setScale(s => Math.max(s - 0.5, 1)); }}
          className="p-3 bg-gray-800/60 hover:bg-gray-700/80 rounded-full text-white backdrop-blur-md transition-all border border-gray-600/50 shadow-lg"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom Information Overlay - Transparent Section */}
      {(title || description) && (
        <div 
          className={`absolute bottom-0 left-0 right-0 p-6 z-20 bg-gradient-to-t from-black via-black/90 to-transparent pb-10 pt-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-lg mx-auto bg-black/40 backdrop-blur-sm p-4 rounded-xl border border-white/10">
            {title && (
              <h3 className="text-lg font-black text-white mb-2 uppercase tracking-tight leading-tight flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-500 rounded-full inline-block"></span>
                {title}
              </h3>
            )}
            {description && (
              <p className="text-sm text-gray-200 leading-relaxed font-light pl-3 border-l border-gray-700">
                {description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



