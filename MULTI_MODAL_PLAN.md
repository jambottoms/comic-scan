# Multi-Modal Capture Implementation Plan

## Overview
Add front photo, back photo, and spine photo capture BEFORE video recording to improve Gemini AI accuracy.

## Current Flow
```
User clicks "Record" → Camera starts → Record video → Stop → Upload → Analyze
```

## New Flow
```
User clicks "Record" →
  Step 1: "Capture Front Cover" (photo) →
  Step 2: "Capture Back Cover" (photo) →
  Step 3: "Capture Spine" (photo) →
  Step 4: "Record Video" (existing flow) →
  Upload all 4 → Analyze with all inputs
```

## Implementation Strategy

### Option 1: Sequential Capture (Recommended)
Add a capture step system before video recording:

```tsx
// New state in GradeBookModal:
const [captureStep, setCaptureStep] = useState<'front' | 'back' | 'spine' | 'video'>('front');
const [frontPhoto, setFrontPhoto] = useState<Blob | null>(null);
const [backPhoto, setBackPhoto] = useState<Blob | null>(null);
const [spinePhoto, setSpinePhoto] = useState<Blob | null>(null);

// Flow:
1. Show camera preview
2. "Capture Front Cover" button → Take snapshot → Show preview → "Next"
3. "Capture Back Cover" button → Take snapshot → Show preview → "Next"
4. "Capture Spine" button → Take snapshot → Show preview → "Next"
5. "Record Video" → Existing video recording flow
6. Upload all 4 files to Supabase
7. Send all 4 to Gemini AI
```

### Option 2: All-at-Once Capture
Single screen with 3 photo buttons + video button:
- Less guided, users might skip photos
- Not recommended for consistent quality

## UI Changes Needed

### GradeBookModal.tsx

**New State:**
```tsx
const [captureMode, setCaptureMode] = useState<'multi' | 'video-only'>('multi'); // Let users toggle
const [captureStep, setCaptureStep] = useState<1 | 2 | 3 | 4>(1); // 1=front, 2=back, 3=spine, 4=video
const [capturedPhotos, setCapturedPhotos] = useState<{
  front: Blob | null;
  back: Blob | null;
  spine: Blob | null;
}>({ front: null, back: null, spine: null });
```

**New Functions:**
```tsx
const capturePhoto = () => {
  if (!videoRef.current) return;
  
  const canvas = document.createElement('canvas');
  canvas.width = videoRef.current.videoWidth;
  canvas.height = videoRef.current.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx?.drawImage(videoRef.current, 0, 0);
  
  canvas.toBlob((blob) => {
    if (!blob) return;
    
    switch (captureStep) {
      case 1: 
        setCapturedPhotos(prev => ({ ...prev, front: blob }));
        setCaptureStep(2);
        break;
      case 2:
        setCapturedPhotos(prev => ({ ...prev, back: blob }));
        setCaptureStep(3);
        break;
      case 3:
        setCapturedPhotos(prev => ({ ...prev, spine: blob }));
        setCaptureStep(4); // Move to video recording
        break;
    }
  }, 'image/jpeg', 0.95);
};
```

**UI for Each Step:**
```tsx
{captureStep === 1 && (
  <>
    <div className="text-center mb-4">
      <h3>Step 1 of 4: Front Cover</h3>
      <p className="text-sm text-gray-400">Position the front cover in frame</p>
    </div>
    <button onClick={capturePhoto}>
      <Camera /> Capture Front
    </button>
  </>
)}
```

## File Upload Changes

### Update analyzeComicFromUrl

Currently accepts: `videoUrl: string`

Change to accept:
```tsx
interface AnalysisInput {
  frontPhotoUrl?: string;
  backPhotoUrl?: string;
  spinePhotoUrl?: string;
  videoUrl: string;
}
```

### Update Gemini Prompt

```tsx
const parts = [];

if (frontPhotoUrl) {
  const frontData = await fetch(frontPhotoUrl).then(r => r.arrayBuffer());
  parts.push(
    { text: "High-resolution front cover photo:" },
    { inlineData: { mimeType: "image/jpeg", data: Buffer.from(frontData).toString('base64') } }
  );
}

if (backPhotoUrl) {
  const backData = await fetch(backPhotoUrl).then(r => r.arrayBuffer());
  parts.push(
    { text: "High-resolution back cover photo:" },
    { inlineData: { mimeType: "image/jpeg", data: Buffer.from(backData).toString('base64') } }
  );
}

if (spinePhotoUrl) {
  const spineData = await fetch(spinePhotoUrl).then(r => r.arrayBuffer());
  parts.push(
    { text: "Spine photo (shows staples, spine roll, and condition):" },
    { inlineData: { mimeType: "image/jpeg", data: Buffer.from(spineData).toString('base64') } }
  );
}

// Video (existing)
parts.push(
  { text: "Full 360° video showing all angles:" },
  { inlineData: { mimeType: "video/mp4", data: videoBase64 } },
  { text: GRADING_PROMPT }
);
```

## Storage Strategy

### Supabase Structure
```
scan-videos/
  {scanId}/
    front.jpg      (new)
    back.jpg       (new)
    spine.jpg      (new)
    video.mp4      (existing)
```

### Upload Sequence
```tsx
// 1. Upload all files
const [frontUrl, backUrl, spineUrl, videoUrl] = await Promise.all([
  uploadPhoto(frontBlob, `${scanId}/front.jpg`),
  uploadPhoto(backBlob, `${scanId}/back.jpg`),
  uploadPhoto(spineBlob, `${scanId}/spine.jpg`),
  uploadVideo(videoBlob, `${scanId}/video.mp4`),
]);

// 2. Analyze with all inputs
const result = await analyzeComicFromUrl({
  frontPhotoUrl: frontUrl,
  backPhotoUrl: backUrl,
  spinePhotoUrl: spineUrl,
  videoUrl: videoUrl
});
```

## User Experience

### Progress Indicator
```
○ ○ ○ ○  →  ● ○ ○ ○  →  ● ● ○ ○  →  ● ● ● ○  →  ● ● ● ●
Front      Back       Spine      Video    Done
```

### Skip Option
```tsx
<button onClick={() => setCaptureMode('video-only')}>
  Skip Photos (Video Only)
</button>
```

## Benefits

1. **Better AI Accuracy**: Gemini sees clear, sharp images instead of blurry video frames
2. **Better Spine Assessment**: Critical for grading
3. **No Motion Blur**: Photos are steady, video has motion
4. **Better Lighting**: User can adjust between photos
5. **Backward Compatible**: Can still do video-only

## Implementation Steps

1. ✅ Add region images to dashboard (DONE)
2. Add multi-modal capture UI to GradeBookModal
3. Add photo capture functions
4. Update upload logic to handle 4 files
5. Update analyzeComicFromUrl to accept multiple inputs
6. Update Gemini prompt to use all inputs
7. Test end-to-end flow

## Rollout Strategy

### Phase 1: Optional (Soft Launch)
- Add "Enhanced Mode" toggle
- Default to video-only for existing users
- Let power users try multi-modal

### Phase 2: Recommended
- Default to multi-modal
- Show "3x more accurate" message
- Allow skip to video-only

### Phase 3: Required
- Require at least front photo + video
- Make back/spine optional

## Estimated Time
- UI changes: 2-3 hours
- Backend changes: 1-2 hours
- Testing: 1 hour
- Total: 4-6 hours

## Next Step
Switch to agent mode and I'll implement this!

