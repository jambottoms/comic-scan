# Migration Guide: CPU → GPU Workers

This guide walks you through migrating from CPU-only to GPU-accelerated CV processing.

## Prerequisites

✅ CPU worker (`cv_worker.py`) already deployed and working  
✅ Modal CLI installed and authenticated  
✅ Access to your Modal dashboard  
✅ 10 minutes for deployment and testing  

---

## Migration Options

### Option 1: Side-by-Side Deployment (Recommended)
Keep CPU worker running, add GPU as new deployment. Switch traffic gradually.

**Pros:**
- Zero downtime
- Easy rollback if issues
- A/B test performance

**Cons:**
- Two workers to maintain temporarily

---

### Option 2: Direct Replacement
Replace CPU worker with GPU worker directly.

**Pros:**
- Simpler (one worker)
- Cleaner

**Cons:**
- Brief downtime during switch
- Harder to rollback

---

## Step-by-Step: Side-by-Side Deployment

### 1. Verify CPU Worker is Running

```bash
# Check current deployment
modal app list

# Should see: gradevault-cv-worker
```

### 2. Deploy GPU Worker (New Name)

```bash
# Deploy GPU version with different name
modal deploy cv_worker_gpu.py

# This creates: gradevault-cv-worker-gpu
```

Output should show:
```
✓ Created web function gradevault-cv-worker-gpu-trigger-analysis-gpu
  => https://your-org--gradevault-cv-worker-gpu-trigger-analysis-gpu.modal.run
```

**Save this URL!** You'll need it.

### 3. Test GPU Worker

```bash
# Test with a sample video
modal run cv_worker_gpu.py \
  --video-url "https://your-supabase-url/storage/v1/object/public/videos/test-video.mp4" \
  --scan-id "gpu-migration-test"
```

Expected output:
```
🎬 Processing scan: gpu-migration-test (GPU MODE)
🎮 GPU: T4 (16GB VRAM)
[GPU Chunk 0] CUDA available: True  ← ✅ Look for this!
✅ Analyzed ALL 600 frames
⏱️  Total time: ~14s
```

### 4. Compare Results (Validation)

Run same video through both workers:

```bash
# CPU version
modal run cv_worker.py \
  --video-url "https://..." \
  --scan-id "compare-cpu" \
  > cpu_results.json

# GPU version
modal run cv_worker_gpu.py \
  --video-url "https://..." \
  --scan-id "compare-gpu" \
  > gpu_results.json

# Compare outputs (should be nearly identical)
diff cpu_results.json gpu_results.json
```

Small floating-point differences are OK (±0.0001). Defect detection should be identical.

### 5. Update Next.js API Route (Gradual Switch)

#### Option A: Environment Variable Switch

```typescript
// app/api/cv-analysis/route.ts

const MODAL_ENDPOINT = process.env.MODAL_USE_GPU === 'true'
  ? process.env.MODAL_CV_WEBHOOK_URL_GPU  // GPU endpoint
  : process.env.MODAL_CV_WEBHOOK_URL;     // CPU endpoint

export async function POST(request: Request) {
  const { videoUrl, scanId } = await request.json();
  
  const response = await fetch(MODAL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl, scanId, itemType: 'comic' })
  });
  
  return Response.json(await response.json());
}
```

Add to `.env.local`:
```bash
MODAL_USE_GPU=false  # Start with CPU
MODAL_CV_WEBHOOK_URL_GPU=https://your-gpu-endpoint.modal.run
```

Then flip to GPU:
```bash
MODAL_USE_GPU=true  # Switch to GPU
```

#### Option B: User Tier-Based Routing

```typescript
// app/api/cv-analysis/route.ts
import { getUserTier } from '@/lib/auth';

export async function POST(request: Request) {
  const { videoUrl, scanId, userId } = await request.json();
  
  // Route based on user tier
  const userTier = await getUserTier(userId);
  
  const endpoint = userTier === 'premium'
    ? process.env.MODAL_CV_WEBHOOK_URL_GPU   // Premium → GPU
    : process.env.MODAL_CV_WEBHOOK_URL;      // Free → CPU
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl, scanId, itemType: 'comic' })
  });
  
  return Response.json(await response.json());
}
```

#### Option C: Percentage Rollout (Canary)

