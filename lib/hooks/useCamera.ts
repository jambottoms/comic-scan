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
      videoRef.current.play().catch(err => {
        console.error('Error playing video:', err);
        setError('Failed to start video playback');
      });
    }
  }, [isStreaming]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      shouldBeStreamingRef.current = true; // Mark that camera should be active
      
      // Check if we already have an active stream
      if (streamRef.current && streamRef.current.active) {
        setIsStreaming(true);
        return;
      }
      
      // Check permission state first to avoid unnecessary prompts
      if ('permissions' in navigator) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (permissionStatus.state === 'denied') {
            throw new Error('NotAllowedError');
          }
        } catch (permErr) {
          // Permission API might not be supported, continue anyway
          console.log('Permission query not supported, proceeding with camera request');
        }
      }
      
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      streamRef.current = stream;
      setIsStreaming(true); // Set immediately to trigger video element render
      setHasPermission(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      
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
    shouldBeStreamingRef.current = false; // Mark that camera should be inactive
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
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

