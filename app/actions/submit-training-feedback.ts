'use server';

/**
 * Submit Training Feedback Server Action
 * 
 * Captures user feedback on grades and uses it to train Nyckel classifiers.
 * This creates a feedback loop that improves grading accuracy over time.
 * 
 * Use cases:
 * 1. User says grade is "too high" or "too low" - adjusts overall training
 * 2. User corrects a specific region grade - trains that region directly
 * 3. User confirms grade is accurate - reinforces current predictions
 */

import { createClient } from '@supabase/supabase-js';

// Types
export interface FeedbackInput {
  scanId: string;
  feedback: 'accurate' | 'too_high' | 'too_low';
  userCorrection?: {
    region?: string;
    correctGrade?: string;  // Grade label like "near_mint", "minor_wear"
    correctNumeric?: number; // Numeric grade 0.5-10.0
  };
  regionCropUrls?: Record<string, string>;
  originalGrade?: string;
  nyckelGrade?: number;
}

export interface FeedbackResult {
  success: boolean;
  message: string;
  trainingSamplesAdded?: number;
}

// Grade label mappings
const GRADE_TO_LABEL: Record<string, string> = {
  '10.0': 'pristine',
  '9.8': 'pristine',
  '9.6': 'pristine',
  '9.4': 'near_mint',
  '9.2': 'near_mint',
  '9.0': 'near_mint',
  '8.5': 'near_mint',
  '8.0': 'minor_wear',
  '7.5': 'minor_wear',
  '7.0': 'minor_wear',
  '6.5': 'moderate_wear',
  '6.0': 'moderate_wear',
  '5.5': 'moderate_wear',
  '5.0': 'moderate_wear',
  '4.5': 'heavy_wear',
  '4.0': 'heavy_wear',
  '3.5': 'heavy_wear',
  '3.0': 'damaged',
  '2.5': 'damaged',
  '2.0': 'damaged',
  '1.5': 'damaged',
  '1.0': 'damaged',
  '0.5': 'damaged',
};

// Convert numeric grade to label
function gradeToLabel(grade: number): string {
  // Round to nearest 0.5
  const rounded = Math.round(grade * 2) / 2;
  const key = rounded.toFixed(1);
  return GRADE_TO_LABEL[key] || 'moderate_wear';
}

// Adjust label based on feedback
function adjustLabel(currentLabel: string, feedback: 'too_high' | 'too_low'): string {
  const labels = ['pristine', 'near_mint', 'minor_wear', 'moderate_wear', 'heavy_wear', 'damaged'];
  const currentIndex = labels.indexOf(currentLabel);
  
  if (currentIndex === -1) return currentLabel;
  
  if (feedback === 'too_high') {
    // User says grade is too high, so condition is worse than predicted
    return labels[Math.min(currentIndex + 1, labels.length - 1)];
  } else {
    // User says grade is too low, so condition is better than predicted
    return labels[Math.max(currentIndex - 1, 0)];
  }
}

/**
 * Get Nyckel OAuth token
 */
async function getNyckelToken(): Promise<string | null> {
  const clientId = process.env.NYCKEL_CLIENT_ID;
  const clientSecret = process.env.NYCKEL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.warn('[Training] Nyckel credentials not configured');
    return null;
  }
  
  try {
    const response = await fetch('https://www.nyckel.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('[Training] Failed to get Nyckel token:', error);
    return null;
  }
}

/**
 * Add training sample to Nyckel
 */
