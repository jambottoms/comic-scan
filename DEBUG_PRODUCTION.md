# Debugging Production Errors

If you're getting a generic error in production but it works locally, follow these steps:

## Step 1: Verify Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Verify these variables are set for **all environments** (Production, Preview, Development):
   - `GOOGLE_API_KEY` - Your Google Gemini API key
   - `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anon/publishable key

4. **Important**: After adding/updating environment variables, you must **redeploy** your application for changes to take effect.

## Step 2: Check Vercel Function Logs

1. Go to your Vercel project dashboard
2. Navigate to **Deployments** → Select the latest deployment
3. Click on **Functions** tab
4. Look for function invocations with errors
5. Click on a failed function to see detailed logs

Look for log entries prefixed with `[Server Action]` - these contain detailed error information.

## Step 3: Common Issues

### "GOOGLE_API_KEY is not set"
- **Solution**: Add `GOOGLE_API_KEY` to Vercel environment variables and redeploy

### "Failed to download video from Supabase"
- **Solution**: Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set correctly
- Verify Supabase Storage bucket `comic-videos` exists and has public read access

### "Model not found" or "404"
- **Solution**: 
  1. Verify your Google API key has access to Gemini models
  2. Check that billing is enabled (even for free tier)
  3. Try regenerating your API key from https://aistudio.google.com/apikey

### Timeout errors
- **Solution**: The video may be too long. Try a shorter video (5-10 seconds)

## Step 4: Test the Fix

After making changes:
1. Redeploy your application in Vercel
2. Wait for deployment to complete
3. Test video upload on production
4. Check function logs if errors persist


