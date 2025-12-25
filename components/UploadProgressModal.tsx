'use client';

import * as Dialog from '@radix-ui/react-dialog';
import CircularProgress from './CircularProgress';

interface UploadProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: number; // 0-100
  message?: string;
  onCancel?: () => void;
}

export default function UploadProgressModal({ 
  open,
  onOpenChange,
  progress, 
  message = 'Uploading and processing...',
  onCancel
}: UploadProgressModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[calc(100vw-2rem)] max-w-md sm:w-full sm:max-w-md mx-auto p-6 sm:p-8">
          <div className="flex flex-col items-center justify-center gap-4 sm:gap-6">
            {/* Close button */}
            <div className="absolute top-4 right-4">
              <Dialog.Close asChild>
                <button
                  className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800"
                  aria-label="Close"
                  onClick={() => {
                    if (onCancel) {
                      onCancel();
                    }
                  }}
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </Dialog.Close>
            </div>

            {/* Circular Progress */}
            <div className="flex-shrink-0">
              <CircularProgress progress={Math.max(0, Math.min(100, progress))} size={120} strokeWidth={10} className="sm:w-[140px] sm:h-[140px]" />
            </div>

            {/* Message */}
            <div className="text-center w-full px-2">
              <Dialog.Title className="text-lg sm:text-xl font-bold text-white mb-2 text-center">
                {message}
              </Dialog.Title>
              <p className="text-gray-400 text-xs sm:text-sm text-center">
                Please wait while your video is being processed...
              </p>
            </div>

            {/* Cancel button */}
            {onCancel && (
              <button
                onClick={() => {
                  onCancel();
                  onOpenChange(false);
                }}
                className="mt-2 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
              >
                Cancel Upload
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