```typescript
// app/api/cv-analysis/route.ts

export async function POST(request: Request) {
  const { videoUrl, scanId } = await request.json();
  
  // 10% of traffic goes to GPU (canary test)
  const useGPU = Math.random() < 0.10;
  
  const endpoint = useGPU
    ? process.env.MODAL_CV_WEBHOOK_URL_GPU
    : process.env.MODAL_CV_WEBHOOK_URL;
  
  console.log(`[CV Analysis] Using ${useGPU ? 'GPU' : 'CPU'} for ${scanId}`);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl, scanId, itemType: 'comic' })
  });
  
  return Response.json(await response.json());
}
```

Gradually increase: 10% → 25% → 50% → 100%

### 6. Monitor Both Workers

```bash
# Watch GPU logs
modal logs --function gradevault-cv-worker-gpu

# Watch CPU logs (for comparison)
modal logs --function gradevault-cv-worker
```

Look for:
- ✅ "CUDA available: True" in GPU logs
- ✅ Execution time improvements
- ✅ No errors or crashes
- ✅ Identical defect detection results

### 7. Measure Performance

Track key metrics:
- **Processing time**: GPU should be 3-5x faster
- **Error rate**: Should stay the same (or lower)
- **User satisfaction**: Shorter wait times = happier users
- **Cost**: GPU ~2.8x more, but worth it for UX

### 8. Full Switch to GPU (If Satisfied)

Once confident:

```bash
# Option A: Update environment variable
MODAL_USE_GPU=true

# Option B: Update API route to use GPU by default
# Change MODAL_CV_WEBHOOK_URL to GPU endpoint

# Redeploy Next.js
vercel --prod
```

### 9. Deprecate CPU Worker (Optional)

After GPU runs successfully for a week:

```bash
# Remove CPU deployment
modal app stop gradevault-cv-worker

# Or keep as fallback (recommended for 30 days)
```

---

## Step-by-Step: Direct Replacement

### 1. Backup Current Deployment Info

```bash
# Save current webhook URL
echo $MODAL_CV_WEBHOOK_URL > cpu_webhook_backup.txt

# Test CPU one last time
modal run cv_worker.py --video-url "..." --scan-id "final-cpu-test"
```

### 2. Deploy GPU Worker (Same Name)

Edit `cv_worker_gpu.py` to use same app name:

```python
# Change this line:
app = modal.App("gradevault-cv-worker-gpu")

# To this:
app = modal.App("gradevault-cv-worker")  # Same name = replaces CPU
```

Then deploy:

```bash
modal deploy cv_worker_gpu.py
```

This **replaces** the CPU worker with GPU version.

### 3. Verify GPU Active

```bash
# Check deployment
modal app list

# Should show gradevault-cv-worker (now GPU-powered)

# Test it
modal run cv_worker_gpu.py --video-url "..." --scan-id "gpu-live-test"
```

### 4. No Code Changes Needed

If you kept the same app name, webhook URL stays the same. Next.js continues working without changes.

### 5. Monitor Production

```bash
modal logs --function gradevault-cv-worker
```

Watch for first few production scans. Verify:
- CUDA available: True
- Processing time 3-5x faster
- No errors

---

## Rollback Plan

### If GPU Has Issues:

#### Side-by-Side Deployment:
```bash
# Just switch back to CPU endpoint
MODAL_USE_GPU=false  # In .env.local
vercel --prod
```

CPU worker still running, instant rollback!

#### Direct Replacement:
```bash
# Redeploy CPU version
modal deploy cv_worker.py

# Overwrites GPU deployment, back to CPU
```

Takes ~2 minutes to redeploy.

---

## Cost Impact Monitoring

### Track Monthly Costs

```bash
# Check Modal dashboard
modal app stats gradevault-cv-worker-gpu

# Calculate daily cost
# Daily scans × $0.0020 per scan = Daily cost
```

Example:
- 10 scans/day × $0.0020 = $0.02/day = $0.60/month ✅ Negligible
- 100 scans/day × $0.0020 = $0.20/day = $6/month ✅ Worth it
- 1000 scans/day × $0.0020 = $2/day = $60/month 🤔 Consider hybrid

---

## Validation Checklist

Before switching production traffic to GPU:

- [ ] GPU worker deployed successfully
- [ ] Test video processed without errors
- [ ] "CUDA available: True" in logs
- [ ] Processing time is 3-5x faster than CPU
- [ ] Defect detection results match CPU (±0.0001)
- [ ] Golden frames are similar quality
- [ ] Supabase uploads working correctly
- [ ] Webhook endpoint responds correctly
- [ ] Cost impact calculated and acceptable
- [ ] Rollback plan tested

---

## Troubleshooting

### "CUDA available: False"

**Problem:** GPU not detected, falling back to CPU.

