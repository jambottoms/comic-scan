# Supabase Setup Guide

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in:
   - Project name: `comic-scan` (or your choice)
   - Database password: (save this securely)
   - Region: Choose closest to you
5. Wait for project to be created (~2 minutes)

## Step 2: Create Storage Bucket

1. In your Supabase project, go to **Storage** in the left sidebar
2. Click **"New bucket"**
3. Name: `comic-videos`
4. **Public bucket**: ✅ Enable (so files are accessible via URL)
5. Click **"Create bucket"**

## Step 2.5: Set Up Storage Policies (IMPORTANT!)

After creating the bucket, you need to allow public uploads. **Use Option 2 (SQL Editor) - it's much easier!**

### Option 1: Using Dashboard (if you prefer visual)

1. Go to your Supabase project dashboard
2. Click **"Storage"** in the left sidebar
3. Click on the **"comic-videos"** bucket name
4. Click the **"Policies"** tab at the top
5. Click **"New Policy"**
6. Choose **"For full customization"** or **"Create a policy from scratch"**
7. Fill in:
   - Policy name: `Allow public uploads`
   - Allowed operations: Check **INSERT** and **SELECT** (at minimum)
   - Target roles: `public`
   - Policy definition: `true` (allows all operations)
8. Click **"Review"** then **"Save policy"**

### Option 2: Using SQL Editor (RECOMMENDED - Fastest!)

1. Go to your Supabase project dashboard
2. Click **"SQL Editor"** in the left sidebar (or go to: https://app.supabase.com/project/assxznljobjlycunlphw/sql)
3. Click **"New query"**
4. Copy and paste the SQL from `SUPABASE_STORAGE_POLICY.sql` file
5. Click **"Run"** (or press Cmd/Ctrl + Enter)
6. You should see "Success. No rows returned"

This will create all the necessary policies in one go!

## Step 3: Set Up Environment Variables

1. In Supabase project, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)

3. Add to your `.env.local` file (create if it doesn't exist):
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

4. **Also add to Vercel:**
   - Go to your Vercel project
   - Settings → Environment Variables
   - Add both variables for all environments (Production, Preview, Development)

## Step 4: Install Dependencies

Run in your terminal:
```bash
npm install @supabase/supabase-js @supabase/ssr
```

## Step 5: Test the Setup

1. Start your dev server: `npm run dev`
2. Try uploading a video file
3. Check:
   - Browser console for Supabase upload logs
   - Supabase Storage dashboard to see if file appears
   - That analysis completes successfully

## How It Works

1. **Client uploads directly to Supabase Storage** (bypasses Vercel's 4.5MB limit)
2. **Gets public URL** from Supabase
3. **Sends URL to server action** (small payload, no size limit issue)
4. **Server action downloads from Supabase** and processes with Gemini
5. **Returns analysis results**

## Storage Limits

- **Free tier**: 1GB storage, 2GB bandwidth/month
- **Pro tier**: 100GB storage, 200GB bandwidth/month
- **File size**: Up to 50MB per file on free tier, 5GB on Pro

## Troubleshooting

### "Failed to upload to Supabase"
- Check that bucket name is exactly `comic-videos`
- Verify bucket is set to **Public**
- Check environment variables are set correctly

### "Failed to get public URL"
- Ensure bucket is public
- Check file was uploaded successfully in Supabase dashboard

### "Failed to download video from Supabase"
- Verify the URL is accessible (try opening in browser)
- Check bucket permissions
- Ensure file wasn't deleted

