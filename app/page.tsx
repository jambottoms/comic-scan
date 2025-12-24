'use client';

import { useState, useEffect, useRef } from 'react';
import { analyzeComic } from './actions';

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
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
        
        // Show file size info
        const fileSizeMB = (blob.size / 1024 / 1024).toFixed(2);
        console.log(`Uploading video: ${fileSizeMB}MB`);
        
        try {
          const formData = new FormData();
          formData.append("file", blob, "comic-video.webm");

          const data = await analyzeComic(formData);
          console.log("Analysis complete:", data);
          setResult(data);
        } catch (err) {
          console.error("Analysis error:", err);
          const errorMessage = err instanceof Error ? err.message : "Failed to analyze. Check terminal for details.";
          setError(errorMessage);
        } finally {
          setLoading(false);
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

  // Handle file upload as fallback
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setResult(null);

    // Clean up previous video URL if exists
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }

    // Create video preview
    const videoUrl = URL.createObjectURL(file);
    setVideoPreview(videoUrl);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const data = await analyzeComic(formData);
      setResult(data);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Failed to analyze. Check terminal for details.";
      setError(errorMessage);
    } finally {
      setLoading(false);
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
    <main className="min-h-screen bg-gray-900 text-white p-4 flex flex-col items-center justify-center max-h-screen overflow-hidden">
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
              <button
                onClick={stopRecording}
                className="bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold py-3 px-6 rounded-full text-base sm:text-lg transition shadow-lg z-10 touch-manipulation"
                style={{ minHeight: '44px' }} // iOS touch target size
              >
                ⏹️ Stop Recording
              </button>
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
        <div className="text-blue-400 font-semibold text-base sm:text-lg mb-4 text-center">
          <div className="animate-pulse">Analyzing video...</div>
          <div className="text-xs text-gray-500 mt-2">This may take 30-60 seconds for longer videos</div>
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

      {/* Recorded Video Preview */}
      {videoPreview && !loading && (
        <div className="mb-8 w-full max-w-md">
          <p className="text-gray-400 text-sm mb-2 text-center">Recorded Video:</p>
          <video 
            src={videoPreview} 
            controls 
            className="w-full rounded-xl border border-gray-700"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 p-4 rounded mb-4">
          {error}
        </div>
      )}

      {/* The Result Card */}
      {result && (
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 max-w-md w-full shadow-2xl">
          <h2 className="text-2xl font-bold text-yellow-400 mb-2">
            {result.title || "Unknown Comic"}
          </h2>
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-400">
              {result.issue ? `Issue #${result.issue}` : "Issue Unknown"}
            </span>
            {result.estimatedGrade && (
              <span className="bg-green-900 text-green-300 px-3 py-1 rounded-full font-bold">
                Grade: {result.estimatedGrade}
              </span>
            )}
          </div>
          {result.reasoning && (
            <p className="text-gray-300 text-sm border-t border-gray-700 pt-4">
              {result.reasoning}
            </p>
          )}
          {!result.title && !result.issue && !result.estimatedGrade && (
            <p className="text-gray-400 text-sm pt-4">
              Received response: {JSON.stringify(result, null, 2)}
            </p>
          )}
        </div>
      )}
    </main>
  );
}