**Solution:** This is expected! The code includes automatic CPU fallback. Modal T4 GPUs always have CUDA. If you see this in local testing, it's fine (your laptop doesn't have a GPU).

### Processing Time Not Faster

**Problem:** GPU taking same time as CPU.

**Causes:**
1. Video I/O is bottleneck (large video download)
2. Supabase upload is bottleneck (many images)
3. Actually using CPU fallback (check logs)

**Solution:**
- Check for "CUDA available: True" in logs
- Test with locally cached video to isolate I/O
- Compare optical flow time specifically (should be 5x faster)

### Results Don't Match CPU

**Problem:** Defect detection differs from CPU version.

**Expected:** Floating-point precision differences (±0.0001) are normal.

**Unexpected:** If defect masks or region scores differ significantly, file an issue.

### High Costs

**Problem:** GPU costs higher than expected.

**Solutions:**
1. Implement hybrid routing (free users → CPU)
2. Cache results (don't reprocess same video)
3. Add rate limiting
4. Consider async processing (users don't wait)

---

## Performance Expectations

### Typical Video (600 frames, 20 seconds)

**Before (CPU):**
```
Frame Analysis: 40s
Golden Frame Extraction: 3s
Defect Detection: 5s
Upload: 2s
Total: 50s
```

**After (GPU):**
```
Frame Analysis: 8s   ⚡ 5x faster
Golden Frame Extraction: 3s
Defect Detection: 2s ⚡ 2.5x faster
Upload: 2s
Total: 15s          ⚡ 3.3x faster
```

### Edge Cases

**Very Short Video (<10 seconds):**
- GPU advantage minimal (I/O overhead dominates)
- Speedup: ~1.5x
- Stick with CPU for cost efficiency

**Very Long Video (>60 seconds):**
- GPU advantage maximized
- Speedup: ~4-5x
- GPU strongly recommended

---

## Success Metrics

Track these to measure migration success:

### Performance
- [ ] Average processing time reduced by 3x+
- [ ] 99th percentile latency under 30 seconds
- [ ] Zero increase in error rate

### User Experience
- [ ] Reduced "Analyzing..." wait time
- [ ] Lower abandonment rate during analysis
- [ ] Positive user feedback on speed

### Cost
- [ ] Cost increase acceptable for traffic level
- [ ] Cost per user under target threshold
- [ ] ROI positive (faster UX = better retention)

---

## FAQ

**Q: Can I run both CPU and GPU long-term?**  
A: Yes! Keep both deployed, route based on user tier or load. This is actually the recommended production setup.

**Q: Will GPU work on my local machine for testing?**  
A: Code will run, but use CPU fallback (unless you have NVIDIA GPU + CUDA). Test GPU features on Modal directly.

**Q: How do I debug GPU issues?**  
A: Check `modal logs --function` for CUDA messages. The code logs "CUDA available: True/False" at start.

**Q: Is there a GPU warmup time?**  
A: Modal handles cold starts (~2-3 seconds). Once warm, GPU starts immediately. Similar to CPU cold start time.

**Q: Can I use multiple GPUs per video?**  
A: Not needed - single T4 is plenty fast. Modal's `.map()` already parallelizes across multiple GPU instances for multiple videos.

---

## Getting Help

**Issues?**
1. Check logs: `modal logs --function gradevault-cv-worker-gpu`
2. Compare with CPU: `./benchmark_gpu_vs_cpu.sh`
3. Review guide: `GPU_ACCELERATION_GUIDE.md`
4. File issue with logs attached

**Questions?**
- See `GPU_QUICK_REFERENCE.txt` for common scenarios
- Check Modal docs: https://modal.com/docs
- OpenCV CUDA: https://docs.opencv.org/master/d2/d75/namespacecv_1_1cuda.html

---

## Timeline Recommendation

**Week 1: Testing**
- Deploy GPU worker (side-by-side)
- Test with sample videos
- Validate results match CPU
- Benchmark performance

**Week 2: Canary**
- Route 10% of traffic to GPU
- Monitor for errors
- Compare performance metrics
- Adjust if needed

**Week 3: Ramp Up**
- Increase to 50% GPU
- Monitor costs
- Gather user feedback
- Fine-tune if needed

**Week 4: Full Switch**
- Route 100% to GPU
- Keep CPU as fallback (30 days)
- Monitor costs stabilize
- Celebrate faster processing! 🎉

**Week 8: Cleanup**
- Optionally remove CPU worker
- Or keep for cost-sensitive tier
- Document final architecture

---

**Good luck with your migration! GPU acceleration will significantly improve your user experience.** 🚀

