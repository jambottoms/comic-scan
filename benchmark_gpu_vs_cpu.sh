#!/bin/bash
# GPU vs CPU Benchmark Script
# Compares performance and cost of GPU vs CPU Modal workers

echo "=================================================="
echo "GradeVault CV Worker - GPU vs CPU Benchmark"
echo "=================================================="
echo ""

# Check if video URL provided
if [ -z "$1" ]; then
    echo "Usage: ./benchmark_gpu_vs_cpu.sh <video_url> [scan_id]"
    echo ""
    echo "Example:"
    echo "  ./benchmark_gpu_vs_cpu.sh https://storage.supabase.co/.../video.mp4 test-123"
    exit 1
fi

VIDEO_URL="$1"
SCAN_ID="${2:-benchmark-$(date +%s)}"

echo "📹 Video URL: $VIDEO_URL"
echo "🔖 Scan ID: $SCAN_ID"
echo ""

# Create output directory
mkdir -p benchmark_results

# Benchmark CPU version
echo "=================================================="
echo "🖥️  Testing CPU Version"
echo "=================================================="
echo ""

CPU_START=$(date +%s)
modal run cv_worker.py --video-url "$VIDEO_URL" --scan-id "${SCAN_ID}-cpu" 2>&1 | tee "benchmark_results/cpu_output.txt"
CPU_END=$(date +%s)
CPU_TIME=$((CPU_END - CPU_START))

echo ""
echo "✅ CPU completed in ${CPU_TIME}s"
echo ""
sleep 5

# Benchmark GPU version
echo "=================================================="
echo "🎮 Testing GPU Version"
echo "=================================================="
echo ""

GPU_START=$(date +%s)
modal run cv_worker_gpu.py --video-url "$VIDEO_URL" --scan-id "${SCAN_ID}-gpu" 2>&1 | tee "benchmark_results/gpu_output.txt"
GPU_END=$(date +%s)
GPU_TIME=$((GPU_END - GPU_START))

echo ""
echo "✅ GPU completed in ${GPU_TIME}s"
echo ""

# Calculate speedup
SPEEDUP=$(echo "scale=2; $CPU_TIME / $GPU_TIME" | bc)

# Calculate costs (approximate)
# CPU: $0.05/hour = $0.0000139/second
# GPU: $0.50/hour = $0.0001389/second
CPU_COST=$(echo "scale=4; $CPU_TIME * 0.0000139" | bc)
GPU_COST=$(echo "scale=4; $GPU_TIME * 0.0001389" | bc)
COST_RATIO=$(echo "scale=2; $GPU_COST / $CPU_COST" | bc)

# Results
echo "=================================================="
echo "📊 BENCHMARK RESULTS"
echo "=================================================="
echo ""
echo "Execution Time:"
echo "  CPU: ${CPU_TIME}s"
echo "  GPU: ${GPU_TIME}s"
echo "  Speedup: ${SPEEDUP}x faster"
echo ""
echo "Estimated Cost:"
echo "  CPU: \$${CPU_COST}"
echo "  GPU: \$${GPU_COST}"
echo "  Cost Ratio: ${COST_RATIO}x more expensive"
echo ""
echo "Cost per Second Saved:"
TIME_SAVED=$((CPU_TIME - GPU_TIME))
EXTRA_COST=$(echo "scale=4; $GPU_COST - $CPU_COST" | bc)
COST_PER_SECOND=$(echo "scale=4; $EXTRA_COST / $TIME_SAVED" | bc)
echo "  Time saved: ${TIME_SAVED}s"
echo "  Extra cost: \$${EXTRA_COST}"
echo "  Cost per second saved: \$${COST_PER_SECOND}"
echo ""

# Recommendation
if (( $(echo "$SPEEDUP > 3" | bc -l) )); then
    echo "💡 RECOMMENDATION: GPU is ${SPEEDUP}x faster!"
    echo "   Worth the extra cost for better UX."
elif (( $(echo "$SPEEDUP > 2" | bc -l) )); then
    echo "💡 RECOMMENDATION: GPU is ${SPEEDUP}x faster."
    echo "   Consider for production if users wait for results."
else
    echo "💡 RECOMMENDATION: GPU speedup (${SPEEDUP}x) not significant."
    echo "   Stick with CPU for cost efficiency."
fi
echo ""

# Check if outputs match
echo "=================================================="
echo "🔍 Validating Results Match"
echo "=================================================="
echo ""

# Extract key metrics from logs
CPU_FRAMES=$(grep "Analyzed ALL" benchmark_results/cpu_output.txt | grep -oE "[0-9]+ frames" | grep -oE "[0-9]+")
GPU_FRAMES=$(grep "Analyzed ALL" benchmark_results/gpu_output.txt | grep -oE "[0-9]+ frames" | grep -oE "[0-9]+")

CPU_STABLE=$(grep "stable frames" benchmark_results/cpu_output.txt | head -1 | grep -oE "[0-9]+ stable" | grep -oE "[0-9]+")
GPU_STABLE=$(grep "stable frames" benchmark_results/gpu_output.txt | head -1 | grep -oE "[0-9]+ stable" | grep -oE "[0-9]+")

echo "Frames analyzed:"
echo "  CPU: $CPU_FRAMES frames"
echo "  GPU: $GPU_FRAMES frames"
echo "  Match: $([ "$CPU_FRAMES" = "$GPU_FRAMES" ] && echo "✅ Yes" || echo "❌ No")"
echo ""

echo "Stable frames found:"
echo "  CPU: $CPU_STABLE frames"
echo "  GPU: $GPU_STABLE frames"
echo "  Match: $([ "$CPU_STABLE" = "$GPU_STABLE" ] && echo "✅ Yes" || echo "❌ No")"
echo ""

# Save summary
cat > benchmark_results/summary.json << EOF
{
  "video_url": "$VIDEO_URL",
  "scan_id": "$SCAN_ID",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "cpu": {
    "execution_time_seconds": $CPU_TIME,
    "estimated_cost_usd": $CPU_COST,
    "frames_analyzed": $CPU_FRAMES,
    "stable_frames": $CPU_STABLE
  },
  "gpu": {
    "execution_time_seconds": $GPU_TIME,
    "estimated_cost_usd": $GPU_COST,
    "frames_analyzed": $GPU_FRAMES,
    "stable_frames": $GPU_STABLE
  },
  "comparison": {
    "speedup_factor": $SPEEDUP,
    "cost_ratio": $COST_RATIO,
    "time_saved_seconds": $TIME_SAVED,
    "extra_cost_usd": $EXTRA_COST,
    "cost_per_second_saved_usd": $COST_PER_SECOND
  }
}
EOF

echo "💾 Full results saved to:"
echo "   - benchmark_results/cpu_output.txt"
echo "   - benchmark_results/gpu_output.txt"
echo "   - benchmark_results/summary.json"
echo ""

echo "=================================================="
echo "✨ Benchmark Complete!"
echo "=================================================="

