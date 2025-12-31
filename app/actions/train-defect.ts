'use server';

import { createServerClient } from '@/lib/supabase/server';

const NYCKEL_FUNCTION_ID = process.env.NYCKEL_DEFECT_FUNCTION_ID;
const NYCKEL_CLIENT_ID = process.env.NYCKEL_CLIENT_ID;
const NYCKEL_CLIENT_SECRET = process.env.NYCKEL_CLIENT_SECRET;

async function getNyckelToken() {
  const tokenRes = await fetch('https://www.nyckel.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: NYCKEL_CLIENT_ID!,
      client_secret: NYCKEL_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });
  const data = await tokenRes.json();
  return data.access_token;
}

export async function trainDefect(
  imageUrl: string, 
  label: string,
  metadata?: {
    imagePath?: string;
    sourceScanId?: string;
    cropData?: any;
  }
) {
  const supabase = createServerClient();
  let nyckelSampleId: string | null = null;
  let nyckelStatus = 'error';
  
  try {
    // Debug logging
    console.log("[TrainDefect] Environment Check:", {
      hasFunctionId: !!NYCKEL_FUNCTION_ID,
      hasClientId: !!NYCKEL_CLIENT_ID,
      hasClientSecret: !!NYCKEL_CLIENT_SECRET,
      functionIdStart: NYCKEL_FUNCTION_ID ? NYCKEL_FUNCTION_ID.substring(0, 4) : 'null'
    });

    if (!NYCKEL_FUNCTION_ID || !NYCKEL_CLIENT_ID) {
      throw new Error("Nyckel credentials missing - check server logs for details");
    }

    // 1. Get Token
    const accessToken = await getNyckelToken();

    // 2. Send to Nyckel
    const response = await fetch(
      `https://www.nyckel.com/v1/functions/${NYCKEL_FUNCTION_ID}/samples`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: imageUrl,
          annotation: { labelName: label },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Nyckel Error: ${errorText}`);
    }

    const nyckelResult = await response.json();
    nyckelSampleId = nyckelResult.id || null;
    nyckelStatus = 'accepted';

    // 3. Save to Supabase training_samples table
    try {
      const { error: dbError } = await supabase
        .from('training_samples')
        .insert({
          image_url: imageUrl,
          image_path: metadata?.imagePath || imageUrl,
          label: label,
          label_type: 'defect',
          nyckel_function_id: NYCKEL_FUNCTION_ID,
          nyckel_sample_id: nyckelSampleId,
          nyckel_status: nyckelStatus,
          source_scan_id: metadata?.sourceScanId || null,
          crop_data: metadata?.cropData || null,
        });

      if (dbError) {
        console.error('[TrainDefect] Failed to save to training_samples:', dbError);
        // Don't fail the whole operation if DB save fails
      } else {
        console.log('[TrainDefect] ✅ Saved to training_samples table');
      }
    } catch (dbError) {
      console.error('[TrainDefect] DB save error:', dbError);
    }

    return { success: true, sampleId: nyckelSampleId };
  } catch (error) {
    console.error("Training Error:", error);
    
    // Still try to save to DB even on Nyckel failure (for debugging)
    try {
      await supabase
        .from('training_samples')
        .insert({
          image_url: imageUrl,
          image_path: metadata?.imagePath || imageUrl,
          label: label,
          label_type: 'defect',
          nyckel_function_id: NYCKEL_FUNCTION_ID || '',
          nyckel_sample_id: null,
          nyckel_status: 'error',
          source_scan_id: metadata?.sourceScanId || null,
          crop_data: metadata?.cropData || null,
        });
    } catch (dbError) {
      console.error('[TrainDefect] Failed to save error to DB:', dbError);
    }
    
    return { success: false, error: (error as Error).message };
  }
}
