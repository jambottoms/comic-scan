'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { uploadToSupabaseWithProgress } from '@/lib/supabase/upload-with-progress';
import { analyzeComicFromUrl } from './actions/analyze-from-url';
import { getVideoHistory, addToHistory, generateThumbnail } from '@/lib/history';
import UploadProgressModal from '@/components/UploadProgressModal';

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  buildTime: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('Uploading and processing...');
  const [history, setHistory] = useState(getVideoHistory());
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  // Refresh history when component mounts or when a new video is added
  useEffect(() => {
    setHistory(getVideoHistory());
  }, []);

  // Request high-quality video constraints
  const getVideoConstraints = () => ({
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    facingMode: 'environment', // Use back camera
    aspectRatio: 16 / 9,
  });

  const startRecording = async () => {
    try {
      setError(null);
      
      // Check if MediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.");
      }

      // Check if we're on HTTPS (required for camera access)
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error("Camera access requires HTTPS. Please access this site over HTTPS.");
      }
      
      // Request camera with high-quality constraints
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: getVideoConstraints(),
          audio: false,
        });
      } catch (permissionError: any) {
        if (permissionError.name === 'NotAllowedError' || permissionError.name === 'PermissionDeniedError') {
          console.warn("High-quality constraints denied, trying with basic constraints...");
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' },
              audio: false,
            });
          } catch (fallbackError: any) {
            if (fallbackError.name === 'NotAllowedError' || fallbackError.name === 'PermissionDeniedError') {
              throw new Error("Camera permission denied. Please allow camera access in your browser settings and try again.");
            }
            throw fallbackError;
          }
        } else {
          throw permissionError;
        }
      }

      mediaStreamRef.current = stream;

      // Set up video preview
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // Set up MediaRecorder with high quality
      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 10000000,
      };

      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options.mimeType = 'video/webm;codecs=vp8';
      }

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);

        // Stop all tracks
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }

        // Send to server for analysis
        setLoading(true);
        setError(null);
        setUploadProgress(0);
        setShowUploadModal(true);
        setUploadMessage('Uploading video...');
        
        const fileSizeMB = (blob.size / 1024 / 1024).toFixed(2);
        console.log(`Uploading recorded video: ${fileSizeMB}MB`);

        const file = new File([blob], "comic-video.webm", { type: "video/webm" });

        try {
          console.log("Step 1: Uploading recorded video to Supabase Storage with progress tracking...");
          
          // Upload with progress tracking (0-80% for upload)
          const supabaseUrl = await uploadToSupabaseWithProgress(
            file,
            (progress) => {
              // Map upload progress to 0-80% of total
              // Ensure progress doesn't go backwards
              setUploadProgress((prev) => Math.max(prev, progress * 0.8));
            },
            uploadXhrRef
          );
          console.log("Recorded video uploaded to Supabase:", supabaseUrl);
          
          console.log("Step 2: Sending URL to server for analysis...");
          setUploadMessage('Processing video...');
          setUploadProgress(85);
          
          const result = await analyzeComicFromUrl(supabaseUrl, normalizeMimeTypeForGemini(file.type || 'video/mp4'));
          console.log("Analysis complete, received result:", result);
          setUploadProgress(95);
          
          if (result.success) {
            setUploadMessage('Generating thumbnail...');
            setUploadProgress(98);
            
            // Generate thumbnail
            const thumbnail = await generateThumbnail(videoUrl);
            
            // Save to history
            const historyId = addToHistory({
              title: result.data.title || "Unknown Comic",
              issue: result.data.issue || "Unknown",
              grade: result.data.estimatedGrade || "N/A",
              videoUrl: supabaseUrl, // Use Supabase URL for persistence
              result: result.data,
              thumbnail: thumbnail || undefined,
            });
            
            setUploadProgress(100);
            
            // Close modal and redirect after brief delay
            setTimeout(() => {
              setShowUploadModal(false);
              router.push(`/results/${historyId}`);
            }, 500);
          } else {
            let errorMessage = result.error;
            
            if (errorMessage.includes("GOOGLE_API_KEY")) {
              errorMessage += " Please check Vercel environment variables.";
            } else if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
              errorMessage += " Try recording a shorter video (5-10 seconds).";
            } else if (errorMessage.includes("Failed to download")) {
              errorMessage += " There may be an issue with Supabase Storage. Please try again.";
            }
            
            setError(errorMessage);
            setShowUploadModal(false);
            URL.revokeObjectURL(videoUrl);
          }
        } catch (err) {
          console.error("Upload analysis error:", err);
          
          let errorMessage = "Failed to analyze video. ";
          if (err instanceof Error) {
            errorMessage = err.message;
            
            if (err.message.includes("GOOGLE_API_KEY")) {
              errorMessage += " Please check Vercel environment variables.";
            } else if (err.message.includes("timeout") || err.message.includes("timed out")) {
              errorMessage += " Try recording a shorter video (5-10 seconds).";
            } else if (err.message.includes("Failed to download")) {
              errorMessage += " There may be an issue with Supabase Storage. Please try again.";
            }
          } else {
            errorMessage += "Check browser console and Vercel logs for details.";
          }
          
          setError(errorMessage);
          setShowUploadModal(false);
          URL.revokeObjectURL(videoUrl);
        } finally {
          setLoading(false);
          if (!showUploadModal) {
            setUploadProgress(0);
          }
          uploadXhrRef.current = null;
        }
      };

      // Start recording
      recorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Error accessing camera:", err);
      let errorMessage = "Failed to access camera.";
      
      if (err instanceof Error) {
        const errorName = (err as any).name || '';
        
        if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError' || err.message.includes("permission")) {
          errorMessage = "Camera permission denied. Please allow camera access in your browser settings, or use the file upload option.";
        } else if (errorName === 'NotFoundError' || err.message.includes("not found")) {
          errorMessage = "No camera found. Please connect a camera or use the file upload option.";
        } else if (errorName === 'NotReadableError' || err.message.includes("not readable")) {
          errorMessage = "Camera is already in use by another application. Please close other apps using the camera.";
        } else if (errorName === 'OverconstrainedError') {
          errorMessage = "Camera doesn't support the requested quality settings. Please try again or use file upload.";
        } else {
          errorMessage = err.message || "Failed to access camera. You can use the file upload option.";
        }
      }
      
      setError(errorMessage);
    }
  };

  // Normalize MIME type for Gemini API
  const normalizeMimeTypeForGemini = (mimeType: string): string => {
    return (mimeType === 'video/quicktime' || mimeType === 'video/x-quicktime') ? 'video/mp4' : mimeType;
  };

  // Handle file upload with progress tracking
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log(`[File Upload] File: ${file.name}, ${(file.size / 1024 / 1024).toFixed(2)}MB, type: ${file.type || '(empty)'}`);

    const nextJsLimit = 100 * 1024 * 1024; // 100MB
    const uploadFileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    
    if (file.size > nextJsLimit) {
      setError(`File too large: ${uploadFileSizeMB}MB. Maximum size is 100MB (Next.js config). Please record a shorter video or compress the file.`);
      return;
    }

    setLoading(true);
    setError(null);
    setUploadProgress(0);
    setShowUploadModal(true);
    setUploadMessage('Uploading video...');

    // Create video preview for thumbnail
    const videoUrl = URL.createObjectURL(file);

    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    console.log(`Uploading video for analysis: ${fileSizeMB}MB`);

    try {
      console.log("Step 1: Uploading to Supabase Storage with progress tracking...");
      
      // Upload with progress tracking (0-80% for upload)
      const supabaseUrl = await uploadToSupabaseWithProgress(
        file,
        (progress) => {
          // Map upload progress to 0-80% of total
          // Ensure progress doesn't go backwards
          setUploadProgress((prev) => Math.max(prev, progress * 0.8));
        },
        uploadXhrRef
      );
      console.log("File uploaded to Supabase:", supabaseUrl);
      
      console.log("Step 2: Sending to server for analysis...");
      setUploadMessage('Processing video...');
      setUploadProgress(85);
      
      const result = await analyzeComicFromUrl(supabaseUrl, normalizeMimeTypeForGemini(file.type || 'video/mp4'));
      console.log("Analysis complete, received result:", result);
      setUploadProgress(95);
      
      if (result.success) {
        setUploadMessage('Generating thumbnail...');
        setUploadProgress(98);
        
        // Generate thumbnail
        const thumbnail = await generateThumbnail(videoUrl);
        
        // Save to history
        const historyId = addToHistory({
          title: result.data.title || "Unknown Comic",
          issue: result.data.issue || "Unknown",
          grade: result.data.estimatedGrade || "N/A",
          videoUrl: supabaseUrl, // Use Supabase URL for persistence
          result: result.data,
          thumbnail: thumbnail || undefined,
        });
        
        setUploadProgress(100);
        
        // Clean up local video URL
        URL.revokeObjectURL(videoUrl);
        
        // Close modal and redirect after brief delay
        setTimeout(() => {
          setShowUploadModal(false);
          setHistory(getVideoHistory());
          router.push(`/results/${historyId}`);
        }, 500);
      } else {
        let errorMessage = result.error;
        
        if (errorMessage.includes("GOOGLE_API_KEY")) {
          errorMessage += " Please check Vercel environment variables.";
        } else if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
          errorMessage += " Try recording a shorter video (5-10 seconds).";
        } else if (errorMessage.includes("not ready") || errorMessage.includes("PROCESSING")) {
          errorMessage += " The video is still processing. Please wait and try again.";
        } else if (errorMessage.includes("too large") || errorMessage.includes("size")) {
          errorMessage += ` (File: ${file.name}, Size: ${uploadFileSizeMB}MB, Type: ${file.type || '(empty)'})`;
        }
        
        setError(errorMessage);
        URL.revokeObjectURL(videoUrl);
      }
    } catch (err) {
      console.error("Upload analysis error:", err);
      
      let errorMessage = "Failed to analyze video. ";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage += "Check browser console and Vercel logs for details.";
      }
      
        setError(errorMessage);
        setShowUploadModal(false);
        URL.revokeObjectURL(videoUrl);
    } finally {
      setLoading(false);
      if (!showUploadModal) {
        setUploadProgress(0);
      }
      uploadXhrRef.current = null;
    }
  };

  // Cancel upload function
  const cancelUpload = () => {
    if (uploadXhrRef.current) {
      uploadXhrRef.current.abort();
      uploadXhrRef.current = null;
    }
    setLoading(false);
    setUploadProgress(0);
    setShowUploadModal(false);
    setError(null);
  };

  // Cancel recording function
  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setRecordingTime(0);
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Format date for display
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 flex flex-col items-center overflow-y-auto">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-8">Comic Video Scanner</h1>

      {/* Camera Preview - Live Feed with Overlay Controls */}
      {!isRecording && (
        <div className="mb-4 sm:mb-8 w-full max-w-md relative flex-shrink-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-xl border-2 border-gray-700"
          />
        </div>
      )}

      {/* Recording Controls - Only show when NOT recording */}
      {!isRecording && (
        <div className="mb-8 flex flex-col items-center gap-4">
          {!loading && (
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <button
                onClick={startRecording}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-full text-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                🎥 Record Video
              </button>
              <span className="text-gray-500 text-lg">or</span>
              <label className="cursor-pointer bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-8 rounded-full text-xl transition">
                📁 Upload Video
                <input 
                  type="file" 
                  accept="video/*"
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
            </div>
          )}

          {versionInfo && !loading && (
            <div className="text-gray-500 text-xs mt-2 text-center">
              v{versionInfo.version} • {versionInfo.commitHash}
            </div>
          )}
        </div>
      )}

      {/* Recording Overlay */}
      {isRecording && (
        <div className="mb-4 sm:mb-8 w-full max-w-md relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-xl border-2 border-red-500"
            style={{ maxHeight: 'calc(100vh - 200px)' }}
          />
          <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-black/90 via-black/80 to-transparent rounded-b-xl flex flex-col items-center gap-2 sm:gap-3">
            <div className="flex gap-2">
              <button
                onClick={stopRecording}
                className="bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold py-3 px-6 rounded-full text-base sm:text-lg transition shadow-lg z-10 touch-manipulation"
                style={{ minHeight: '44px' }}
              >
                ⏹️ Stop
              </button>
              <button
                onClick={cancelRecording}
                className="bg-gray-600 hover:bg-gray-500 active:bg-gray-700 text-white font-bold py-3 px-4 rounded-full text-base sm:text-lg transition shadow-lg z-10 touch-manipulation"
                style={{ minHeight: '44px' }}
              >
                ✕ Cancel
              </button>
            </div>
            <div className="text-red-400 font-semibold text-sm sm:text-base drop-shadow-lg">
              Recording... {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress Modal */}
      <UploadProgressModal 
        open={showUploadModal}
        onOpenChange={(open) => {
          if (!open && !loading) {
            setShowUploadModal(false);
          }
        }}
        progress={uploadProgress}
        message={uploadMessage}
        onCancel={cancelUpload}
      />

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 p-4 rounded mb-4 max-w-md w-full">
          <div className="flex justify-between items-start mb-2">
            <p className="font-semibold">Analysis Error:</p>
            <button
              onClick={(e) => {
                navigator.clipboard.writeText(error);
                const btn = e.currentTarget;
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                  btn.textContent = originalText;
                }, 2000);
              }}
              className="text-xs bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-white transition-colors"
              title="Copy error message"
            >
              Copy
            </button>
          </div>
          <pre 
            className="text-sm whitespace-pre-wrap break-words select-text cursor-text bg-black/20 p-2 rounded mt-2"
            onClick={(e) => {
              const range = document.createRange();
              range.selectNodeContents(e.currentTarget);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            }}
          >
            {error}
          </pre>
        </div>
      )}

      {/* Video History List */}
      <div className="w-full max-w-2xl mt-8">
        <h2 className="text-xl font-bold text-yellow-400 mb-4">Video History</h2>
        
        {history.length === 0 ? (
          <div className="text-center text-gray-400 py-8 border border-gray-700 rounded-lg">
            <p>No videos analyzed yet.</p>
            <p className="text-sm mt-2">Record or upload a video to get started!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <Link
                key={item.id}
                href={`/results/${item.id}`}
                className="block bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-purple-500 rounded-lg p-4 transition-all"
              >
                <div className="flex items-center gap-4">
                  {/* Thumbnail */}
                  {item.thumbnail ? (
                    <div className="flex-shrink-0 w-24 h-16 rounded overflow-hidden bg-gray-700">
                      <img 
                        src={item.thumbnail} 
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 w-24 h-16 rounded bg-gray-700 flex items-center justify-center">
                      <span className="text-gray-500 text-2xl">🎬</span>
                    </div>
                  )}
                  
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-yellow-400 truncate">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-gray-400 text-sm">
                        Issue {item.issue}
                      </span>
                      <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded-full text-xs font-bold">
                        Grade: {item.grade}
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs mt-1">
                      {formatDate(item.timestamp)}
                    </p>
                  </div>
                  
                  {/* Arrow */}
                  <div className="flex-shrink-0 text-purple-400">
                    →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
