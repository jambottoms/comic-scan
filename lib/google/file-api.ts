/**
 * Google File API utilities
 * Uploads large videos to Google File API to avoid token limits when sending to Gemini
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Readable } from 'stream';

interface GoogleFileUploadResponse {
  file: {
    uri: string;
    mimeType: string;
    displayName?: string;
  };
}

interface GoogleFileStateResponse {
  state: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED';
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Upload a video file to Google File API
 * Returns the file URI that can be used in Gemini requests
 * 
 * Google File API expects multipart/form-data with:
 * - metadata: JSON string with file metadata
 * - file: The actual file binary
 */
export async function uploadToGoogleFileAPI(
  file: File | Blob,
  apiKey: string
): Promise<string> {
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
  
  // Create form data (Node.js 18+ has native FormData support)
  const formData = new FormData();
  
  // Metadata must be a JSON string
  // HARDCODE mimeType to video/mp4 - we normalized it on the client side
  const metadata = {
    file: {
      displayName: file instanceof File ? file.name : 'comic-video.mp4',
      mimeType: 'video/mp4', // HARDCODE - always MP4 after client normalization
    },
  };
  
  // Append metadata as a JSON string (not a Blob)
  formData.append('metadata', JSON.stringify(metadata));
  
  // Append the file (already normalized to MP4 on client)
  formData.append('file', file);

  // Upload file
  console.log(`[Google File API] Starting upload... (file size: ${file.size} bytes, type: ${file instanceof File ? file.type : 'Blob'})`);
  
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type header - let fetch set it with boundary
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error(`[Google File API] Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    console.error(`[Google File API] Error response: ${errorText}`);
    throw new Error(`Failed to upload to Google File API: ${uploadResponse.status} ${uploadResponse.statusText}. ${errorText}`);
  }

  const uploadData = await uploadResponse.json() as GoogleFileUploadResponse;
  const fileUri = uploadData.file.uri;

  if (!fileUri) {
    throw new Error('No file URI returned from Google File API');
  }

  console.log(`[Google File API] File uploaded: ${fileUri}`);

  // Poll for file to be ready (ACTIVE state)
  const maxAttempts = 30; // 30 attempts = 15 seconds max
  const pollInterval = 500; // 500ms between polls

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stateUrl = `https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${apiKey}`;
    const stateResponse = await fetch(stateUrl);

    if (!stateResponse.ok) {
      throw new Error(`Failed to check file state: ${stateResponse.status} ${stateResponse.statusText}`);
    }

    const stateData = await stateResponse.json() as GoogleFileStateResponse;

    if (stateData.state === 'ACTIVE') {
      console.log(`[Google File API] File is ready after ${attempt + 1} attempts`);
      return fileUri;
    }

    if (stateData.state === 'FAILED') {
      const errorMsg = stateData.error?.message || 'Unknown error';
      throw new Error(`File upload failed: ${errorMsg}`);
    }

    // Wait before next poll
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('File upload timed out - file did not become ACTIVE within 15 seconds');
}

/**
 * Upload a video stream to Google File API
 * Converts the stream to a Blob and uploads it
 * 
 * @param stream - Readable stream of video data
 * @param apiKey - Google API key
 * @param mimeType - MIME type (explicitly set to video/mp4)
 */
export async function uploadStreamToGoogleFileAPI(
  stream: Readable,
  apiKey: string,
  mimeType: string = 'video/mp4'
): Promise<string> {
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
  
  // Convert stream to Buffer (needed for FormData)
  const chunks: Buffer[] = [];
  let totalSize = 0;
  let chunkCount = 0;
  
  console.log(`[Google File API] Reading stream into buffer...`);
  
  try {
    for await (const chunk of stream) {
      if (!chunk) {
        console.warn(`[Google File API] Received empty chunk`);
        continue;
      }
      
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      totalSize += buffer.length;
      chunkCount++;
      
      // Log progress every 5MB
      if (totalSize % (5 * 1024 * 1024) < buffer.length) {
        console.log(`[Google File API] Stream progress: ${(totalSize / 1024 / 1024).toFixed(2)}MB (${chunkCount} chunks)`);
      }
    }
  } catch (streamError) {
    console.error(`[Google File API] Error reading stream:`, streamError);
    throw new Error(`Failed to read video stream: ${streamError instanceof Error ? streamError.message : String(streamError)}`);
  }
  
  if (chunks.length === 0) {
    throw new Error('Stream produced no data - FFmpeg may have failed silently');
  }
  
  const buffer = Buffer.concat(chunks);
  const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
  console.log(`[Google File API] Stream read complete: ${fileSizeMB}MB (${chunkCount} chunks, ${buffer.length} bytes)`);
  
  if (buffer.length === 0) {
    throw new Error('Buffer is empty after reading stream');
  }
  
  // Create FormData
  const formData = new FormData();
  
  // Metadata with explicit mimeType
  const metadata = {
    file: {
      displayName: 'comic-video-normalized.mp4',
      mimeType: mimeType, // Explicitly set to video/mp4
    },
  };
  
  // Append metadata as JSON string
  formData.append('metadata', JSON.stringify(metadata));
  
  // Append file - try File object (Node.js 18+ supports File)
  const file = new File([buffer], 'comic-video-normalized.mp4', { 
    type: mimeType,
    lastModified: Date.now()
  });
  
  // Verify file was created
  if (file.size !== buffer.length) {
    throw new Error(`File size mismatch: buffer=${buffer.length}, file=${file.size}`);
  }
  
  formData.append('file', file);
  
  // Verify what we're sending
  console.log(`[Google File API] FormData prepared: metadata=${JSON.stringify(metadata)}, file name=${file.name}, size=${file.size} bytes, type=${file.type}`);
  
  // Upload file
  console.log(`[Google File API] Starting upload... (file size: ${buffer.length} bytes, mimeType: ${mimeType})`);
  
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type - let fetch set it with boundary for multipart/form-data
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error(`[Google File API] Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    console.error(`[Google File API] Error response: ${errorText}`);
    throw new Error(`Failed to upload to Google File API: ${uploadResponse.status} ${uploadResponse.statusText}. ${errorText}`);
  }

  const uploadData = await uploadResponse.json() as GoogleFileUploadResponse;
  const fileUri = uploadData.file.uri;

  if (!fileUri) {
    throw new Error('No file URI returned from Google File API');
  }

  console.log(`[Google File API] File uploaded: ${fileUri}`);

  // Poll for file to be ready (ACTIVE state)
  const maxAttempts = 30; // 30 attempts = 15 seconds max
  const pollInterval = 500; // 500ms between polls

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stateUrl = `https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${apiKey}`;
    const stateResponse = await fetch(stateUrl);

    if (!stateResponse.ok) {
      throw new Error(`Failed to check file state: ${stateResponse.status} ${stateResponse.statusText}`);
    }

    const stateData = await stateResponse.json() as GoogleFileStateResponse;

    if (stateData.state === 'ACTIVE') {
      console.log(`[Google File API] File is ready after ${attempt + 1} attempts`);
      return fileUri;
    }

    if (stateData.state === 'FAILED') {
      const errorMsg = stateData.error?.message || 'Unknown error';
      throw new Error(`File upload failed: ${errorMsg}`);
    }

    // Wait before next poll
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('File upload timed out - file did not become ACTIVE within 15 seconds');
}

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
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = genAI.getFileManager();
  
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

