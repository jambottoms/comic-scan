#!/bin/bash

# Setup Vercel Environment Variables
# This script helps you configure MODAL_CV_WEBHOOK_URL in Vercel

set -e

echo "🚀 Vercel Environment Setup for Phase 2 CV Analysis"
echo "=================================================="
echo ""

MODAL_WEBHOOK_URL="https://jambottoms--gradevault-cv-worker-trigger-analysis.modal.run"

# Check if vercel is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx not found. Please install Node.js first."
    exit 1
fi

echo "Step 1: Linking to Vercel project..."
echo "-------------------------------------"
echo "When prompted:"
echo "  1. 'Set up and deploy?' → Type N (No)"
echo "  2. 'Which scope?' → Select your username/team"
echo "  3. 'Link to existing project?' → Type Y (Yes)"
echo "  4. 'Project name?' → Type: comic-scan"
echo ""
read -p "Press Enter to continue..."

npx vercel link

echo ""
echo "✅ Project linked!"
echo ""

echo "Step 2: Adding MODAL_CV_WEBHOOK_URL environment variable..."
echo "------------------------------------------------------------"
echo ""
echo "For PRODUCTION environment:"
echo "When prompted, paste this value:"
echo "$MODAL_WEBHOOK_URL"
echo ""
read -p "Press Enter to add production environment variable..."

echo "$MODAL_WEBHOOK_URL" | npx vercel env add MODAL_CV_WEBHOOK_URL production

echo ""
echo "For PREVIEW environment:"
read -p "Press Enter to add preview environment variable..."

echo "$MODAL_WEBHOOK_URL" | npx vercel env add MODAL_CV_WEBHOOK_URL preview

echo ""
echo "For DEVELOPMENT environment:"
read -p "Press Enter to add development environment variable..."

echo "$MODAL_WEBHOOK_URL" | npx vercel env add MODAL_CV_WEBHOOK_URL development

echo ""
echo "✅ All environment variables set!"
echo ""

echo "Step 3: Verifying environment variables..."
echo "-------------------------------------------"
npx vercel env ls

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Go to: https://vercel.com/[your-username]/comic-scan/deployments"
echo "2. Click '...' on the latest deployment"
echo "3. Click 'Redeploy'"
echo "4. Wait 1-2 minutes for deployment"
echo "5. Test Phase 2 on your iPhone"
echo ""
echo "Expected behavior:"
echo "  - CV Analysis Card shows 'Status: cv_processing'"
echo "  - Progress updates from 0% → 100% within 30-60 seconds"
echo ""

