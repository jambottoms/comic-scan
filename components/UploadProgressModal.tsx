'use client';

import * as Dialog from '@radix-ui/react-dialog';
import CircularProgress from './CircularProgress';

interface UploadProgressModalProps {
  open: boolean;
  progress: number; // 0-100
  message?: string;
}

export default function UploadProgressModal({ 
  open, 
  progress, 
  message = 'Uploading and processing...' 
}: UploadProgressModalProps) {
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-gray-900 border border-gray-700 rounded-xl p-8 shadow-2xl">
          <div className="flex flex-col items-center gap-4">
            <CircularProgress progress={progress} size={140} strokeWidth={10} />
            <Dialog.Title className="text-xl font-bold text-white mb-2">
              {message}
            </Dialog.Title>
            <p className="text-gray-400 text-sm text-center">
              Please wait while your video is being processed...
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

