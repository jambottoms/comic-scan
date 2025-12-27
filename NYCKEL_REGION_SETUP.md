# Nyckel Region Detection Setup Guide

## Overview

This guide explains how to set up the Region Detection function in Nyckel, which trains the AI to locate key areas on comic books (spine, corners, staples). This is separate from the Defect Detection function.

## Purpose

The Region Detection model helps the CV system:
- Identify where the spine is located
- Find staple positions (top and bottom staples in the spine)
- Detect all four corners accurately

This improves the overall grading accuracy by ensuring defect detection focuses on the right areas.

## Setup Instructions

### 1. Create New Nyckel Function

1. Log in to your [Nyckel Dashboard](https://www.nyckel.com)
2. Click **"Create New Function"**
3. Select **"Image Classification"**
4. Name it: **"Comic Region Detection"**
5. Click **"Create"**

### 2. Add Region Labels

Add the following 7 labels to your function (use exact names):

1. **Spine**
2. **Top Staple**
3. **Bottom Staple**
4. **Top Left Corner**
5. **Top Right Corner**
6. **Bottom Left Corner**
7. **Bottom Right Corner**

### 3. Get Function ID

1. In your Nyckel function dashboard, find the **Function ID**
2. It looks like: `function_xxxxxxxxxx`
3. Copy this ID

### 4. Configure Environment Variables

#### Local Development (`.env.local`)

Add to your `.env.local` file:

```bash
NYCKEL_REGION_FUNCTION_ID=function_xxxxxxxxxx
```

Replace `function_xxxxxxxxxx` with your actual Function ID.

#### Production (Vercel)

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add new variable:
   - **Name**: `NYCKEL_REGION_FUNCTION_ID`
   - **Value**: `function_xxxxxxxxxx` (your Function ID)
   - **Environments**: Select all (Production, Preview, Development)
4. Click **Save**

### 5. Redeploy

After adding the environment variable in Vercel:
- Vercel will automatically redeploy on your next git push
- Or manually trigger a redeploy from the Vercel dashboard

## Using the Region Training Feature

### In the App

1. Tap the **Train AI** button (FAB menu)
2. Choose **"Train Region Detection"** (green card)
3. Take a photo of the comic area you want to label
4. Crop the specific region (spine, corner, or staple)
5. Select the appropriate label
6. Submit

### Best Practices for Training

#### Spine Training
- Capture the full spine from top to bottom
- Include the staple area
- Take photos from different angles
- Include both clean and damaged spines

#### Corner Training
- Zoom in on just the corner area
- Include a small margin around the corner
- Train on all 4 corners separately
- Include various corner conditions (sharp, blunted, creased)

#### Staple Training
- Focus on individual staples in the spine
- Capture top and bottom staples separately
- Comics have 2 staples (top and bottom)
- Include different lighting conditions
- Include both rusty and clean staples
- Train on staples that are visible and tight vs. loose

### Training Data Guidelines

- **Minimum samples**: 10-20 per label to start
- **Variety**: Include different comic types, colors, conditions
- **Consistency**: Crop similar areas for each label type
- **Quality**: Use clear, well-lit photos

## Architecture

The app now supports two separate Nyckel functions:

```
Training Workflow
├── Defect Detection (existing)
│   ├── Purpose: Identify types of damage
│   └── Labels: Spine Tick, Color Break, Corner Crease, etc.
│
└── Region Detection (new)
    ├── Purpose: Locate key areas
    └── Labels: Spine, Corners (4), Staples (2)
```

Both functions use the same Nyckel credentials (`NYCKEL_CLIENT_ID` and `NYCKEL_CLIENT_SECRET`) but different Function IDs.

## Troubleshooting

### "Nyckel region credentials missing" Error

**Cause**: The `NYCKEL_REGION_FUNCTION_ID` environment variable is not set.

**Solution**:
1. Verify you added the variable to `.env.local` (local) or Vercel (production)
2. Restart your dev server if running locally
3. Redeploy on Vercel if in production

### "A label with name 'X' was not found" Error

**Cause**: The label name in the app doesn't match the label in your Nyckel function.

**Solution**:
1. Check your Nyckel function labels match exactly:
   - Spine
   - Top Staple
   - Bottom Staple
   - Top Left Corner
   - Top Right Corner
   - Bottom Left Corner
   - Bottom Right Corner
2. Labels are case-sensitive

### Training Samples Not Improving Model

**Cause**: Not enough training data or low-quality samples.

**Solution**:
1. Add more samples (aim for 20+ per label)
2. Ensure good photo quality and consistent cropping
3. Include variety in lighting and comic conditions
4. Wait for Nyckel to retrain (can take a few minutes)

## Next Steps

After setting up and training the region detection model:

1. **Train the Model**: Add at least 10-20 samples per region type
2. **Test**: Use your CV worker to see if region detection improves
3. **Iterate**: Add more samples for regions that aren't detected well
4. **Monitor**: Check the Nyckel dashboard for model accuracy metrics

## Related Files

- [`app/actions/train-region.ts`](app/actions/train-region.ts) - Server action for region training
- [`components/TrainingModal.tsx`](components/TrainingModal.tsx) - UI for training workflow
- [`app/actions/train-defect.ts`](app/actions/train-defect.ts) - Server action for defect training

## Support

For issues with Nyckel:
- [Nyckel Documentation](https://www.nyckel.com/docs)
- [Nyckel Support](https://www.nyckel.com/support)

For issues with this app:
- Check the server logs for detailed error messages
- Verify all environment variables are set correctly
- Ensure Supabase storage bucket `training-data` exists and has proper permissions

