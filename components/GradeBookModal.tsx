'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Upload, Video, Camera, Search, ScanLine, ChevronDown, Loader2, Check } from 'lucide-react';
import { uploadToSupabaseWithProgress } from '@/lib/supabase/upload-with-progress';
import { createClient } from '@/lib/supabase/client';
import { analyzeComicFromUrl } from '@/app/actions/analyze-from-url';
import { addToHistory, generateThumbnail, updateHistoryEntry, getVideoById } from '@/lib/history';
import { useCamera } from '@/lib/hooks/useCamera';
import { useViewportHeight } from '@/lib/hooks/useViewportHeight';
import Cropper, { Area } from 'react-easy-crop';
import { trainDefect } from '@/app/actions/train-defect';
import { trainRegion } from '@/app/actions/train-region';
// Note: CV analysis is now triggered manually via "Deep Scan" button in StreamingResultCard
// import { startBackgroundCVAnalysis } from '@/lib/cv-analysis';
import UploadProgressModal from '@/components/UploadProgressModal';
import { 
  createPendingResult, 
  updateWithVideoUrl, 
  updateWithAIResult, 
  updateWithError 
} from '@/lib/streaming-analysis';

const DEFECT_TYPES = [
  "Spine Tick",
  "Color Break",
  "Corner Crease", 
  "Soft Corner",
  "Foxing/Mold",
  "Tear/Rip",
  "Missing Piece",
  "Stain",
  "Writing",
  "Rusty Staple"
];

const REGION_TYPES = [
  "Spine",
  "Top Staple",
  "Bottom Staple",
  "Top Left Corner",
  "Top Right Corner",
  "Bottom Left Corner",
  "Bottom Right Corner"
];

interface GradeBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (historyId: string) => void;
  initialTab?: 'record' | 'upload' | 'train';
}

