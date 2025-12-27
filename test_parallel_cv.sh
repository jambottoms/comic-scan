#!/bin/bash
# Test script for parallel CV worker

echo "=================================="
echo "Testing Parallel CV Worker"
echo "=================================="
echo ""

# Check if modal is available
if ! command -v modal &> /dev/null; then
    echo "⚠️  Modal CLI not found. Using venv..."
    MODAL_CMD="./venv/bin/modal"
else
    MODAL_CMD="modal"
fi

# Check deployment
echo "1. Checking Modal deployment..."
echo ""
$MODAL_CMD app list | grep gradevault-cv-worker
echo ""

# Get webhook URL
echo "2. Webhook URL:"
echo "https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run"
echo ""

# Check environment variable
echo "3. Checking environment variable..."
if [ -f .env.local ]; then
    if grep -q "MODAL_CV_WEBHOOK_URL" .env.local; then
        echo "✅ MODAL_CV_WEBHOOK_URL found in .env.local"
        grep "MODAL_CV_WEBHOOK_URL" .env.local
    else
        echo "❌ MODAL_CV_WEBHOOK_URL not found in .env.local"
        echo ""
        echo "Add this to .env.local:"
        echo "MODAL_CV_WEBHOOK_URL=https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run"
    fi
else
    echo "⚠️  .env.local not found"
    echo ""
    echo "Create .env.local with:"
    echo "MODAL_CV_WEBHOOK_URL=https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run"
fi
echo ""

# Test webhook (requires video URL)
echo "4. To test the webhook:"
echo ""
echo "curl -X POST https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"videoUrl\": \"YOUR_VIDEO_URL\","
echo "    \"scanId\": \"test-parallel-001\","
echo "    \"itemType\": \"card\""
echo "  }'"
echo ""

echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Ensure MODAL_CV_WEBHOOK_URL is set in .env.local"
echo "2. Restart your Next.js dev server: npm run dev"
echo "3. Upload a video and watch for parallel processing logs"
echo "4. View real-time logs: https://modal.com/apps/jambottoms/main/deployed/gradevault-cv-worker"
echo ""

