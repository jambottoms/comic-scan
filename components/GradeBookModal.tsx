'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Upload, Video, Camera, Search, ScanLine, ChevronDown } from 'lucide-react';
import { uploadToSupabaseWithProgress } from '@/lib/supabase/upload-with-progress';
import { analyzeComicFromUrl } from '@/app/actions/analyze-from-url';
import { addToHistory, generateThumbnail } from '@/lib/history';
import UploadProgressModal from '@/components/UploadProgressModal';

interface GradeBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (historyId: string) => void;
  initialTab?: 'record' | 'upload' | 'identify';
}

export default function GradeBookModal({ isOpen, onClose, onSuccess, initialTab = 'record' }: GradeBookModalProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'record' | 'upload' | 'identify'>('record');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  
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

  // Reset/Sync tab when opening
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Initialize camera when switching to record OR identify tab
  useEffect(() => {
    const shouldUseCamera = (activeTab === 'record' || activeTab === 'identify');
    
    if (isOpen && shouldUseCamera && !loading && !showUploadModal) {
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
          // Request vertical-ish resolution for mobile full screen feel, or just high res
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          facingMode: 'environment',
        //   aspectRatio: 16 / 9, // Let it be natural aspect ratio to fill screen better
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

  // Handle close animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200); // Match animation duration
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'record', label: 'Record', icon: Video },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'identify', label: 'Identify', icon: ScanLine },
  ] as const;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col justify-end transition-all duration-200 ${isClosing ? 'bg-black/0' : 'bg-black/80'} backdrop-blur-sm animate-in fade-in`}>
      <div 
        className={`w-full bg-gray-900 border-t border-gray-800 rounded-t-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ease-in-out ${isClosing ? 'translate-y-full' : 'translate-y-0'}`}
        style={{ height: '95vh' }}
      >
        
        {/* Header */}
        <div className="p-4 flex items-center justify-between bg-gray-900 z-20 relative">
            <h2 className="text-xl font-bold text-white pl-2">Grade Book</h2>
            <button onClick={handleClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
                <ChevronDown size={28} />
            </button>
        </div>

        {/* Segmented Control */}
        <div className="px-6 pb-4 bg-gray-900 z-20 relative">
          <div className="flex p-1 bg-gray-800 rounded-xl relative">
             {tabs.map((tab) => {
               const Icon = tab.icon;
               const isActive = activeTab === tab.id;
               return (
                 <button
                   key={tab.id}
                   onClick={() => setActiveTab(tab.id)}
                   className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                     isActive 
                       ? 'bg-gray-700 text-white shadow-sm' 
                       : 'text-gray-400 hover:text-gray-200'
                   }`}
                 >
                   <Icon size={16} />
                   <span>{tab.label}</span>
                 </button>
               );
             })}
          </div>
        </div>

        {/* Content Area - Full height relative */}
        <div className="flex-1 relative bg-black flex flex-col overflow-hidden">
            
            {/* Record & Identify View (Camera) */}
            {(activeTab === 'record' || activeTab === 'identify') && (
                <div className="absolute inset-0 flex flex-col">
                    {/* Camera Feed - Fills available space */}
                    <div className="flex-1 relative bg-black overflow-hidden">
                        {!loading && (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover ${isRecording ? 'opacity-90' : ''}`}
                            />
                        )}
                        
                        {/* Recording Timer Overlay */}
                        {isRecording && activeTab === 'record' && (
                             <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-red-600/90 text-white px-4 py-1.5 rounded-full font-mono text-sm shadow-lg z-10">
                                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                            </div>
                        )}

                        {/* Identify Overlay Grid (Optional visual aid) */}
                        {activeTab === 'identify' && !loading && (
                            <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute top-[15%] left-0 right-0 flex flex-col items-center justify-center gap-4">
                                    <div className="w-64 h-80 border-2 border-purple-400 rounded-lg shadow-[0_0_15px_rgba(168,85,247,0.5)] bg-transparent" />
                                    <div className="text-center text-white/90 text-sm font-medium shadow-black drop-shadow-md bg-black/40 px-4 py-2 rounded-full backdrop-blur-sm">
                                        Position comic cover in frame
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Controls Bar - Floating at bottom */}
                    <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-12">
                        {activeTab === 'record' && (
                             <div className="flex justify-center items-center w-full">
                                {!isRecording ? (
                                    <button
                                        onClick={startRecording}
                                        disabled={loading}
                                        className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-gray-300 shadow-lg active:scale-95 transition-transform"
                                    >
                                        <div className="w-16 h-16 bg-red-600 rounded-full" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={stopRecording}
                                        className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-gray-300 shadow-lg active:scale-95 transition-transform"
                                    >
                                        <div className="w-8 h-8 bg-red-600 rounded-sm" />
                                    </button>
                                )}
                            </div>
                        )}

                        {activeTab === 'identify' && (
                            <div className="flex justify-center items-center w-full">
                                <button
                                    onClick={() => alert("Identify capture coming soon!")}
                                    className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-gray-300 shadow-lg active:scale-95 transition-transform"
                                >
                                    <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center">
                                        <Search className="text-white" size={32} />
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Upload View */}
            {activeTab === 'upload' && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8 bg-gray-900">
                    <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center text-gray-600 mb-4">
                        <Upload size={56} />
                    </div>
                    <div className="text-center space-y-3">
                        <h3 className="text-2xl font-bold text-white">Upload Video</h3>
                        <p className="text-gray-400 max-w-xs mx-auto text-base leading-relaxed">
                            Select a video file from your device to analyze.
                        </p>
                    </div>
                    
                    <label className="w-full max-w-sm mt-4">
                        <input 
                            type="file" 
                            accept="video/*" 
                            className="hidden" 
                            onChange={handleFileUpload}
                            disabled={loading} 
                        />
                        <div className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold rounded-2xl flex items-center justify-center gap-3 cursor-pointer transition-all active:scale-[0.98] shadow-lg shadow-blue-900/20">
                            <Upload size={24} />
                            Select Video File
                        </div>
                    </label>
                </div>
            )}

            {/* Error Overlay */}
            {error && (
                <div className="absolute top-4 left-4 right-4 z-50 animate-in slide-in-from-top-4 fade-in">
                    <div className="bg-red-500/90 backdrop-blur border border-red-500 text-white px-4 py-3 rounded-xl shadow-xl flex items-start gap-3">
                        <div className="bg-white/20 p-1 rounded-full shrink-0 mt-0.5">
                            <X size={16} />
                        </div>
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* Upload Progress Modal */}
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
