'use server';

/**
 * Extract regions from static photos and train Nyckel classifier
 * 
 * This processes high-quality static photos (front/spine) and automatically
 * extracts region crops for better training data.
 */

import { createServerClient } from '@/lib/supabase/server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const NYCKEL_CLIENT_ID = process.env.NYCKEL_CLIENT_ID;
const NYCKEL_CLIENT_SECRET = process.env.NYCKEL_CLIENT_SECRET;
const NYCKEL_REGION_FUNCTION_ID = process.env.NYCKEL_REGION_FUNCTION_ID;

// Region definitions (same as cv_worker.py)
const REGIONS = {
  spine: { x_start: 0.0, x_end: 0.08, y_start: 0.0, y_end: 1.0 },
  corner_tl: { x_start: 0.0, x_end: 0.15, y_start: 0.0, y_end: 0.12 },
  corner_tr: { x_start: 0.85, x_end: 1.0, y_start: 0.0, y_end: 0.12 },
  corner_bl: { x_start: 0.0, x_end: 0.15, y_start: 0.88, y_end: 1.0 },
  corner_br: { x_start: 0.85, x_end: 1.0, y_start: 0.88, y_end: 1.0 },
  surface: { x_start: 0.20, x_end: 0.80, y_start: 0.20, y_end: 0.80 }
};

async function getNyckelToken() {
  const response = await fetch('https://www.nyckel.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: NYCKEL_CLIENT_ID!,
      client_secret: NYCKEL_CLIENT_SECRET!,
    }),
  });

  if (!response.ok) throw new Error('Failed to get Nyckel token');
  const data = await response.json();
  return data.access_token;
}

/**
 * Detect comic boundaries using simple edge detection (Node.js version)
 */
async function detectComicBoundaries(imageBuffer: Buffer): Promise<{ x: number; y: number; width: number; height: number } | null> {
  // This would ideally use a Node.js image processing library like sharp or jimp
  // For now, we'll return null and use the full image
  // TODO: Implement edge detection in Node.js
  return null;
}

/**
 * Extract a region crop from an image buffer
 */
async function extractRegionCrop(
  imageBuffer: Buffer,
  regionDef: { x_start: number; x_end: number; y_start: number; y_end: number },
  comicBbox: { x: number; y: number; width: number; height: number } | null
): Promise<Buffer> {
  const sharp = require('sharp');
  
  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;
  
  // If comic detected, use those bounds, otherwise use full image
  const workingX = comicBbox?.x || 0;
  const workingY = comicBbox?.y || 0;
  const workingWidth = comicBbox?.width || imgWidth;
  const workingHeight = comicBbox?.height || imgHeight;
  
  // Calculate region crop coordinates
  const x1 = Math.floor(workingX + workingWidth * regionDef.x_start);
  const x2 = Math.floor(workingX + workingWidth * regionDef.x_end);
  const y1 = Math.floor(workingY + workingHeight * regionDef.y_start);
  const y2 = Math.floor(workingY + workingHeight * regionDef.y_end);
  
  const cropWidth = x2 - x1;
  const cropHeight = y2 - y1;
  
  // Extract crop
  const croppedBuffer = await sharp(imageBuffer)
    .extract({ left: x1, top: y1, width: cropWidth, height: cropHeight })
    .toBuffer();
  
  return croppedBuffer;
}

/**
 * Train Nyckel with region crops extracted from a static photo
 */
export async function trainFromStaticPhoto(
  photoUrl: string,
  photoType: 'front' | 'back' | 'spine',
  regionLabels: Record<string, string> // e.g., { "spine": "heavy_wear", "corner_tl": "near_mint" }
): Promise<{ success: boolean; error?: string; trainedRegions?: string[] }> {
  try {
    if (!NYCKEL_CLIENT_ID || !NYCKEL_CLIENT_SECRET || !NYCKEL_REGION_FUNCTION_ID) {
      return { success: false, error: 'Nyckel credentials not configured' };
    }

    // Download the photo
    const photoResponse = await fetch(photoUrl);
    if (!photoResponse.ok) {
      return { success: false, error: 'Failed to download photo' };
    }
    const imageBuffer = Buffer.from(await photoResponse.arrayBuffer());

    // Detect comic boundaries (optional, for better accuracy)
    const comicBbox = await detectComicBoundaries(imageBuffer);

    // Get Nyckel token
    const accessToken = await getNyckelToken();

    // Determine which regions to extract based on photo type
    let regionsToExtract: string[] = [];
    if (photoType === 'spine') {
      regionsToExtract = ['spine'];
    } else if (photoType === 'front') {
      regionsToExtract = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'surface'];
    } else if (photoType === 'back') {
      regionsToExtract = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br'];
    }

    const trainedRegions: string[] = [];

    // Extract and upload each region
    for (const regionName of regionsToExtract) {
      const label = regionLabels[regionName];
      if (!label) continue; // Skip if no label provided for this region

      const regionDef = REGIONS[regionName as keyof typeof REGIONS];
      if (!regionDef) continue;

      try {
        // Extract region crop
        const cropBuffer = await extractRegionCrop(imageBuffer, regionDef, comicBbox);

        // Convert to base64 for Nyckel
        const base64 = cropBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        // Upload to Nyckel
        const nyckelResponse = await fetch(
          `https://www.nyckel.com/v1/functions/${NYCKEL_REGION_FUNCTION_ID}/samples`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              data: dataUrl,
              annotation: { labelName: label },
            }),
          }
        );

        if (!nyckelResponse.ok) {
          console.error(`Failed to train region ${regionName}: ${await nyckelResponse.text()}`);
          continue;
        }

        trainedRegions.push(regionName);
        console.log(`✅ Trained ${regionName} with label ${label}`);
      } catch (regionError) {
        console.error(`Error processing region ${regionName}:`, regionError);
      }
    }

    return { 
      success: trainedRegions.length > 0, 
      trainedRegions,
      error: trainedRegions.length === 0 ? 'No regions were successfully trained' : undefined
    };
  } catch (error) {
    console.error('[trainFromStaticPhoto] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

