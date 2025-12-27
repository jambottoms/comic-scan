'use client';

import { useState, useCallback, useEffect } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { X, Camera, Check, Loader2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { trainDefect } from '@/app/actions/train-defect';
import { trainRegion } from '@/app/actions/train-region';
import { useCamera } from '@/lib/hooks/useCamera';

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
  "Date Stamp",
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

export default function TrainingModal({ onClose }: { onClose: () => void }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<'capture' | 'crop' | 'tag'>('capture');
  
  // Use camera hook
  const { videoRef, isStreaming, error: cameraError, startCamera, stopCamera, capturePhoto } = useCamera();

  // Start camera when entering capture step
  useEffect(() => {
    if (step === 'capture') {
      startCamera();
    }
    
    return () => {
      if (step === 'capture') {
        stopCamera();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Handle camera capture
  const handleCameraCapture = async () => {
    const blob = await capturePhoto();
    if (blob) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        stopCamera();
        setStep('crop');
      };
      reader.readAsDataURL(blob);
    }
  };

  // 1. Handle File Input (Camera) - Fallback
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setStep('crop');
      };
      reader.readAsDataURL(file);
    }
  };

  // 2. Create the Cropped Image
  const getCroppedImg = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return null;

    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => (image.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height
    );

    return new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/jpeg', 0.95);
    });
  }, [imageSrc, croppedAreaPixels]);

  // Toggle label selection
  const toggleLabel = (label: string) => {
    setSelectedLabels(prev => {
      if (prev.includes(label)) {
        return prev.filter(l => l !== label);
      } else {
        return [...prev, label];
      }
    });
  };

  // 3. Submit
  const handleSubmit = async () => {
    if (selectedLabels.length === 0) return;
    setIsSubmitting(true);

    try {
      const blob = await getCroppedImg();
      if (!blob) throw new Error("Failed to crop");

      // Upload to Supabase 'training-data' bucket
      const supabase = createClient();
      if (!supabase) throw new Error("Failed to create Supabase client");
      
      // Determine prefix based on selected labels
      const hasDefect = selectedLabels.some(l => DEFECT_TYPES.includes(l));
      const hasRegion = selectedLabels.some(l => REGION_TYPES.includes(l));
      const prefix = hasDefect && hasRegion ? 'mixed' : hasDefect ? 'defect' : 'region';
      
      const filename = `${prefix}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('training-data')
        .upload(filename, blob);

      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('training-data')
        .getPublicUrl(filename);

      // Smart Routing: Send to appropriate Nyckel functions in parallel
      const promises: Promise<{ success: boolean; error?: string }>[] = [];

      // 1. Process Defect Labels
      const defectLabels = selectedLabels.filter(l => DEFECT_TYPES.includes(l));
      if (defectLabels.length > 0) {
        // Nyckel API typically takes one label per sample for classification functions.
        // We'll send a request for each label if multiple are selected.
        defectLabels.forEach(label => {
          promises.push(trainDefect(publicUrl, label));
        });
      }

      // 2. Process Region Labels
      const regionLabels = selectedLabels.filter(l => REGION_TYPES.includes(l));
      if (regionLabels.length > 0) {
        regionLabels.forEach(label => {
          promises.push(trainRegion(publicUrl, label));
        });
      }

      const results = await Promise.all(promises);
      
      // Check for failures
      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        throw new Error(`Failed to train ${failures.length} labels: ${failures[0].error}`);
      }
      
      // Reset to capture mode instead of closing
      setStep('capture');
      setImageSrc(null);
      setSelectedLabels([]);
      setCroppedAreaPixels(null);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
      alert(`Successfully added ${selectedLabels.length} training sample(s)!`); 
    } catch (e) {
      console.error(e);
      alert(`Failed to save sample: ${(e as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const headerTitle = 
    step === 'capture' ? 'New Sample' : 
    step === 'crop' ? 'Crop Sample' : 
    'Select Tags';

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Header */}
      <div className="p-4 flex justify-between items-center border-b border-gray-800">
        <h2 className="text-white font-bold text-lg">
          {headerTitle}
        </h2>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-white">
          <X />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-4 w-full">
        
        {step === 'capture' && (
          <div className="w-full max-w-2xl flex flex-col items-center gap-4">
            {/* Camera Stream */}
            {isStreaming ? (
              <div className="relative w-full aspect-[3/4] bg-black rounded-xl overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                
                {/* Capture Button */}
                <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                  <button
                    onClick={handleCameraCapture}
                    className="w-16 h-16 rounded-full bg-white border-4 border-gray-300 hover:bg-gray-100 transition-all active:scale-95"
                  >
                    <Camera className="w-8 h-8 mx-auto text-black" />
                  </button>
                </div>
              </div>
            ) : cameraError ? (
              // Error state - show file input fallback
              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                <div className="text-red-400 text-sm text-center p-4 bg-red-900/20 rounded-lg border border-red-700/30">
                  {cameraError}
                </div>
                <label className="flex flex-col items-center gap-4 cursor-pointer p-8 rounded-2xl bg-gray-900 border-2 border-dashed border-gray-700 hover:border-purple-500 w-full transition-colors">
                  <Upload size={48} className="text-purple-500" />
                  <span className="text-gray-300 font-medium text-center">
                    Upload Photo Instead
                  </span>
                  <span className="text-gray-500 text-xs text-center">
                    Or enable camera permissions and try again
                  </span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={onFileChange}
                  />
                </label>
              </div>
            ) : (
              // Loading state
              <div className="flex flex-col items-center gap-4 p-8">
                <Loader2 className="w-12 h-12 text-purple-500 animate-spin" />
                <span className="text-gray-400">Starting camera...</span>
              </div>
            )}
          </div>
        )}

        {step === 'crop' && imageSrc && (
          <div className="relative w-full h-[60vh] bg-black">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, croppedAreaPixels) => setCroppedAreaPixels(croppedAreaPixels)}
            />
          </div>
        )}

        {step === 'tag' && (
          <div className="w-full max-w-md overflow-y-auto max-h-[70vh] pb-20 space-y-6">
            
            {/* Defect Section */}
            <div>
              <h3 className="text-purple-400 text-sm font-bold uppercase tracking-wider mb-3 px-1">Defects</h3>
              <div className="grid grid-cols-2 gap-2">
                {DEFECT_TYPES.map(label => (
                  <button
                    key={label}
                    onClick={() => toggleLabel(label)}
                    className={`p-3 rounded-xl text-left font-medium text-sm transition-all ${
                      selectedLabels.includes(label)
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
                    onClick={() => toggleLabel(label)}
                    className={`p-3 rounded-xl text-left font-medium text-sm transition-all ${
                      selectedLabels.includes(label)
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
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-6 border-t border-gray-800 bg-black pb-10">
        {step === 'crop' && (
          <button 
            onClick={() => setStep('tag')}
            className="w-full bg-white text-black font-bold py-4 rounded-full flex items-center justify-center gap-2"
          >
            Next <Check size={20} />
          </button>
        )}
        
        {step === 'tag' && (
          <button 
            onClick={handleSubmit}
            disabled={selectedLabels.length === 0 || isSubmitting}
            className={`w-full disabled:bg-gray-700 disabled:opacity-50 text-white font-bold py-4 rounded-full flex items-center justify-center gap-2 transition-colors ${
              selectedLabels.some(l => DEFECT_TYPES.includes(l)) && selectedLabels.some(l => REGION_TYPES.includes(l))
                ? 'bg-gradient-to-r from-purple-600 to-emerald-600' // Mixed
                : selectedLabels.some(l => REGION_TYPES.includes(l))
                  ? 'bg-emerald-600' // Only Regions
                  : 'bg-purple-600' // Only Defects (or empty)
            }`}
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin" />
            ) : (
              `Submit ${selectedLabels.length > 0 ? `(${selectedLabels.length})` : ''}`
            )}
          </button>
        )}
      </div>
    </div>
  );
}