async function addNyckelTrainingSample(
  token: string,
  functionId: string,
  imageUrl: string,
  label: string
): Promise<boolean> {
  try {
    // Download image and convert to base64
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.warn(`[Training] Failed to download image: ${imageUrl}`);
      return false;
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/png';
    
    // Add sample to Nyckel
    const response = await fetch(`https://www.nyckel.com/v1/functions/${functionId}/samples`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: `data:${mimeType};base64,${base64}`,
        annotation: { labelName: label },
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[Training] Failed to add sample: ${errorText}`);
      return false;
    }
    
    console.log(`[Training] Added sample: ${label} from ${imageUrl}`);
    return true;
  } catch (error) {
    console.error('[Training] Error adding training sample:', error);
    return false;
  }
}

/**
 * Store feedback in Supabase for analytics
 */
async function storeFeedbackInSupabase(input: FeedbackInput): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[Training] Supabase not configured, skipping feedback storage');
    return false;
  }
  
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error } = await supabase.from('training_feedback').insert({
      scan_id: input.scanId,
      feedback_type: input.feedback,
      original_grade: input.originalGrade,
      nyckel_grade: input.nyckelGrade,
      user_correction: input.userCorrection ? JSON.stringify(input.userCorrection) : null,
      created_at: new Date().toISOString(),
    });
    
    if (error) {
      console.warn('[Training] Failed to store feedback:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[Training] Error storing feedback:', error);
    return false;
  }
}

/**
 * Main feedback submission function
 */
export async function submitTrainingFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  console.log(`[Training] Received feedback for scan ${input.scanId}: ${input.feedback}`);
  
  // Store feedback in Supabase for analytics
  await storeFeedbackInSupabase(input);
  
  // If feedback is "accurate", no training needed
  if (input.feedback === 'accurate') {
    return {
      success: true,
      message: 'Thank you! Your confirmation helps improve our grading accuracy.',
      trainingSamplesAdded: 0,
    };
  }
  
  // Get Nyckel token for training
  const token = await getNyckelToken();
  if (!token) {
    return {
      success: false,
      message: 'Training feedback recorded but Nyckel training is not configured.',
      trainingSamplesAdded: 0,
    };
  }
  
  const functionId = process.env.NYCKEL_DEFECT_FUNCTION_ID;
  if (!functionId) {
    return {
      success: false,
      message: 'Nyckel function ID not configured.',
      trainingSamplesAdded: 0,
    };
  }
  
  let samplesAdded = 0;
  
  // If user provided a specific correction
  if (input.userCorrection?.correctGrade && input.userCorrection?.region && input.regionCropUrls) {
    const regionUrl = input.regionCropUrls[input.userCorrection.region];
    if (regionUrl) {
      const success = await addNyckelTrainingSample(
        token,
        functionId,
        regionUrl,
        input.userCorrection.correctGrade
      );
      if (success) samplesAdded++;
    }
  }
  
  // If user said "too_high" or "too_low", add training samples for all regions
  else if (input.regionCropUrls && Object.keys(input.regionCropUrls).length > 0) {
    // Determine the correction direction
    const originalLabel = input.nyckelGrade 
      ? gradeToLabel(input.nyckelGrade)
      : 'moderate_wear';
    
    const correctedLabel = adjustLabel(originalLabel, input.feedback);
    
    // Add training samples for each region
    for (const [region, cropUrl] of Object.entries(input.regionCropUrls)) {
      // Only add if we have a valid URL
      if (cropUrl && cropUrl.startsWith('http')) {
        const success = await addNyckelTrainingSample(
          token,
          functionId,
          cropUrl,
          correctedLabel
        );
        if (success) samplesAdded++;
      }
    }
  }
  
  return {
    success: samplesAdded > 0,
    message: samplesAdded > 0 
      ? `Thank you! Added ${samplesAdded} training sample(s) to improve future grading.`
      : 'Feedback recorded. No region images available for training.',
    trainingSamplesAdded: samplesAdded,
  };
}

/**
 * Submit correction for a specific region
 */
export async function submitRegionCorrection(
  scanId: string,
  region: string,
  currentLabel: string,
  correctLabel: string,
  cropUrl: string
): Promise<FeedbackResult> {
  console.log(`[Training] Region correction: ${region} ${currentLabel} → ${correctLabel}`);
  
  const token = await getNyckelToken();
  if (!token) {
    return {
      success: false,
      message: 'Nyckel training is not configured.',
      trainingSamplesAdded: 0,
    };
  }
  
  const functionId = process.env.NYCKEL_DEFECT_FUNCTION_ID;
  if (!functionId) {
    return {
      success: false,
      message: 'Nyckel function ID not configured.',
      trainingSamplesAdded: 0,
    };
  }
  
  const success = await addNyckelTrainingSample(token, functionId, cropUrl, correctLabel);
  
  // Store correction in Supabase
  await storeFeedbackInSupabase({
    scanId,
    feedback: currentLabel > correctLabel ? 'too_high' : 'too_low',
    userCorrection: {
      region,
      correctGrade: correctLabel,
    },
    regionCropUrls: { [region]: cropUrl },
  });
  
  return {
    success,
    message: success 
      ? `Training sample added: ${region} → ${correctLabel}`
      : 'Failed to add training sample.',
    trainingSamplesAdded: success ? 1 : 0,
  };
}



