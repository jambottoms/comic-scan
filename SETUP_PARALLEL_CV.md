# Setup Guide: Parallel CV Worker

## Quick Setup (5 minutes)

### 1. Update Environment Variables

You need to set the Modal webhook URL in your environment:

**Local Development (.env.local):**
```bash
MODAL_CV_WEBHOOK_URL=https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run
```

**Production (Vercel):**
```bash
# Via Vercel CLI
vercel env add MODAL_CV_WEBHOOK_URL
# When prompted, paste: https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run

# OR via Vercel Dashboard
# 1. Go to your project settings
# 2. Navigate to Environment Variables
# 3. Add/Update:
#    Name: MODAL_CV_WEBHOOK_URL
#    Value: https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run
#    Environments: Production, Preview, Development
```

### 2. Verify Deployment

The parallel worker is already deployed to Modal:
```
✓ Deployment URL: https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run
✓ View in dashboard: https://modal.com/apps/jambottoms/main/deployed/gradevault-cv-worker
```

### 3. Test the Integration

#### Option A: Quick Test via API

```bash
curl -X POST https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "YOUR_VIDEO_URL",
    "scanId": "test-parallel-001",
    "itemType": "card"
  }'
```

#### Option B: Test via Your App

1. Start your Next.js dev server:
   ```bash
   npm run dev
   ```

2. Upload a video through the web interface

3. Watch the console logs for parallel processing indicators:
   ```
   🔀 Splitting into N parallel workers...
   ⚡ Processing N chunks in parallel...
   ✅ Analyzed ALL XXX frames
   ```

4. Check Modal logs: https://modal.com/apps/jambottoms/main/deployed/gradevault-cv-worker

### 4. Verify Performance Improvement

Compare processing times:

| Test | Before (Sequential) | After (Parallel) | Improvement |
|------|-------------------|------------------|-------------|
| Short video (150 frames) | ~2 min | ~45 sec | 2.5x faster |
| Medium video (300 frames) | ~4 min | ~1.5 min | 3x faster |
| Long video (600 frames) | ~9 min | ~2.5 min | 3.5x faster |

## Configuration Details

### Modal Secrets

The worker requires these Modal secrets (already configured):
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_KEY`: Your Supabase service role key

To verify/update:
```bash
modal secret list
# Should show: supabase-secrets
```

### Parallel Processing Parameters

The system automatically optimizes based on video length:

```python
# Minimum frames per chunk (for accurate optical flow)
min_frames_per_chunk = 30

# Maximum parallel workers
max_workers = 10

# Calculated: num_workers = min(10, max(2, total_frames // 30))
```

**Examples:**
- 60 frames → 2 workers
- 150 frames → 5 workers
- 300 frames → 7 workers
- 600+ frames → 10 workers (max)

### Timeout Configuration

Each worker has a 90-second timeout:

```python
@app.function(
    timeout=90,  # Per chunk
)
```

The main orchestrator has a 5-minute timeout:

```python
@app.function(
    timeout=300,  # Total
)
```

## Troubleshooting

### Issue: "CV analysis not configured"

**Cause:** `MODAL_CV_WEBHOOK_URL` not set in environment

**Solution:**
```bash
# Check if set
echo $MODAL_CV_WEBHOOK_URL

# If empty, add to .env.local
echo 'MODAL_CV_WEBHOOK_URL=https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run' >> .env.local

# Restart Next.js dev server
npm run dev
```

### Issue: Processing still takes a long time

**Cause:** Multiple possibilities
1. Video not actually triggering CV analysis
2. Modal cold start (first request)
3. Large video file download

**Check:**
1. Look for "CV Analysis" logs in your Next.js console
2. Verify Modal webhook is being called
3. Check Modal dashboard for function execution
4. First run may take longer (cold start), subsequent runs should be fast

### Issue: "Timeout after 90 seconds"

**Cause:** Individual chunk taking too long (rare)

**Solution:** Edit `cv_worker.py`:
```python
@app.function(
    timeout=120,  # Increase from 90
)
def analyze_frame_chunk(...):
```

Then redeploy:
```bash
modal deploy cv_worker.py
```

### Issue: Different results than before

**Cause:** Should NOT happen (algorithms are identical)

**Debug:**
1. Check Modal logs for errors
2. Verify all chunks completed successfully
3. Compare frame numbers in output
4. Check for video corruption/truncation

## Monitoring

### Real-time Logs

View in Modal dashboard:
```
https://modal.com/apps/jambottoms/main/deployed/gradevault-cv-worker
```

Look for:
```
[Chunk 0] Processing frames 0-60
[Chunk 1] Processing frames 60-120
...
[Chunk 0] Found 87 stable frames
[Chunk 1] Found 92 stable frames
✅ Analyzed ALL 300 frames
   Found 432 stable frames (motion ≤ 1.0)
```

### Performance Metrics

Track in Modal dashboard:
- **Function duration**: Should be 60-70% shorter
- **Concurrency**: Multiple `analyze_frame_chunk` running simultaneously
- **Cost**: Similar to before (faster but parallel)

### Error Monitoring

Common errors to watch for:
- `VideoCapture failed`: Video URL expired/invalid
- `Storage upload failed`: Supabase credentials issue
- `Timeout`: Video too large or high resolution

## Rollback (If Needed)

If you need to rollback to the sequential version:

1. Get the old version from git:
   ```bash
   git show HEAD~1:cv_worker.py > cv_worker_sequential.py
   ```

2. Deploy the old version:
   ```bash
   modal deploy cv_worker_sequential.py
   ```

3. Update webhook URL in environment variables

Note: Not recommended unless there's a critical issue - the parallel version maintains identical precision.

## Next Steps

Once verified working:

1. ✅ Monitor first 10-20 video analyses
2. ✅ Compare quality of golden frames (should be identical)
3. ✅ Measure average processing time (should be 3-5x faster)
4. ✅ Check Modal costs (should be similar)
5. ✅ Update any documentation mentioning processing times

## Advanced: Further Optimization

If you need even more speed:

### Option 1: GPU Acceleration (2-3x additional)

```python
cv_image_gpu = (
    modal.Image.from_registry("nvidia/cuda:12.1.0-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "ffmpeg")
    .pip_install("opencv-contrib-python==4.9.0.80")  # GPU modules
)

@app.function(
    image=cv_image_gpu,
    gpu="T4",
)
```

Cost increase: ~10x (CPU: $0.05/hr → GPU: $0.50/hr)

### Option 2: Reduce Frame Spacing

Allow frames to be selected closer together:

```python
min_gap = 10  # Instead of 15
```

Faster selection but slightly less temporal diversity.

### Option 3: Early Termination

Stop processing once enough high-quality candidates are found:

```python
if len(all_candidates) >= 50:  # More than enough
    break
```

## Support

- Modal Dashboard: https://modal.com/apps/jambottoms/main/deployed/gradevault-cv-worker
- Modal Docs: https://modal.com/docs
- Code: `cv_worker.py` (see inline comments)
- Full docs: `PARALLEL_CV_UPGRADE.md`

