'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';

interface VideoInvestigatorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  timestamp: number; // seconds
}

export default function VideoInvestigatorModal({
  open,
  onOpenChange,
  videoUrl,
  timestamp,
}: VideoInvestigatorModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Seek to timestamp and pause when modal opens
  useEffect(() => {
    if (open && videoRef.current && isLoaded) {
      const video = videoRef.current;
      
      // Set timestamp and pause immediately
      video.currentTime = timestamp;
      video.pause();
      
      console.log(`[Video Investigator] Seeking to ${timestamp}s and pausing`);
    }
  }, [open, timestamp, isLoaded]);

  // Reset loaded state when video URL changes
  useEffect(() => {
    setIsLoaded(false);
  }, [videoUrl]);

  // Handle video loaded
  const handleLoadedMetadata = () => {
    setIsLoaded(true);
    if (videoRef.current) {
      videoRef.current.currentTime = timestamp;
      videoRef.current.pause();
    }
  };

  // Format timestamp for display
  const formatTimestamp = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95">
          <div className="relative w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-6xl bg-gray-900 rounded-lg sm:rounded-xl border border-gray-700 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/90 to-transparent p-3 sm:p-4 z-10 flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-base sm:text-xl font-bold text-white mb-0.5 sm:mb-1 truncate">
                  Video Investigator
                </Dialog.Title>
                <p className="text-xs sm:text-sm text-gray-400">
                  Frame at {formatTimestamp(timestamp)}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-1.5 px-3 sm:py-2 sm:px-4 rounded-lg transition-colors text-sm sm:text-base flex-shrink-0"
                  aria-label="Close"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>

            {/* Video */}
            <div className="w-full flex-1 flex items-center justify-center pt-14 sm:pt-20 pb-2 sm:pb-4 min-h-0">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                preload="metadata"
                className="w-full h-full max-h-[calc(100vh-4rem)] sm:max-h-[calc(90vh-6rem)] object-contain rounded-lg"
                onLoadedMetadata={handleLoadedMetadata}
                onSeeked={() => {
                  // Ensure video is paused after seeking
                  if (videoRef.current) {
                    videoRef.current.pause();
                  }
                }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

