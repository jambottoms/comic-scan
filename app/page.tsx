'use client';

import { useState, useEffect, useRef } from 'react';
import { uploadToSupabase } from '@/lib/supabase/upload';
import { analyzeComicFromUrl } from './actions/analyze-from-url';

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  buildTime: string;
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [usingFallback, setUsingFallback] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

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
      // Start with ideal constraints, but allow fallback
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: getVideoConstraints(),
          audio: false,
        });
      } catch (permissionError: any) {
        // If permission denied, try with less strict constraints
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
        mimeType: 'video/webm;codecs=vp9', // High quality codec
        videoBitsPerSecond: 10000000, // 10 Mbps for high quality
      };

      // Fallback to VP8 if VP9 not supported
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
        
        // Clean up previous video URL if exists
        if (videoPreview) {
          URL.revokeObjectURL(videoPreview);
        }

        const videoUrl = URL.createObjectURL(blob);
        setVideoPreview(videoUrl);

        // Stop all tracks
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }

        // Send to server for analysis
        setLoading(true);
        setError(null);
        setResult(null);
        setUploadProgress(0);
        
        // Show file size info
        const fileSizeMB = (blob.size / 1024 / 1024).toFixed(2);
        console.log(`Uploading recorded video: ${fileSizeMB}MB`);

        // Convert blob to File for Supabase upload
        const file = new File([blob], "comic-video.webm", { type: "video/webm" });

        try {
          // Use the same Supabase flow as file upload to bypass Vercel's 4.5MB limit
          // Step 1: Upload to Supabase Storage (client-side, no size limit)
          console.log("Step 1: Uploading recorded video to Supabase Storage...");
          setUploadProgress(10);
          
          const supabaseUrl = await uploadToSupabase(file);
          console.log("Recorded video uploaded to Supabase:", supabaseUrl);
          setUploadProgress(50);
          
          // Step 2: Send URL to server action (small payload, bypasses 4.5MB limit)
          console.log("Step 2: Sending URL to server for analysis...");
          setUploadProgress(60);
          
          const result = await analyzeComicFromUrl(supabaseUrl, normalizeMimeTypeForGemini(file.type || 'video/mp4'));
          console.log("Analysis complete, received result:", result);
          setUploadProgress(90);
          
          if (result.success) {
            setResult(result.data);
            setUploadProgress(100);
            console.log("Result set, should display now");
          } else {
            // Handle error from server action
            let errorMessage = result.error;
            
            // Add helpful context for common errors
            if (errorMessage.includes("GOOGLE_API_KEY")) {
              errorMessage += " Please check Vercel environment variables.";
            } else if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
              errorMessage += " Try recording a shorter video (5-10 seconds).";
            } else if (errorMessage.includes("Failed to download")) {
              errorMessage += " There may be an issue with Supabase Storage. Please try again.";
            }
            
            setError(errorMessage);
          }
        } catch (err) {
          console.error("Upload analysis error:", err);
          console.error("Error details:", {
            name: err instanceof Error ? err.name : 'Unknown',
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
          });
          
          let errorMessage = "Failed to analyze video. ";
          if (err instanceof Error) {
            errorMessage = err.message;
            
            // Add helpful context for common errors
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
        } finally {
          setLoading(false);
          setUploadProgress(0);
          uploadXhrRef.current = null;
        }
      };

      // Start recording
      recorder.start(1000); // Collect data every second
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

  // Normalize MIME type for Gemini API (video/quicktime → video/mp4)
  const normalizeMimeTypeForGemini = (mimeType: string): string => {
    return (mimeType === 'video/quicktime' || mimeType === 'video/x-quicktime') ? 'video/mp4' : mimeType;
  };

  // Handle file upload with progress tracking
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log(`[File Upload] File: ${file.name}, ${(file.size / 1024 / 1024).toFixed(2)}MB, type: ${file.type || '(empty)'}`);

    // Check file size before upload
    // Next.js config allows up to 100MB locally
    // Vercel has a 4.5MB body size limit for serverless functions (platform limitation)
    // We'll let the server action handle the limit check based on environment
    const nextJsLimit = 100 * 1024 * 1024; // 100MB - Next.js config limit
    const uploadFileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    
    if (file.size > nextJsLimit) {
      setError(`File too large: ${uploadFileSizeMB}MB. Maximum size is 100MB (Next.js config). Please record a shorter video or compress the file.`);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setUploadProgress(0);
    setUsingFallback(false); // Reset fallback state

    // Clean up previous video URL if exists
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }

    // Create video preview
    const videoUrl = URL.createObjectURL(file);
    setVideoPreview(videoUrl);

    // Show file size info
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    console.log(`Uploading video for analysis: ${fileSizeMB}MB`);

    // Simplified flow: Supabase → Server Action (downloads and analyzes directly)
    // This avoids the complex Google File API upload that was causing issues
    try {
      // Step 1: Upload file to Supabase Storage (client-side, no size limit)
      console.log("Step 1: Uploading to Supabase Storage...");
      setUploadProgress(10);
      
      const supabaseUrl = await uploadToSupabase(file);
      console.log("File uploaded to Supabase:", supabaseUrl);
      setUploadProgress(50);
      
      // Step 2: Send URL to server action for analysis
      // Server action will download from Supabase and analyze with Gemini
      console.log("Step 2: Sending to server for analysis...");
      setUploadProgress(60);
      
      const result = await analyzeComicFromUrl(supabaseUrl, normalizeMimeTypeForGemini(file.type || 'video/mp4'));
      console.log("Analysis complete, received result:", result);
      setUploadProgress(90);
      
      if (result.success) {
        setResult(result.data);
        setUploadProgress(100);
        console.log("Result set, should display now");
      } else {
        // Handle error from server action
        let errorMessage = result.error;
        
        // Add helpful context for common errors
        if (errorMessage.includes("GOOGLE_API_KEY")) {
          errorMessage += " Please check Vercel environment variables.";
        } else if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
          errorMessage += " Try recording a shorter video (5-10 seconds).";
        } else if (errorMessage.includes("not ready") || errorMessage.includes("PROCESSING")) {
          errorMessage += " The video is still processing. Please wait and try again.";
        } else if (errorMessage.includes("too large") || errorMessage.includes("size")) {
          // iOS files might have size detection issues
          errorMessage += ` (File: ${file.name}, Size: ${uploadFileSizeMB}MB, Type: ${file.type || '(empty)'})`;
        }
        
        setError(errorMessage);
        // Clear video preview on error so user can try again
        if (videoPreview) {
          URL.revokeObjectURL(videoPreview);
          setVideoPreview(null);
        }
      }
    } catch (err) {
      // Catch any unexpected errors (network issues, etc.)
      console.error("Upload analysis error:", err);
      console.error("Error details:", {
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      
      let errorMessage = "Failed to analyze video. ";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage += "Check browser console and Vercel logs for details.";
      }
      
      setError(errorMessage);
      // Clear video preview on error so user can try again
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
        setVideoPreview(null);
      }
    } finally {
      setLoading(false);
      setUploadProgress(0);
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
    setUsingFallback(false); // Reset fallback state
    setError(null);
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview(null);
    }
  };

  // Cancel recording function
  const cancelRecording = () => {
    // Stop recording if active
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    
    // Stop all tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Reset state
    setIsRecording(false);
    setRecordingTime(0);
    
    // Clear video preview
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

    // Stop video preview
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
        // Fallback version
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
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [videoPreview]);

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 flex flex-col items-center justify-center overflow-y-auto">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-8">Comic Video Scanner</h1>

      {/* Camera Preview - Live Feed with Overlay Controls */}
      {!videoPreview && (
        <div className="mb-4 sm:mb-8 w-full max-w-md relative flex-shrink-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full rounded-xl border-2 ${
              isRecording ? 'border-red-500' : 'border-gray-700'
            }`}
            style={{ maxHeight: isRecording ? 'calc(100vh - 200px)' : 'auto' }}
          />
          {/* Overlay controls when recording - always visible on mobile */}
          {isRecording && (
            <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-black/90 via-black/80 to-transparent rounded-b-xl flex flex-col items-center gap-2 sm:gap-3">
              <div className="flex gap-2">
                <button
                  onClick={stopRecording}
                  className="bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold py-3 px-6 rounded-full text-base sm:text-lg transition shadow-lg z-10 touch-manipulation"
                  style={{ minHeight: '44px' }} // iOS touch target size
                >
                  ⏹️ Stop
                </button>
                <button
                  onClick={cancelRecording}
                  className="bg-gray-600 hover:bg-gray-500 active:bg-gray-700 text-white font-bold py-3 px-4 rounded-full text-base sm:text-lg transition shadow-lg z-10 touch-manipulation"
                  style={{ minHeight: '44px' }} // iOS touch target size
                >
                  ✕ Cancel
                </button>
              </div>
              <div className="text-red-400 font-semibold text-sm sm:text-base drop-shadow-lg">
                Recording... {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recording Controls - Only show when NOT recording */}
      {!isRecording && (
        <div className="mb-8 flex flex-col items-center gap-4">
          {!loading && !videoPreview && (
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <button
                onClick={startRecording}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-full text-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
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

          {!loading && videoPreview && (
            <button
              onClick={startRecording}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-full text-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🎥 Record New Video
            </button>
          )}

          {versionInfo && !loading && (
            <div className="text-gray-500 text-xs mt-2 text-center">
              v{versionInfo.version} • {versionInfo.commitHash}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="w-full max-w-md mb-4">
          <div className="text-blue-400 font-semibold text-base sm:text-lg mb-3 text-center">
            <div className="animate-pulse">Analyzing video...</div>
          </div>
          
          {usingFallback ? (
            /* Fallback Message - No Progress Bar */
            <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 mb-3">
              <div className="text-yellow-300 text-sm text-center">
                ⚠️ Due to larger file size, upload progress won't be displayed. Please wait while your video is being processed...
              </div>
            </div>
          ) : (
            /* Progress Bar */
            <>
              <div className="w-full bg-gray-700 rounded-full h-3 mb-2">
                <div
                  className="bg-purple-500 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              
              {/* Progress Percentage */}
              {uploadProgress > 0 && (
                <div className="text-center text-sm text-gray-400">
                  {uploadProgress}% complete
                </div>
              )}
              
              <div className="text-xs text-gray-500 mt-2 text-center mb-3">
                {uploadProgress < 100 ? 'Uploading and processing...' : 'Finalizing analysis...'}
              </div>
            </>
          )}
          
          {/* Cancel Button */}
          <button
            onClick={cancelUpload}
            className="w-full bg-gray-600 hover:bg-gray-500 active:bg-gray-700 text-white font-bold py-2 px-4 rounded-full text-sm transition"
          >
            ✕ Cancel Upload
          </button>
        </div>
      )}

      {videoPreview && !loading && !isRecording && (
          <div className="flex flex-col gap-2 items-center">
            <button
              onClick={() => {
                if (videoPreview) {
                  URL.revokeObjectURL(videoPreview);
                }
                setVideoPreview(null);
                setResult(null);
                setError(null);
              }}
              className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-full text-sm transition"
            >
              Clear & Try Again
            </button>
            <div className="flex gap-4">
              <button
                onClick={startRecording}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-full text-sm transition"
              >
                🎥 Record New
              </button>
              <label className="cursor-pointer bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-4 rounded-full text-sm transition">
                📁 Upload New
                <input 
                  type="file" 
                  accept="video/*"
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
            </div>
          </div>
        )}

      {/* Video Preview - Show above results in smaller landscape box */}
      {videoPreview && result && !loading && (
        <div className="mb-6 w-full max-w-2xl">
          <p className="text-gray-400 text-sm mb-2 text-center">Video Preview:</p>
          <div className="relative w-full" style={{ aspectRatio: '16/9', maxHeight: '400px' }}>
            <video 
              src={videoPreview} 
              controls 
              className="w-full h-full rounded-xl border border-gray-700 object-contain cursor-pointer"
              onPlay={(e) => {
                // Request fullscreen when video starts playing
                const video = e.currentTarget;
                // Small delay to ensure video is actually playing
                setTimeout(() => {
                  if (video.requestFullscreen) {
                    video.requestFullscreen().catch(err => {
                      console.log('Fullscreen request failed:', err);
                    });
                  } else if ((video as any).webkitRequestFullscreen) {
                    (video as any).webkitRequestFullscreen();
                  } else if ((video as any).mozRequestFullScreen) {
                    (video as any).mozRequestFullScreen();
                  } else if ((video as any).msRequestFullscreen) {
                    (video as any).msRequestFullscreen();
                  }
                }, 100);
              }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}

      {/* The Result Card - CGC Slab Style */}
      {result && (() => {
        // Parse reasoning into summary and bullet points
        const parseReasoning = (reasoning: string) => {
          if (!reasoning) return { summary: '', bullets: [] };
          
          // Split by sentences
          const sentences = reasoning.split(/[.!?]+/).filter(s => s.trim().length > 0);
          
          // First 1-2 sentences as summary
          const summary = sentences.slice(0, 2).join('. ').trim() + (sentences.length > 2 ? '.' : '');
          
          // Rest as bullet points
          const bullets = sentences.slice(2).map(s => s.trim()).filter(s => s.length > 0);
          
          // If no clear sentence breaks, try to split by newlines or create bullets from paragraphs
          if (bullets.length === 0 && sentences.length <= 2) {
            // Try splitting by newlines or common separators
            const paragraphs = reasoning.split(/\n\n|\n/).filter(p => p.trim().length > 0);
            if (paragraphs.length > 1) {
              return {
                summary: paragraphs[0].trim(),
                bullets: paragraphs.slice(1).map(p => p.trim().replace(/^[-•*]\s*/, ''))
              };
            }
            // If still no bullets, create them from the reasoning text
            const parts = reasoning.split(/[;:]/).filter(p => p.trim().length > 0);
            if (parts.length > 1) {
              return {
                summary: parts[0].trim(),
                bullets: parts.slice(1).map(p => p.trim())
              };
            }
          }
          
          return { summary, bullets };
        };

        const { summary, bullets } = result.reasoning ? parseReasoning(result.reasoning) : { summary: '', bullets: [] };
        const grade = result.estimatedGrade || 'N/A';
        const title = result.title || "Unknown Comic";
        const issue = result.issue ? `#${result.issue}` : "Unknown Issue";

        return (
          <div className="bg-gray-800 p-6 rounded-xl border-2 border-purple-500 max-w-2xl w-full shadow-2xl mb-4">
            {/* CGC Slab Style Header */}
            <div className="bg-gradient-to-b from-gray-900 to-gray-800 border-2 border-gray-600 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-yellow-400 mb-1">
                    {title}
                  </h2>
                  <p className="text-gray-400 text-sm">
                    Issue {issue}
                  </p>
                </div>
                {/* Large Grade Display - CGC Style */}
                <div className="text-center ml-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Grade</div>
                  <div className="text-5xl font-bold text-green-400 leading-none">
                    {grade}
                  </div>
                </div>
              </div>
            </div>

            {/* Summary Section */}
            {summary && (
              <div className="mb-4 pb-4 border-b border-gray-700">
                <p className="text-gray-300 text-sm leading-relaxed">
                  {summary}
                </p>
              </div>
            )}

            {/* Grading Details - Bullet Points */}
            {bullets.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Grading Details
                </h3>
                <ul className="space-y-2">
                  {bullets.map((bullet: string, index: number) => (
                    <li key={index} className="flex items-start text-gray-300 text-sm">
                      <span className="text-purple-400 mr-2 mt-1">•</span>
                      <span className="flex-1">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Fallback for unstructured data */}
            {!summary && bullets.length === 0 && result.reasoning && (
              <div className="text-gray-300 text-sm border-t border-gray-700 pt-4 whitespace-pre-wrap break-words">
                {result.reasoning}
              </div>
            )}

            {/* JSON Fallback */}
            {!result.title && !result.issue && !result.estimatedGrade && !result.reasoning && (
              <div className="text-gray-400 text-sm pt-4 overflow-x-auto">
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })()}

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 p-4 rounded mb-4 max-w-md w-full">
          <div className="flex justify-between items-start mb-2">
            <p className="font-semibold">Analysis Error:</p>
            <button
              onClick={(e) => {
                navigator.clipboard.writeText(error);
                // Show brief feedback
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
              // Select all text on click
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
    </main>
  );
}