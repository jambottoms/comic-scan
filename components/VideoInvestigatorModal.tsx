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
        <Dialog.Overlay className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-6xl max-h-[90vh] bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/90 to-transparent p-4 z-10 flex items-center justify-between">
              <div>
                <Dialog.Title className="text-xl font-bold text-white mb-1">
                  Video Investigator
                </Dialog.Title>
                <p className="text-sm text-gray-400">
                  Frame at {formatTimestamp(timestamp)}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>

            {/* Video */}
            <div className="w-full h-full flex items-center justify-center pt-20 pb-4">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="w-full h-full max-h-[calc(90vh-6rem)] object-contain rounded-lg"
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

