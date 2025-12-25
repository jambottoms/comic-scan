# Solutions Memory Log

This document tracks major solutions to recurring issues to prevent repeating the same mistakes.

## Upload Issues

### Issue: Upload Hanging/Stuck
**Problem**: Uploads hang indefinitely, no error thrown, progress stops updating.

**Root Causes Identified**:
1. Supabase client upload promise never resolves/rejects
2. Progress interval continues running even after upload fails
3. No timeout on upload operation
4. Network issues not properly handled

**Solution Implemented** (2024-12-25):
- Added timeout wrapper (5 minutes max) using `Promise.race()`
- Clear progress interval in all code paths (success, error, timeout)
- Store interval reference to ensure cleanup
- Better error messages for timeout scenarios
- Progress simulation stops if max time exceeded

**Key Code Pattern**:
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('Timeout')), maxTime);
});

const result = await Promise.race([uploadPromise, timeoutPromise]);

// Always clear interval
if (progressInterval) {
  clearInterval(progressInterval);
  progressInterval = null;
}
```

**Files**: `lib/supabase/upload-with-progress.ts`

---

### Issue: "Invalid compact jws" Authentication Error
**Problem**: Supabase upload fails with JWT authentication error.

**Root Cause**: Supabase changed their key format. Manual XHR with Bearer token doesn't work with new format.

**Solution**: Use Supabase client's built-in `upload()` method which handles new key format automatically.

**Key Change**: Switched from manual XMLHttpRequest to `supabase.storage.from('bucket').upload()`

**Files**: `lib/supabase/upload-with-progress.ts`

---

## Modal Issues

### Issue: Modal Off-Screen on Mobile
**Problem**: Modals appear halfway off the right side of screen on mobile devices.

**Root Causes**:
1. Using `transform` classes instead of Tailwind utilities
2. Not accounting for viewport width properly
3. Missing mobile breakpoints
4. Fixed positioning without proper viewport calculations

**Solution**:
- Use `w-[calc(100vw-2rem)]` for mobile to account for padding
- Use Tailwind translate utilities: `-translate-x-1/2 -translate-y-1/2`
- Consistent breakpoints: `sm:` at 640px
- Responsive padding: `p-6 sm:p-8`
- Proper viewport units: `calc(100vh-4rem)` for mobile

**Files**: `components/UploadProgressModal.tsx`, `components/VideoInvestigatorModal.tsx`

---

## Hydration Issues

### Issue: Hydration Mismatch Error
**Problem**: Server-rendered HTML doesn't match client, causing React hydration errors.

**Root Cause**: Calling `localStorage` during SSR or initial render causes server/client mismatch.

**Solution**:
- Initialize state as empty array (not calling `getVideoHistory()` during SSR)
- Use `isMounted` state to track client-side mount
- Only load from localStorage in `useEffect` (runs after mount)
- Show loading state during SSR/hydration

**Key Pattern**:
```typescript
const [history, setHistory] = useState([]);
const [isMounted, setIsMounted] = useState(false);

useEffect(() => {
  setIsMounted(true);
  setHistory(getVideoHistory());
}, []);

// Render with isMounted check
{!isMounted ? <Loading /> : <Content />}
```

**Files**: `app/page.tsx`

---

## Type Safety Issues

### Issue: reasoning.split is not a function
**Problem**: `reasoning` field from API is not always a string, causing runtime errors.

**Root Cause**: Gemini API sometimes returns objects or other types instead of strings.

**Solution**:
- Add type checking and conversion in `parseReasoning`
- Handle objects, arrays, and other types
- Try common properties: `text`, `content`, `reasoning`
- Fallback to `JSON.stringify()` for complex objects
- Always convert to string before calling `.split()`

**Files**: `components/ResultCard.tsx`

---

## Video Processing Issues

### Issue: FFmpeg Process Exited with Code 183
**Problem**: FFmpeg fails when processing videos from pipes/streams.

**Root Cause**: FFmpeg needs to seek to end of file to read metadata atom. Pipes don't support seeking.

**Solution**: Use two-step file process:
1. Download entire video to `/tmp/input.mov` using `fs.promises.writeFile`
2. Run FFmpeg on physical file: `ffmpeg -y -i /tmp/input.mov ... /tmp/output.mp4`
3. Upload from `/tmp/output.mp4`
4. Cleanup both files in `finally` block

**Key Pattern**:
```typescript
// Download to file
await writeFile('/tmp/input.mov', await fetch(url).then(r => r.arrayBuffer()));

// Process physical file
spawnSync(ffmpegPath, ['-y', '-i', '/tmp/input.mov', ...flags..., '/tmp/output.mp4']);

// Upload from file
await fileManager.uploadFile('/tmp/output.mp4', { mimeType: 'video/mp4' });

// Cleanup
await Promise.allSettled([
  unlink('/tmp/input.mov'),
  unlink('/tmp/output.mp4')
]);
```

**Files**: `app/actions/analyze-from-url.ts`, `lib/video/normalize.ts`

---

## Google File API Issues

### Issue: 404 Model Not Found Error
**Problem**: Calling Gemini API immediately after upload returns 404.

**Root Cause**: File is in `PROCESSING` state, not `ACTIVE`. Must poll until `ACTIVE`.

**Solution**: Implement polling loop after upload:
```typescript
let file = uploadResult.file;
while (file.state !== 'ACTIVE') {
  if (file.state === 'FAILED') {
    throw new Error('File processing failed');
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  file = await fileManager.getFile(file.name);
}
// Now safe to call model
```

**Files**: `app/actions/analyze-from-url.ts`

---

## Best Practices Established

1. **Always add timeouts** to async operations that might hang
2. **Always clear intervals** in all code paths (success, error, timeout)
3. **Use `Promise.race()`** for timeout patterns
4. **Check `isMounted`** before accessing browser APIs (localStorage, etc.)
5. **Convert types safely** before calling string methods
6. **Use physical files** for FFmpeg operations (not pipes/streams)
7. **Poll for ACTIVE state** before using Google File API files
8. **Use Supabase client methods** instead of manual API calls
9. **Add mobile breakpoints** consistently: `sm:` at 640px
10. **Use viewport calculations** for mobile: `calc(100vw-2rem)`

---

## Common Mistakes to Avoid

1. ❌ Don't call `localStorage` during SSR or initial render
2. ❌ Don't use pipes/streams with FFmpeg (use physical files)
3. ❌ Don't call Gemini API before file is ACTIVE
4. ❌ Don't forget to clear intervals/timeouts
5. ❌ Don't assume API responses are always strings
6. ❌ Don't use manual auth headers with Supabase (use client methods)
7. ❌ Don't forget mobile viewport calculations
8. ❌ Don't skip timeout wrappers on async operations

---

Last Updated: 2024-12-25

