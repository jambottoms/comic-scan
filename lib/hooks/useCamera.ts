'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  error: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  capturePhoto: () => Promise<Blob | null>;
  hasPermission: boolean;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const shouldBeStreamingRef = useRef(false); // Track if camera should be active

  // Check if we already have camera permission
  useEffect(() => {
    const checkPermission = async () => {
      if ('permissions' in navigator) {
        try {
          const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
          setHasPermission(result.state === 'granted');
          
          // Listen for permission changes
          result.onchange = () => {
            setHasPermission(result.state === 'granted');
          };
        } catch (err) {
          // Some browsers don't support querying camera permission
          console.log('Permission API not supported for camera');
        }
      }
    };
    
    checkPermission();
  }, []);

  // Attach stream to video element when both exist
  useEffect(() => {
    if (isStreaming && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      // play() may fail on iOS Safari but video still works - don't show error
      videoRef.current.play().catch(() => {
        // Ignore - iOS Safari quirk, video usually plays anyway
      });
    }
  }, [isStreaming]);

  const startCamera = useCallback(async () => {
    console.log('🎥 startCamera called');
    try {
      setError(null);
      shouldBeStreamingRef.current = true;
      
      // iOS Safari fix: Check if stream exists AND has active tracks
      // iOS can have a stream that's "active" but all tracks are ended
      const hasActiveStream = streamRef.current && 
        streamRef.current.active && 
        streamRef.current.getVideoTracks().some(track => track.readyState === 'live');
      
      if (hasActiveStream) {
        console.log('🎥 Stream already active with live tracks, re-attaching to video');
        // iOS Safari fix: Always re-attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          // play() can fail on iOS but video still works - ignore error
          videoRef.current.play().catch(() => {});
        }
        setIsStreaming(true);
        return;
      }
      
      // If we have a dead stream, clean it up first
      if (streamRef.current) {
        console.log('🎥 Cleaning up dead stream');
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      console.log('🎥 Requesting camera access...');
      
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      console.log('🎥 Camera access granted, attaching to video');
      streamRef.current = stream;
      
      // iOS Safari fix: Immediately attach to video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // play() can fail on iOS but video still works - ignore error
        videoRef.current.play().catch(() => {});
        console.log('🎥 Video playing');
      }
      
      setIsStreaming(true);
      setHasPermission(true);
    } catch (err) {
      console.error('🎥 Camera error:', err);
      
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Camera access denied. Please enable camera permissions in your browser settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No camera found on this device.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setError('Camera is already in use by another application.');
        } else {
          setError('Failed to access camera. Please try again.');
        }
      } else {
        setError('Failed to access camera. Please try again.');
      }
      
      setIsStreaming(false);
      shouldBeStreamingRef.current = false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    console.log('🎥 stopCamera called');
    shouldBeStreamingRef.current = false;
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log('🎥 Camera stream stopped');
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
  }, []);

  const capturePhoto = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current || !isStreaming) {
      return null;
    }

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // Draw the current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create image blob'));
            }
          },
          'image/jpeg',
          0.95
        );
      });
    } catch (err) {
      console.error('Error capturing photo:', err);
      setError('Failed to capture photo. Please try again.');
      return null;
    }
  }, [isStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Handle page visibility changes (when user switches tabs or apps)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Page is visible again - restart camera if it should be active
        if (shouldBeStreamingRef.current && !isStreaming) {
          startCamera();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isStreaming, startCamera]);

  return {
    videoRef,
    isStreaming,
    error,
    startCamera,
    stopCamera,
    capturePhoto,
    hasPermission
  };
}

