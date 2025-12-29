'use client';

import { Maximize2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

interface VideoPreviewCardProps {
  videoUrl?: string | null;
  thumbnail?: string | null;
  status: string;
  onOpenImage: (url: string, title: string, desc: string) => void;
}

export default function VideoPreviewCard({
  videoUrl,
  thumbnail,
  status,
  onOpenImage
}: VideoPreviewCardProps) {
  const [progress, setProgress] = useState(0);

  // Simulated upload progress
  useEffect(() => {
    if (status !== 'uploading') {
      if (status !== 'error') setProgress(100);
      return;
    }

    const target = 95;
    const speed = 100;
    
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= target) return prev;
        const remaining = target - prev;
        const step = Math.max(0.5, remaining / 10);
        return Math.min(target, prev + (Math.random() * step));
      });
    }, speed);

    return () => clearInterval(timer);
  }, [status]);

  if (!videoUrl && !thumbnail && status === 'uploading') {
    return (
      <div className="mb-6 w-full max-w-2xl">
        <p className="text-gray-400 text-sm mb-2 text-center">Uploading Video...</p>
        <div className="relative w-full aspect-video bg-gray-900 rounded-xl border border-gray-700 flex flex-col items-center justify-center p-8">
           <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
           <div className="w-full max-w-xs bg-gray-800 rounded-full h-2 overflow-hidden">
             <div 
               className="bg-purple-500 h-full transition-all duration-300 ease-out"
               style={{ width: `${progress}%` }}
             />
           </div>
           <p className="text-xs text-gray-500 mt-2">{Math.round(progress)}%</p>
        </div>
      </div>
    );
  }

  if (videoUrl) {
    return (
      <div className="mb-6 w-full max-w-2xl">
        <p className="text-gray-400 text-sm mb-2 text-center">Video Preview</p>
        <div className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-black">
          <video 
            src={videoUrl} 
            controls 
            playsInline
            className="w-full h-auto max-h-[80vh]"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    );
  }

  if (thumbnail) {
    return (
      <div className="mb-6 w-full max-w-2xl">
        <p className="text-gray-400 text-sm mb-2 text-center">Captured Frame</p>
        <div className="rounded-xl border border-gray-700 overflow-hidden relative group">
          <img 
            src={thumbnail} 
            alt="Captured frame" 
            className="w-full h-auto cursor-pointer" 
            onClick={() => onOpenImage(thumbnail, "Captured Frame", "Thumbnail of the video scan.")}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
             <Maximize2 className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
          </div>
          {status === 'uploading' && (
             <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
                <div className="w-full max-w-xs bg-gray-800/50 rounded-full h-2 overflow-hidden backdrop-blur-sm">
                  <div 
                    className="bg-purple-500 h-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-300 mt-2">Uploading... {Math.round(progress)}%</p>
             </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
