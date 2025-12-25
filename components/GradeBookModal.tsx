'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Upload, Video, Camera } from 'lucide-react';
import { uploadToSupabaseWithProgress } from '@/lib/supabase/upload-with-progress';
import { analyzeComicFromUrl } from '@/app/actions/analyze-from-url';
import { addToHistory, generateThumbnail } from '@/lib/history';
import UploadProgressModal from '@/components/UploadProgressModal';

interface GradeBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (historyId: string) => void;
}

export default function GradeBookModal({ isOpen, onClose, onSuccess }: GradeBookModalProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'record' | 'upload'>('record');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Upload State
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('Uploading and processing...');
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  // Initialize camera when switching to record tab
  useEffect(() => {
    if (isOpen && activeTab === 'record' && !loading && !showUploadModal) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab, loading, showUploadModal]);

  const startCamera = async () => {
    try {
      setError(null);
      
      // Check if MediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access is not supported. Please use upload.");
      }
      
      const constraints = {
        video: { 
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          facingMode: 'environment',
          aspectRatio: 16 / 9,
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Fallback
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
        });
      }

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err: any) {
      console.error("Camera error:", err);
      
      let errorMessage = "Failed to access camera.";
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = "Camera permission denied. Please allow camera access or use Upload.";
      } else if (err.name === 'NotFoundError') {
        errorMessage = "No camera found on this device.";
      } else if (err.name === 'NotReadableError') {
        errorMessage = "Camera is in use by another app.";
      } else if (!window.isSecureContext) {
        errorMessage = "Camera requires HTTPS. Please use Upload or secure connection.";
      }

      setError(errorMessage);
      
      // Optional: Auto-switch to upload on fatal errors?
      // For now, let user see error and decide.
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startRecording = () => {
    if (!mediaStreamRef.current) return;

    try {
      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 10000000,
      };

      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options.mimeType = 'video/webm;codecs=vp8';
      }

      const recorder = new MediaRecorder(mediaStreamRef.current, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        await handleVideoProcessing(blob, 'comic-video.webm', 'video/webm');
      };

      recorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Recording error:", err);
      setError("Failed to start recording.");
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
  };

  const normalizeMimeTypeForGemini = (mimeType: string): string => {
    return (mimeType === 'video/quicktime' || mimeType === 'video/x-quicktime') ? 'video/mp4' : mimeType;
  };

  const handleVideoProcessing = async (blob: Blob, fileName: string, mimeType: string) => {
    setLoading(true);
    setError(null);
    setUploadProgress(0);
    setShowUploadModal(true);
    setUploadMessage('Uploading video...');
    
    // Stop camera while processing
    stopCamera();

    const videoUrl = URL.createObjectURL(blob);
    const file = new File([blob], fileName, { type: mimeType });

    try {
      // Upload to Supabase
      const supabaseUrl = await uploadToSupabaseWithProgress(
        file,
        (progress) => setUploadProgress(Math.max(0, progress * 0.8))
      );

      setUploadMessage('Processing video...');
      setUploadProgress(85);

      // Analyze
      const result = await analyzeComicFromUrl(supabaseUrl, normalizeMimeTypeForGemini(file.type));
      setUploadProgress(95);

      if (result.success) {
        setUploadMessage('Generating thumbnail...');
        const thumbnail = await generateThumbnail(videoUrl);
        
        const historyId = addToHistory({
          title: result.data.title || "Unknown Comic",
          issue: result.data.issue || "Unknown",
          grade: result.data.estimatedGrade || "N/A",
          videoUrl: supabaseUrl,
          result: result.data,
          thumbnail: thumbnail || undefined,
        });

        setUploadProgress(100);
        
        setTimeout(() => {
          setShowUploadModal(false);
          onSuccess(historyId);
        }, 500);
      } else {
        throw new Error(result.error || "Analysis failed");
      }
    } catch (err: any) {
      console.error("Processing error:", err);
      let msg = err.message || "Failed to process video.";
      if (msg.includes("timeout")) msg += " Try a shorter video.";
      setError(msg);
      setShowUploadModal(false);
    } finally {
      setLoading(false);
      URL.revokeObjectURL(videoUrl);
      uploadXhrRef.current = null;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 100 * 1024 * 1024) {
      setError("File too large (>100MB).");
      return;
    }

    await handleVideoProcessing(file, file.name, file.type || 'video/mp4');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur">
            <h2 className="text-xl font-bold text-white">Grade Book</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
                <X size={20} />
            </button>
        </div>

        {/* Toggle */}
        <div className="p-4 grid grid-cols-2 gap-2 bg-gray-900">
             <button 
                onClick={() => setActiveTab('record')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                    activeTab === 'record' 
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' 
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-200'
                }`}
             >
                <Camera size={20} />
                <span>Record</span>
             </button>
             <button 
                onClick={() => setActiveTab('upload')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                    activeTab === 'upload' 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-200'
                }`}
             >
                <Upload size={20} />
                <span>Upload</span>
             </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center min-h-[300px]">
            
            {/* Record View */}
            {activeTab === 'record' && (
                <div className="w-full flex flex-col items-center gap-4">
                    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-gray-800">
                        {!loading && (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover ${isRecording ? 'border-2 border-red-500' : ''}`}
                            />
                        )}
                        {isRecording && (
                             <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full text-red-500 font-mono text-sm">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-4 w-full">
                        {!isRecording ? (
                            <button
                                onClick={startRecording}
                                disabled={loading}
                                className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                            >
                                <div className="w-4 h-4 rounded-full bg-white" />
                                Start Recording
                            </button>
                        ) : (
                            <button
                                onClick={stopRecording}
                                className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                            >
                                <div className="w-4 h-4 rounded bg-red-500" />
                                Stop Recording
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Upload View */}
            {activeTab === 'upload' && (
                <div className="w-full flex flex-col items-center gap-6 py-8">
                    <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center text-gray-600 mb-2">
                        <Upload size={40} />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-lg font-medium text-white">Upload Video</h3>
                        <p className="text-gray-400 text-sm max-w-[260px] mx-auto">
                            Select a video file from your device to analyze. Max 100MB.
                        </p>
                    </div>
                    
                    <label className="w-full">
                        <input 
                            type="file" 
                            accept="video/*" 
                            className="hidden" 
                            onChange={handleFileUpload}
                            disabled={loading} 
                        />
                        <div className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]">
                            Select File
                        </div>
                    </label>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm w-full">
                    {error}
                </div>
            )}
        </div>
      </div>

      {/* Upload Progress Modal - Reusing the existing one but handling state internally */}
      <UploadProgressModal 
        open={showUploadModal}
        onOpenChange={(open) => !open && setShowUploadModal(false)}
        progress={uploadProgress}
        message={uploadMessage}
        onCancel={() => setShowUploadModal(false)}
      />
    </div>
  );
}

