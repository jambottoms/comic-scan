/**
 * Google File API utilities
 * Uploads normalized video files to Google File API for Gemini analysis
 */

import { GoogleAIFileManager } from '@google/generative-ai/server';

/**
 * Upload a file from disk to Google File API using SDK fileManager
 * This is the recommended approach for serverless environments like Vercel
 * The SDK fileManager.uploadFile doesn't support streams, so we save to /tmp first
 * 
 * @param filePath - Path to the file on disk (e.g., /tmp/video.mp4)
 * @param apiKey - Google API key
 * @param mimeType - MIME type (explicitly set to video/mp4)
 */
export async function uploadFileToGoogleFileAPI(
  filePath: string,
  apiKey: string,
  mimeType: string = 'video/mp4'
): Promise<string> {
  console.log(`[Google File API] Uploading file from path: ${filePath} (mimeType: ${mimeType})`);
  
  const fileManager = new GoogleAIFileManager(apiKey);
  
  try {
    // Upload file using SDK fileManager.uploadFile
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType: mimeType, // Explicitly set to video/mp4
      displayName: 'Normalized_Comic_Video',
    });
    
    const fileUri = uploadResult.file.uri;
    console.log(`[Google File API] File uploaded: ${fileUri}`);
    
    // Poll for file to be ready (ACTIVE state)
    const maxAttempts = 30; // 30 attempts = 15 seconds max
    const pollInterval = 500; // 500ms between polls
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const file = await fileManager.getFile(fileUri);
      
      if (file.state === 'ACTIVE') {
        console.log(`[Google File API] File is ready after ${attempt + 1} attempts`);
        return fileUri;
      }
      
      if (file.state === 'FAILED') {
        const errorMsg = file.error?.message || 'Unknown error';
        throw new Error(`File upload failed: ${errorMsg}`);
      }
      
      // Wait before next poll
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    throw new Error('File upload timed out - file did not become ACTIVE within 15 seconds');
  } catch (error) {
    console.error(`[Google File API] Upload error:`, error);
    throw error;
  }
}

