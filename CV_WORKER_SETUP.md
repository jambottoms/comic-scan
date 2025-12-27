# CV Worker Setup Guide

This guide explains how to deploy the Python CV analysis worker using Modal.com.

## Prerequisites

1. A Modal.com account (free tier available)
2. Python 3.9+ installed locally
3. The Modal CLI

## Step 1: Install Modal

```bash
pip install modal
```

## Step 2: Authenticate with Modal

```bash
modal token new
```

This will open a browser to authenticate.

## Step 3: Create Supabase Secrets in Modal

Go to [Modal Secrets](https://modal.com/secrets) and create a new secret called `supabase-secrets` with these values:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `SUPABASE_KEY` | Your Supabase anon/public key |

You can find these in your Supabase project settings.

## Step 4: Create the analysis-images Bucket

In Supabase Dashboard:

1. Go to **Storage** → **New Bucket**
2. Name: `analysis-images`
3. **Public bucket**: ✅ Enabled
4. Click **Create bucket**

## Step 5: Deploy the Worker

```bash
cd /path/to/comic-scan
modal deploy cv_worker.py
```

You should see output like:
```
✓ Created objects.
├── 🔨 Created function analyze_video
├── 🔨 Created function trigger_analysis
└── 🔨 Created web endpoint trigger_analysis => https://your-username--gradevault-cv-worker-trigger-analysis.modal.run
```

## Step 6: Set the Webhook URL

Copy the webhook URL from the deploy output and add it to your environment:

### For local development (.env.local):
```
MODAL_CV_WEBHOOK_URL=https://your-username--gradevault-cv-worker-trigger-analysis.modal.run
```

### For Vercel deployment:
Add `MODAL_CV_WEBHOOK_URL` in your Vercel project settings under Environment Variables.

## Step 7: Test the Worker

### Test locally with Modal CLI:
```bash
modal run cv_worker.py --video-url "https://your-supabase-url/storage/v1/object/public/comic-videos/test.mp4" --scan-id "test-123"
```

### Test via the API:
```bash
curl -X POST http://localhost:3000/api/cv-analysis \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://...", "scanId": "test-123", "itemType": "card"}'
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User records video in GradeVault app                        │
│  2. Video uploads to Supabase                                   │
│  3. Gemini AI analyzes and returns grade                        │
│  4. App triggers /api/cv-analysis endpoint                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. API calls Modal webhook                                      │
│  6. Modal spins up Python container                             │
│  7. Downloads video, runs CV analysis                           │
│  8. Uploads images to Supabase                                  │
│  9. Returns URLs to app                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  10. App updates localStorage with CV results                   │
│  11. ResultCard displays golden frames & defect analysis        │
└─────────────────────────────────────────────────────────────────┘
```

## Monitoring

View logs and metrics at: https://modal.com/apps/gradevault-cv-worker

## Costs

Modal.com pricing (as of Dec 2024):
- **Free tier**: 30 compute-hours/month
- **CPU**: $0.000024/second
- **Memory**: $0.000003/GB-second

Estimated cost per video analysis: **~$0.0005** (fraction of a cent)

## Troubleshooting

### "Modal webhook not configured"
- Check that `MODAL_CV_WEBHOOK_URL` is set in your environment

### "CV analysis failed"
- Check Modal logs: https://modal.com/apps/gradevault-cv-worker
- Verify Supabase secrets are set correctly

### Images not appearing in UI
- Check that `analysis-images` bucket is public
- Check browser console for errors
- Verify the result includes `goldenFrames` array

