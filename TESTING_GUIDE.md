# Testing Video Upload on Vercel Pro

## Pre-Test Checklist
- [ ] Vercel Pro plan is active
- [ ] Latest commit is deployed (check Vercel dashboard)
- [ ] `vercel.json` is in the repository (should be at root)
- [ ] Function timeout is set to 60s in Vercel settings

## Test Steps

### 1. Open Your Vercel Deployment
- Go to your Vercel project URL
- Open browser DevTools (F12 or Cmd+Option+I)

### 2. Open Browser Console
- Look for these logs when uploading:
  - `"Sending video to server for analysis..."`
  - `"File details:"` with file size/type
  - Any error messages

### 3. Open Network Tab
- Filter by "fetch" or look for server action requests
- Check the request:
  - Status code (should be 200 if successful)
  - Request size
  - Response time
  - Response body

### 4. Check Vercel Logs
- Go to Vercel Dashboard → Your Project → Logs
- Look for:
  - `[Server Action] Processing video: X.XXMB`
  - `[Server Action] File name: ...`
  - Any timeout or error messages

### 5. Test with the Same Video
- Use the exact same video file that worked locally
- Note the file size
- Watch for any differences in behavior

## What to Look For

### Success Indicators:
- ✅ Console shows "Analysis complete, received data:"
- ✅ Result card appears with comic information
- ✅ No error messages in console
- ✅ Network request returns 200 status
- ✅ Vercel logs show successful processing

### Failure Indicators:
- ❌ "Unexpected response" error
- ❌ Timeout errors in Vercel logs
- ❌ 413 (Payload Too Large) errors
- ❌ Function execution exceeds 60s
- ❌ Network request fails or times out

## If It Still Fails

### Check Vercel Function Settings:
1. Go to Project Settings → Functions
2. Verify:
   - Max Duration: 60 seconds
   - Memory: Check if it's sufficient
   - Region: Should be close to your users

### Check Request Size:
- Vercel Pro still has a 4.5MB body size limit for serverless functions
- If your video is larger, you may need to:
  - Compress the video
  - Use chunked uploads
  - Use a different approach (e.g., direct to S3, then process)

### Check Error Details:
- Copy the exact error message
- Check the Vercel function logs for detailed errors
- Note the file size that's failing
- Check if it's consistent or intermittent

## Expected Behavior

With Vercel Pro and `vercel.json`:
- ✅ Videos up to 100MB should work (per Next.js config)
- ✅ Function timeout is 60 seconds
- ✅ Server actions should handle large files better

If videos are still failing:
- May need to check Vercel's actual body size limits
- May need to implement chunked uploads
- May need to use a different storage/processing approach

