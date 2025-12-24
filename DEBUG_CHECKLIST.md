# Debugging Checklist: "Unexpected Response" Error

## Step 1: Verify Server Action is Being Called
**Check browser console:**
- Look for: `"Sending video to server for analysis..."`
- Look for: `"File details:"` with file size/type
- If these don't appear, the error is happening before the server action is called

**Check server terminal (if running locally):**
- Look for: `[Server Action] Processing video: X.XXMB`
- Look for: `[Server Action] File name: ...`
- If these don't appear, the request isn't reaching the server action

## Step 2: Test with a Small File
**Create a test:**
1. Try uploading a very small video (< 1MB)
2. If it works → likely a file size issue
3. If it fails → likely a configuration/platform issue

## Step 3: Check Vercel Function Limits
**Vercel Default Limits:**
- **Hobby Plan:** 10s timeout, 4.5MB request body
- **Pro Plan:** 60s timeout (can be increased), 4.5MB request body
- **Enterprise:** Custom limits

**Check your Vercel dashboard:**
1. Go to your project settings
2. Check "Functions" tab
3. Look for timeout settings
4. Check if you're on Hobby plan (10s timeout is very short for video processing)

## Step 4: Test Locally vs Production
**Run locally:**
```bash
npm run dev
```
- Upload the same video file
- Check if error occurs locally
- If it works locally but fails on Vercel → Vercel configuration issue
- If it fails both → code issue

## Step 5: Check Vercel Logs
**In Vercel Dashboard:**
1. Go to your project
2. Click "Functions" tab
3. Look for recent function invocations
4. Check for:
   - Timeout errors
   - Memory errors
   - Size limit errors
   - Any error messages

## Step 6: Verify Next.js Configuration
**Current config:**
- `serverActions.bodySizeLimit: '100mb'` (in experimental)
- This should work, but verify it's being applied

**Test:**
- Check if smaller files work
- If 100MB limit isn't working, Vercel might have a lower platform limit

## Step 7: Create a Minimal Test Server Action
**Create a test file to isolate the issue:**

Create `app/test-action.ts`:
```typescript
'use server';

export async function testAction(formData: FormData) {
  const file = formData.get("file") as File;
  if (!file) {
    return { error: "No file" };
  }
  
  return {
    success: true,
    fileName: file.name,
    fileSize: file.size,
    fileSizeMB: (file.size / 1024 / 1024).toFixed(2)
  };
}
```

Then test with a simple button that calls this - if this fails, it's a Next.js/Vercel config issue, not our code.

## Step 8: Check Network Tab
**In browser DevTools:**
1. Open Network tab
2. Upload video
3. Look for the server action request
4. Check:
   - Request size
   - Response status
   - Response body (if any)
   - Timing information

## Step 9: Verify Environment Variables
**Check Vercel:**
1. Go to project settings → Environment Variables
2. Verify `GOOGLE_API_KEY` is set
3. Check if it's set for the correct environment (Production/Preview/Development)

## Step 10: Check Next.js Version Compatibility
**Current:** Next.js 16.1.1
- Server actions were experimental in earlier versions
- Verify this version supports the features we're using
- Check Next.js docs for known issues with server actions and large files

## Most Likely Issues:
1. **Vercel timeout** (if on Hobby plan - 10s is too short)
2. **Vercel body size limit** (4.5MB default, even with our config)
3. **Next.js server action serialization** (large responses can fail)
4. **Network/connection issue** (upload interrupted)

## Quick Fixes to Try:
1. **Add vercel.json** to increase timeout:
```json
{
  "functions": {
    "app/**/*.ts": {
      "maxDuration": 60
    }
  }
}
```

2. **Test with a 5MB file** to see if it's a size issue
3. **Check Vercel plan** - upgrade if needed for longer timeouts
4. **Try the test action** to isolate if it's our code or platform