export default function GradeBookModal({ isOpen, onClose, onSuccess, initialTab = 'record' }: GradeBookModalProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'record' | 'upload' | 'train'>('record');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  
  // Use camera hook
  const { videoRef, isStreaming, error: cameraError, startCamera, stopCamera, capturePhoto } = useCamera();
  
  // Use viewport height hook to handle mobile browser chrome
  const { viewportHeight } = useViewportHeight();
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Upload State
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('Uploading and processing...');
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  // Capture State
  const [captureStep, setCaptureStep] = useState<'front' | 'back' | 'video'>('front');
  const [capturedFiles, setCapturedFiles] = useState<{
    front: Blob | File | null;
    back: Blob | File | null;
    video: Blob | File | null;
  }>({ front: null, back: null, video: null });

  // Training State
  const [trainingStep, setTrainingStep] = useState<'capture' | 'crop' | 'tag'>('capture');
  const [trainingImageSrc, setTrainingImageSrc] = useState<string | null>(null);
  const [trainingCrop, setTrainingCrop] = useState({ x: 0, y: 0 });
  const [trainingZoom, setTrainingZoom] = useState(1);
  const [trainingCroppedAreaPixels, setTrainingCroppedAreaPixels] = useState<Area | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [isSubmittingTraining, setIsSubmittingTraining] = useState(false);

  // Determine if current tab uses camera
  const isCameraTab = activeTab === 'record' || activeTab === 'train';

  // Reset/Sync tab when opening
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setCaptureStep('front');
      setCapturedFiles({ front: null, back: null, video: null });
      setError(null);
      setLoading(false);
    }
  }, [isOpen, initialTab]);

  // Reset training state when switching away from train tab
  useEffect(() => {
    if (activeTab !== 'train') {
      setTrainingStep('capture');
      setTrainingImageSrc(null);
      setSelectedLabel('');
      setTrainingCroppedAreaPixels(null);
      setTrainingZoom(1);
      setTrainingCrop({ x: 0, y: 0 });
    }
  }, [activeTab]);

  // Initialize camera when switching to record OR train tab
  useEffect(() => {
    const shouldUseCamera = (activeTab === 'record' || activeTab === 'train');
    
    if (isOpen && shouldUseCamera && !loading && !showUploadModal) {
      startCamera();
    } else if (!shouldUseCamera) {
      // Only stop if we're NOT on a camera tab
      stopCamera();
    }
    
    return () => {
      // Only cleanup when modal closes, not on every effect run
      if (!isOpen) {
        stopCamera();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, loading, showUploadModal]);

  const startRecording = () => {
    // Get stream from the hook's videoRef
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (!stream) return;

    try {
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

  const capturePhotoForTrain = async () => {
    const blob = await capturePhoto();
    if (!blob) return;
    
    if (captureStep === 'front') {
      setCapturedFiles(prev => ({ ...prev, front: blob }));
      setCaptureStep('back');
    } else if (captureStep === 'back') {
      setCapturedFiles(prev => ({ ...prev, back: blob }));
      setCaptureStep('video');
    }
  };

  // Training Capture Handler
  const handleTrainingCapture = async () => {
    const blob = await capturePhoto();
    if (blob) {
      const reader = new FileReader();
      reader.onload = () => {
        setTrainingImageSrc(reader.result as string);
        setTrainingStep('crop');
      };
      reader.readAsDataURL(blob);
    }
  };

  // Training Crop Complete
  const onTrainingCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setTrainingCroppedAreaPixels(croppedAreaPixels);
  }, []);

  // Get Cropped Training Image
  const getCroppedTrainingImg = useCallback(async () => {
    if (!trainingImageSrc || !trainingCroppedAreaPixels) return null;

    const image = new Image();
    image.src = trainingImageSrc;
    await new Promise((resolve) => (image.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = trainingCroppedAreaPixels.width;
    canvas.height = trainingCroppedAreaPixels.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    ctx.drawImage(
      image,
      trainingCroppedAreaPixels.x,
      trainingCroppedAreaPixels.y,
      trainingCroppedAreaPixels.width,
      trainingCroppedAreaPixels.height,
      0,
      0,
      trainingCroppedAreaPixels.width,
      trainingCroppedAreaPixels.height
    );

    return new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/jpeg', 0.95);
    });
  }, [trainingImageSrc, trainingCroppedAreaPixels]);

  // Select Training Label (single-select)
  const selectTrainingLabel = (label: string) => {
    setSelectedLabel(label);
  };

  // Submit Training
  const handleTrainingSubmit = async () => {
    if (!selectedLabel) return;
    setIsSubmittingTraining(true);

    try {
      const blob = await getCroppedTrainingImg();
      if (!blob) throw new Error("Failed to crop");

      // Upload to Supabase 'training-data' bucket
      const supabase = createClient();
      if (!supabase) throw new Error("Failed to create Supabase client");
      
      // Determine prefix based on selected label
      const isDefect = DEFECT_TYPES.includes(selectedLabel);
      const prefix = isDefect ? 'defect' : 'region';
      
      const filename = `${prefix}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('training-data')
        .upload(filename, blob);

      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('training-data')
        .getPublicUrl(filename);

      // Send to appropriate Nyckel function
      const result = isDefect 
        ? await trainDefect(publicUrl, selectedLabel)
        : await trainRegion(publicUrl, selectedLabel);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to train model');
      }
      
      // Reset training state
      setTrainingStep('capture');
      setTrainingImageSrc(null);
      setSelectedLabel('');
      setTrainingCroppedAreaPixels(null);
      alert(`Successfully added training sample: ${selectedLabel}`);
    } catch (e) {
      console.error(e);
      alert(`Failed to save sample: ${(e as Error).message}`);
    } finally {
      setIsSubmittingTraining(false);
    }
  };

  const handleMultiModalProcessing = async () => {
    if (!capturedFiles.video) {
      setError("No video recorded/uploaded.");
      return;
    }

    setLoading(true);
    setError(null);
    stopCamera();

    const videoBlob = capturedFiles.video;
    // Create a temporary URL for the video to generate thumbnail
    const videoUrl = URL.createObjectURL(videoBlob);
    
    try {
      // Generate thumbnail
      const thumbnail = await generateThumbnail(videoUrl);
      
      // Create pending result
      const historyId = createPendingResult(thumbnail);
      
      // Close modal immediately
      setShowUploadModal(false);
      setLoading(false);
      onSuccess(historyId);
      
      // Background processing
      (async () => {
        try {
          // Upload all files in parallel
          const uploadPromises = [];
          
          // Video (Required)
          const videoFile = new File([videoBlob], 'comic-video.mp4', { type: videoBlob.type || 'video/mp4' });
          uploadPromises.push(
            uploadToSupabaseWithProgress(videoFile, () => {}, undefined, 'video/mp4')
              .then(url => ({ type: 'video', url }))
          );
          
          // Front Photo (Optional but expected)
          if (capturedFiles.front) {
            const frontFile = new File([capturedFiles.front], 'front-cover.jpg', { type: 'image/jpeg' });
            uploadPromises.push(
              uploadToSupabaseWithProgress(frontFile, () => {}, undefined, 'image/jpeg')
                .then(url => ({ type: 'front', url }))
            );
          }
          
          // Back Photo (Optional but expected)
          if (capturedFiles.back) {
            const backFile = new File([capturedFiles.back], 'back-cover.jpg', { type: 'image/jpeg' });
            uploadPromises.push(
              uploadToSupabaseWithProgress(backFile, () => {}, undefined, 'image/jpeg')
                .then(url => ({ type: 'back', url }))
            );
          }
          
          const results = await Promise.all(uploadPromises);
          
          const videoUpload = results.find(r => r.type === 'video');
          const frontUpload = results.find(r => r.type === 'front');
          const backUpload = results.find(r => r.type === 'back');
          
          if (!videoUpload) throw new Error("Video upload failed");
          
          // Update entry with video URL
          updateWithVideoUrl(historyId, videoUpload.url);
          
          // Analyze with AI (passing all URLs)
          const result = await analyzeComicFromUrl({
            videoUrl: videoUpload.url,
            frontPhotoUrl: frontUpload?.url,
            backPhotoUrl: backUpload?.url,
          });

          if (result.success) {
            updateWithAIResult(historyId, result.data);
          } else {
            updateWithError(historyId, result.error || "Analysis failed");
          }
        } catch (err: any) {
          console.error("Background processing error:", err);
          updateWithError(historyId, err.message || "Failed to process.");
        }
      })();
      
    } catch (err: any) {
      console.error("Processing error:", err);
      setError(err.message || "Failed to process.");
      setShowUploadModal(false);
      setLoading(false);
    } finally {
      URL.revokeObjectURL(videoUrl);
    }
  };

  const handleVideoProcessing = async (blob: Blob, fileName: string, mimeType: string) => {
    // Legacy handler or final step handler
    setCapturedFiles(prev => ({ ...prev, video: blob }));
    // If we're recording, this is the final step, so process immediately
    // Note: We need to use state setter callback or setTimeout because state update is async
    // But since handleMultiModalProcessing reads from state, we might have a race condition.
    // Better to pass the blob directly or wait.
    // Actually, let's update state then call a processing function that accepts the final blob directly to avoid race condition.
    
    // Hack: update state but also call processing with explicit video blob
    setCapturedFiles(prev => {
      const newState = { ...prev, video: blob };
      // Trigger processing with this new state
      setTimeout(() => processWithState(newState), 0);
      return newState;
    });
  };
  
  const processWithState = async (files: typeof capturedFiles) => {
    // Copied logic from handleMultiModalProcessing but using passed files
    if (!files.video) return;
    
    setLoading(true);
    setError(null);
    stopCamera();

    const videoUrl = URL.createObjectURL(files.video);
    const videoBlob = files.video;
    
    try {
      const thumbnail = await generateThumbnail(videoUrl);
      const historyId = createPendingResult(thumbnail);
      
      setShowUploadModal(false);
      setLoading(false);
      onSuccess(historyId);
      
      (async () => {
        try {
          const uploadPromises = [];
          
          const videoFile = new File([videoBlob], 'comic-video.mp4', { type: videoBlob.type || 'video/mp4' });
          uploadPromises.push(
            uploadToSupabaseWithProgress(videoFile, () => {}, undefined, 'video/mp4')
              .then(url => ({ type: 'video', url }))
          );
          
          if (files.front) {
            const frontFile = new File([files.front], 'front-cover.jpg', { type: 'image/jpeg' });
            uploadPromises.push(
              uploadToSupabaseWithProgress(frontFile, () => {}, undefined, 'image/jpeg')
                .then(url => ({ type: 'front', url }))
            );
          }
          
          if (files.back) {
            const backFile = new File([files.back], 'back-cover.jpg', { type: 'image/jpeg' });
            uploadPromises.push(
              uploadToSupabaseWithProgress(backFile, () => {}, undefined, 'image/jpeg')
                .then(url => ({ type: 'back', url }))
            );
          }
          
          const results = await Promise.all(uploadPromises);
          
          const videoUpload = results.find(r => r.type === 'video');
          const frontUpload = results.find(r => r.type === 'front');
          const backUpload = results.find(r => r.type === 'back');
          
          if (!videoUpload) throw new Error("Video upload failed");
          
          updateWithVideoUrl(historyId, videoUpload.url);
          
          const result = await analyzeComicFromUrl({
            videoUrl: videoUpload.url,
            frontPhotoUrl: frontUpload?.url,
            backPhotoUrl: backUpload?.url,
          });

          if (result.success) {
            updateWithAIResult(historyId, result.data);
          } else {
            updateWithError(historyId, result.error || "Analysis failed");
          }
        } catch (err: any) {
          console.error("Background processing error:", err);
          updateWithError(historyId, err.message || "Failed to process.");
        }
      })();
    } catch (err: any) {
      console.error("Processing error:", err);
      setError(err.message);
      setLoading(false);
    } finally {
      URL.revokeObjectURL(videoUrl);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 100 * 1024 * 1024) {
      setError("File too large (>100MB).");
      return;
    }

    if (captureStep === 'front') {
        setCapturedFiles(prev => ({ ...prev, front: file }));
        setCaptureStep('back');
    } else if (captureStep === 'back') {
        setCapturedFiles(prev => ({ ...prev, back: file }));
        setCaptureStep('video');
    } else {
        // Video step
        setCapturedFiles(prev => {
            const newState = { ...prev, video: file };
            setTimeout(() => processWithState(newState), 0);
            return newState;
        });
    }
  };

  // Handle close animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200); // Match animation duration
  };

  const tabs = [
    { id: 'record', label: 'Record', icon: Video },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'train', label: 'Train AI', icon: ScanLine },
  ] as const;

  // Always render but control visibility - this makes animations instant
  const isVisible = isOpen && !isClosing;
  const shouldShow = isOpen || isClosing; // Keep visible during close animation

  const getStepTitle = () => {
    if (captureStep === 'front') return "Step 1: Capture Front Cover (Optional)";
    if (captureStep === 'back') return "Step 2: Capture Back Cover (Optional)";
    return "Step 3: Record Video (Required)";
  };

  const getUploadTitle = () => {
    if (captureStep === 'front') return "Step 1: Upload Front Cover (Optional)";
    if (captureStep === 'back') return "Step 2: Upload Back Cover (Optional)";
    return "Step 3: Upload Video (Required)";
  };

  const skipCurrentStep = () => {
    if (captureStep === 'front') {
      setCaptureStep('back');
    } else if (captureStep === 'back') {
      setCaptureStep('video');
    }
    // Video step cannot be skipped
  };

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col justify-end transition-all duration-150 ease-out ${
        shouldShow ? 'pointer-events-auto' : 'pointer-events-none'
      } ${isVisible ? 'bg-black/80' : 'bg-black/0'} backdrop-blur-sm`}
      style={{ visibility: shouldShow ? 'visible' : 'hidden', touchAction: 'none' }}
    >
      <div 
        className={`w-full bg-gray-900 border-t border-gray-800 rounded-t-3xl shadow-2xl overflow-hidden overscroll-behavior-none flex flex-col ${
          !isCameraTab ? 'transition-transform duration-200 ease-out' : ''
        } ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height: '100vh', height: '100dvh' }}
      >
        
        {/* Header */}
        <div className="p-4 flex items-center justify-between bg-gray-900 z-20 relative" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
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
        <div className="flex-1 relative bg-black flex flex-col overflow-hidden touch-action-none overscroll-behavior-none">
            
            {/* Record & Train View (Camera) */}
            {(activeTab === 'record' || activeTab === 'train') && (
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
                        
                        {/* Camera Error Overlay */}
                        {cameraError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8">
                                <div className="bg-red-900/80 backdrop-blur-md text-white px-6 py-4 rounded-lg max-w-md text-center">
                                    <p className="font-medium">{cameraError}</p>
                                </div>
                            </div>
                        )}
                        
                        {/* Step Indicator Overlay */}
                        {activeTab === 'record' && !isRecording && (
                            <div className="absolute top-6 left-0 right-0 flex justify-center z-10 pointer-events-none">
                                <div className="bg-black/60 backdrop-blur-md text-white px-6 py-2 rounded-full font-medium text-sm border border-white/10 shadow-lg">
                                    {getStepTitle()}
                                </div>
                            </div>
                        )}
                        
                        {/* Recording Timer Overlay */}
                        {isRecording && activeTab === 'record' && (
                             <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-red-600/90 text-white px-4 py-1.5 rounded-full font-mono text-sm shadow-lg z-10">
                                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                            </div>
                        )}

                        {/* Train AI Overlay Grid (Only during capture step) */}
                        {activeTab === 'train' && trainingStep === 'capture' && !loading && (
                            <div className="absolute inset-0 pointer-events-none flex items-start justify-center pt-16">
                                <div className="flex flex-col items-center gap-4">
                                    <div className="w-64 h-80 border-2 border-purple-400 rounded-lg shadow-[0_0_15px_rgba(168,85,247,0.5)] bg-transparent" />
                                    <div className="text-center text-white/90 text-sm font-medium shadow-black drop-shadow-md bg-black/40 px-4 py-2 rounded-full backdrop-blur-sm">
                                        Position item in frame
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Train AI - Crop Step */}
                        {activeTab === 'train' && trainingStep === 'crop' && trainingImageSrc && (
                            <div className="absolute inset-0 bg-black">
                                <Cropper
                                    image={trainingImageSrc}
                                    crop={trainingCrop}
                                    zoom={trainingZoom}
                                    aspect={1}
                                    onCropChange={setTrainingCrop}
                                    onZoomChange={setTrainingZoom}
                                    onCropComplete={onTrainingCropComplete}
                                />
                            </div>
                        )}

                        {/* Train AI - Tag Step */}
                        {activeTab === 'train' && trainingStep === 'tag' && (
                            <div className="absolute inset-0 bg-black overflow-y-auto">
                                <div className="p-6 pb-32 space-y-6">
                                    {/* Defect Section */}
                                    <div>
                                        <h3 className="text-purple-400 text-sm font-bold uppercase tracking-wider mb-3 px-1">Defects</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {DEFECT_TYPES.map(label => (
                                                <button
                                                    key={label}
                                                    onClick={() => selectTrainingLabel(label)}
                                                    className={`p-3 rounded-xl text-left font-medium text-sm transition-all ${
                                                        selectedLabel === label
                                                            ? 'bg-purple-600 text-white shadow-lg ring-2 ring-purple-400' 
                                                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Region Section */}
                                    <div>
                                        <h3 className="text-emerald-400 text-sm font-bold uppercase tracking-wider mb-3 px-1">Regions</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {REGION_TYPES.map(label => (
                                                <button
                                                    key={label}
                                                    onClick={() => selectTrainingLabel(label)}
                                                    className={`p-3 rounded-xl text-left font-medium text-sm transition-all ${
                                                        selectedLabel === label
                                                            ? 'bg-emerald-600 text-white shadow-lg ring-2 ring-emerald-400' 
                                                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Controls Bar - Floating at bottom */}
                    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-16 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
                        {activeTab === 'record' && (
                             <div className="flex flex-col items-center gap-4 w-full">
                                <div className="flex justify-center items-center w-full">
                                    {captureStep === 'video' ? (
                                        // Video Recording Controls
                                        !isRecording ? (
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
                                        )
                                    ) : (
                                        // Photo Capture Controls
                                        <button
                                            onClick={() => capturePhotoForTrain()}
                                            disabled={loading}
                                            className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-gray-300 shadow-lg active:scale-95 transition-transform"
                                        >
                                            <div className="w-16 h-16 bg-white rounded-full border-2 border-gray-400" />
                                            <Camera className="absolute text-black w-8 h-8" />
                                        </button>
                                    )}
                                </div>
                                
                                {/* Skip Button - Only show for photo steps */}
                                {captureStep !== 'video' && !isRecording && (
                                    <button
                                        onClick={skipCurrentStep}
                                        disabled={loading}
                                        className="px-6 py-2.5 bg-gray-700/80 hover:bg-gray-600/80 text-white rounded-full text-sm font-medium transition-colors shadow-lg backdrop-blur-sm"
                                    >
                                        Skip Photo →
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Train AI Controls */}
                        {activeTab === 'train' && (
                            <div className="flex flex-col items-center gap-4 w-full">
                                {trainingStep === 'capture' && (
                                    <div className="flex justify-center items-center w-full">
                                        <button
                                            onClick={handleTrainingCapture}
                                            disabled={loading}
                                            className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-gray-300 shadow-lg active:scale-95 transition-transform"
                                        >
                                            <div className="w-16 h-16 bg-white rounded-full border-2 border-gray-400" />
                                            <Camera className="absolute text-black w-8 h-8" />
                                        </button>
                                    </div>
                                )}

                                {trainingStep === 'crop' && (
                                    <div className="w-full flex flex-col gap-4">
                                        {/* Zoom Slider */}
                                        <div className="flex items-center gap-3 px-4">
                                            <span className="text-white text-sm">Zoom:</span>
                                            <input
                                                type="range"
                                                min={1}
                                                max={3}
                                                step={0.1}
                                                value={trainingZoom}
                                                onChange={(e) => setTrainingZoom(Number(e.target.value))}
                                                className="flex-1"
                                            />
                                        </div>
                                        {/* Next Button */}
                                        <button
                                            onClick={() => setTrainingStep('tag')}
                                            className="w-full bg-white text-black font-bold py-4 rounded-full flex items-center justify-center gap-2"
                                        >
                                            Next <Check size={20} />
                                        </button>
                                    </div>
                                )}

                                {trainingStep === 'tag' && (
                                    <button
                                        onClick={handleTrainingSubmit}
                                        disabled={!selectedLabel || isSubmittingTraining}
                                        className={`w-full disabled:bg-gray-700 disabled:opacity-50 text-white font-bold py-4 rounded-full flex items-center justify-center gap-2 transition-colors ${
                                            DEFECT_TYPES.includes(selectedLabel)
                                                ? 'bg-purple-600'
                                                : REGION_TYPES.includes(selectedLabel)
                                                    ? 'bg-emerald-600'
                                                    : 'bg-gray-700'
                                        }`}
                                    >
                                        {isSubmittingTraining ? (
                                            <Loader2 className="animate-spin" />
                                        ) : (
                                            `Submit: ${selectedLabel || 'Select a tag'}`
                                        )}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Upload View */}
            {activeTab === 'upload' && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8 bg-gray-900">
                    <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center text-gray-600 mb-4 relative">
                        {captureStep === 'video' ? <Video size={56} /> : <Camera size={56} />}
                        <div className="absolute -top-2 -right-2 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                            {captureStep === 'front' ? '1' : captureStep === 'back' ? '2' : '3'}
                        </div>
                    </div>
                    <div className="text-center space-y-3">
                        <h3 className="text-2xl font-bold text-white">{getUploadTitle()}</h3>
                        <p className="text-gray-400 max-w-xs mx-auto text-base leading-relaxed">
                            {captureStep === 'video' 
                                ? "Select a video file showing all angles of the item. This is required for grading." 
                                : `Select a clear photo of the ${captureStep} cover, or skip to continue.`}
                        </p>
                    </div>
                    
                    <div className="w-full max-w-sm space-y-3 mt-4">
                        <label className="w-full block">
                            <input 
                                type="file" 
                                accept={captureStep === 'video' ? "video/*" : "image/*"}
                                className="hidden" 
                                onChange={handleFileUpload}
                                disabled={loading} 
                            />
                            <div className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold rounded-2xl flex items-center justify-center gap-3 cursor-pointer transition-all active:scale-[0.98] shadow-lg shadow-blue-900/20">
                                <Upload size={24} />
                                Select {captureStep === 'video' ? 'Video' : 'Photo'}
                            </div>
                        </label>
                        
                        {/* Skip Button - Only show for photo steps */}
                        {captureStep !== 'video' && (
                            <button
                                onClick={skipCurrentStep}
                                disabled={loading}
                                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white text-base font-medium rounded-2xl transition-all active:scale-[0.98] shadow-lg"
                            >
                                Skip Photo →
                            </button>
                        )}
                    </div>
                    
                    {/* Progress Dots */}
                    <div className="flex gap-2 mt-4">
                        <div className={`w-2 h-2 rounded-full ${captureStep === 'front' ? 'bg-white' : 'bg-gray-700'}`} />
                        <div className={`w-2 h-2 rounded-full ${captureStep === 'back' ? 'bg-white' : 'bg-gray-700'}`} />
                        <div className={`w-2 h-2 rounded-full ${captureStep === 'video' ? 'bg-white' : 'bg-gray-700'}`} />
                    </div>
                </div>
            )}

            {/* Error Overlay - Full screen when loading (after error) */}
            {error && (
                <div className={`absolute inset-0 z-50 flex items-center justify-center p-6 ${loading ? 'bg-black/95' : 'bg-transparent pointer-events-none'}`}>
                    <div className={`bg-red-500/95 backdrop-blur border border-red-400 text-white px-6 py-5 rounded-2xl shadow-2xl max-w-sm w-full relative ${loading ? '' : 'pointer-events-auto'}`}>
                        {/* Close button - top right */}
                        <button 
                            onClick={() => { setError(null); setLoading(false); }}
                            className="absolute top-3 right-3 p-2 hover:bg-white/20 rounded-full transition-colors"
                            aria-label="Close error"
                        >
                            <X size={20} />
                        </button>
                        
                        <h3 className="font-bold text-lg mb-3 pr-8">Upload Failed</h3>
                        
                        {/* Copyable error text */}
                        <div 
                            className="p-3 bg-black/30 rounded-lg text-sm text-white/90 leading-relaxed select-all cursor-text font-mono break-words"
                            onClick={(e) => {
                                // Select all text on click for easy copying
                                const range = document.createRange();
                                range.selectNodeContents(e.currentTarget);
                                const selection = window.getSelection();
                                selection?.removeAllRanges();
                                selection?.addRange(range);
                            }}
                        >
                            {error}
                        </div>
                        <p className="text-xs text-white/60 mt-2 text-center">Tap error to select • Long press to copy</p>
                        <div className="flex gap-2 mt-4">
                            <button 
                                onClick={() => {
                                    navigator.clipboard.writeText(error);
                                    // Brief visual feedback
                                    const btn = document.activeElement as HTMLButtonElement;
                                    if (btn) {
                                        btn.textContent = 'Copied!';
                                        setTimeout(() => { btn.textContent = 'Copy Error'; }, 1500);
                                    }
                                }}
                                className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-medium transition-colors text-sm"
                            >
                                Copy Error
                            </button>
                            <button 
                                onClick={() => { setError(null); setLoading(false); }}
                                className="flex-1 py-3 bg-white/20 hover:bg-white/30 rounded-xl font-medium transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
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
