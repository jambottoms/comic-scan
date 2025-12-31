# Vercel Environment Variable Setup

## Critical: Phase 2 Requires MODAL_CV_WEBHOOK_URL

If Phase 2 hangs on "Initializing CV analysis..." for more than 2 minutes, the most common cause is a missing environment variable.

## Required Environment Variables

### 1. MODAL_CV_WEBHOOK_URL ⚠️ CRITICAL

**Value:**
```
https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run
```

**Purpose:** Webhook endpoint for the Modal CV worker that processes video frames.

**If missing:** Phase 2 will fail immediately with error "Modal CV webhook not configured"

### 2. GOOGLE_API_KEY

**Value:** Your Google Gemini API key (starts with `AIza...`)

**Purpose:** Powers Phase 1 AI analysis and multi-frame verification in Phase 2.

**If missing:** Phase 1 will fail, no analysis will occur.

### 3. SUPABASE_URL

**Value:** Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)

**Purpose:** Database and storage backend.

**If missing:** App won't load, no data will be saved.

### 4. SUPABASE_KEY

**Value:** Your Supabase **service role key** (starts with `eyJ...`)

**Purpose:** Server-side database access (NOT the anon key).

**If missing:** Server Actions will fail, progress tracking won't work.

### 5. NEXT_PUBLIC_SUPABASE_URL

**Value:** Same as `SUPABASE_URL`

**Purpose:** Client-side Supabase access.

**If missing:** Client-side features won't work.

### 6. NEXT_PUBLIC_SUPABASE_ANON_KEY

**Value:** Your Supabase **anon key** (different from service role key)

**Purpose:** Client-side Supabase access (public API key).

**If missing:** Real-time subscriptions and client queries will fail.

## How to Set Environment Variables in Vercel

### Via Vercel Dashboard (Recommended)

1. Go to: https://vercel.com/[your-username]/comic-scan/settings/environment-variables
2. Click "Add New"
3. Enter:
   - **Key:** `MODAL_CV_WEBHOOK_URL`
   - **Value:** `https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run`
   - **Environment:** Select all (Production, Preview, Development)
4. Click "Save"
5. **IMPORTANT:** Redeploy your app for changes to take effect

### Via Vercel CLI

```bash
# Set single variable
vercel env add MODAL_CV_WEBHOOK_URL production

# Then paste the value when prompted
# Repeat for preview and development environments
```

### Via Project Settings > General > Redeploy

After adding environment variables, you MUST redeploy:
1. Go to "Deployments" tab
2. Click "..." on latest deployment
3. Click "Redeploy"
4. OR: Push any commit to trigger auto-redeploy

## How to Verify Environment Variables Are Set

### Method 1: Check Vercel Dashboard
1. Go to Settings > Environment Variables
2. Verify all 6 variables are listed
3. Each should show "Production, Preview, Development"

### Method 2: Check Vercel Logs
1. Go to Deployments > [Latest] > Functions
2. Look for Phase 2 logs
3. Should see: `[Phase 2] Modal URL: https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run`
4. If you see: `[Phase 2] CRITICAL: Modal CV webhook not configured` → Variable is missing

### Method 3: Test a Scan
1. Upload a video on mobile
2. Wait for Phase 1 to complete
3. Check CV Analysis Card debug panel
4. If stuck at 0% for 2+ minutes → Environment variable issue

## Common Issues

### Issue: "Modal CV webhook not configured"

**Cause:** `MODAL_CV_WEBHOOK_URL` not set in Vercel

**Solution:**
1. Add the environment variable in Vercel dashboard
2. Use exact URL: `https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run`
3. Redeploy the app
4. Try another scan

### Issue: "Modal worker failed: 404"

**Cause:** Modal CV worker not deployed OR webhook URL incorrect

**Solution:**
1. Check GitHub Actions: https://github.com/jambottoms/comic-scan/actions
2. Verify "Deploy Modal CV Worker" workflow succeeded
3. Check Modal dashboard: https://modal.com/apps/jambottoms
4. Verify webhook URL matches deployment

### Issue: "Modal worker failed: 500"

**Cause:** Modal worker crashed (bug in cv_worker.py)

**Solution:**
1. Check Modal logs: https://modal.com/apps/jambottoms
2. Look for Python errors in worker logs
3. Check Supabase secrets are configured in Modal
4. Verify video URL is accessible

### Issue: Phase 2 never starts (no progress at all)

**Cause:** `updateWithCVProcessing()` not being called

**Solution:**
1. Check browser console for "[MOBILE DEBUG] Starting Phase 2" log
2. If missing, Phase 2 might not be triggered
3. Check GradeBookModal.tsx is calling the function
4. Clear browser cache and try again

## Testing After Setup

### Quick Test
1. Upload a short video (5-10 seconds)
2. Watch the debug panel in CV Analysis Card
3. Should see:
   - `Status: cv_processing` (immediately)
   - `Polling: ENABLED` (immediately)
   - `Progress: 5% → 15% → 25% → ...` (within 30 seconds)

### Expected Timeline
- **Phase 1 (AI):** 10-20 seconds
- **Phase 2 (CV) initialization:** < 5 seconds
- **Phase 2 (CV) processing:** 30-60 seconds (first scan), 15-30 seconds (subsequent)
- **Total:** 60-90 seconds for complete analysis

## Debugging Checklist

If Phase 2 is stuck:

- [ ] Is `MODAL_CV_WEBHOOK_URL` set in Vercel?
- [ ] Did you redeploy after adding the variable?
- [ ] Is GitHub Actions "Deploy Modal CV Worker" workflow green?
- [ ] Is the Modal app deployed? (Check Modal dashboard)
- [ ] Is the webhook URL correct? (Check Vercel function logs)
- [ ] Can you see "[Phase 2] Calling Modal..." in Vercel logs?
- [ ] Any errors in Vercel function logs?
- [ ] Any errors in Modal worker logs?

## Quick Fix Commands

```bash
# Check local env (for development)
cat .env.local | grep MODAL

# Expected output:
# MODAL_CV_WEBHOOK_URL=https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run

# Test Modal endpoint directly
curl -X POST https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "https://example.com/test.mp4",
    "scanId": "test-123",
    "itemType": "comic"
  }'

# Expected: JSON response with error (video not found) OR success
# If you get 404, Modal worker is not deployed
```

## Need Help?

1. **Check Vercel Logs:** Look for Phase 2 errors
2. **Check Modal Logs:** Look for worker crashes
3. **Check GitHub Actions:** Verify deployment succeeded
4. **Check This Doc:** Follow debugging checklist above

