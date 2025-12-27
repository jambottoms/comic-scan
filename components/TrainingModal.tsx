'use client';

import { useState, useCallback } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { X, Camera, Check, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { trainDefect } from '@/app/actions/train-defect';

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

export default function TrainingModal({ onClose }: { onClose: () => void }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<'capture' | 'crop' | 'tag'>('capture');

  // 1. Handle File Input (Camera)
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

  // 3. Submit
  const handleSubmit = async () => {
    if (!selectedLabel) return;
    setIsSubmitting(true);

    try {
      const blob = await getCroppedImg();
      if (!blob) throw new Error("Failed to crop");

      // Upload to Supabase 'training-data' bucket
      const supabase = createClient();
      if (!supabase) throw new Error("Failed to create Supabase client");
      
      const filename = `train-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('training-data')
        .upload(filename, blob);

      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('training-data')
        .getPublicUrl(filename);

      // Send to Nyckel
      const result = await trainDefect(publicUrl, selectedLabel);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      onClose();
      // Simple alert for now - could be a toast in a fuller implementation
      alert("Training sample added successfully!"); 
    } catch (e) {
      console.error(e);
      alert(`Failed to save sample: ${(e as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Header */}
      <div className="p-4 flex justify-between items-center border-b border-gray-800">
        <h2 className="text-white font-bold text-lg">
          {step === 'capture' ? 'New Sample' : step === 'crop' ? 'Crop Defect' : 'Label Defect'}
        </h2>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-white">
          <X />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-4 w-full">
        
        {step === 'capture' && (
          <label className="flex flex-col items-center gap-4 cursor-pointer p-8 rounded-2xl bg-gray-900 border-2 border-dashed border-gray-700 active:border-purple-500 w-full max-w-sm">
            <Camera size={48} className="text-purple-500" />
            <span className="text-gray-300 font-medium">Take Photo of Defect</span>
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              className="hidden" 
              onChange={onFileChange}
            />
          </label>
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
          <div className="grid grid-cols-2 gap-3 w-full max-w-md overflow-y-auto max-h-[60vh] pb-20">
            {DEFECT_TYPES.map(label => (
              <button
                key={label}
                onClick={() => setSelectedLabel(label)}
                className={`p-4 rounded-xl text-left font-medium transition-all ${
                  selectedLabel === label 
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' 
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
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
            disabled={!selectedLabel || isSubmitting}
            className="w-full bg-purple-600 disabled:bg-gray-700 text-white font-bold py-4 rounded-full flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : 'Submit Training Data'}
          </button>
        )}
      </div>
    </div>
  );
}

