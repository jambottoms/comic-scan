'use client';

import { createClient } from './client';

/**
 * Upload a file to Supabase Storage with progress tracking
 * Uses XMLHttpRequest to track upload progress
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function uploadToSupabaseWithProgress(
  originalFile: File,
  onProgress: (progress: number) => void,
  customFileName?: string,
  customContentType?: string
): Promise<string> {
  const supabase = createClient();
  
  if (!supabase) {
    throw new Error('Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.');
  }
  
  console.log(`[Supabase Upload] Original file: ${originalFile.name}, Size: ${originalFile.size}, Type: ${originalFile.type || '(empty)'}`);
  
  // Read file into memory (iOS fix)
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await readFileAsArrayBuffer(originalFile);
    console.log(`[Supabase Upload] File read into memory: ${arrayBuffer.byteLength} bytes`);
  } catch (error) {
    console.error(`[Supabase Upload] Failed to read file:`, error);
    throw new Error(`Failed to read file. This may be an iOS issue. Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Determine content type - use custom if provided, otherwise original, otherwise default to video/mp4 for legacy compatibility
  const contentType = customContentType || originalFile.type || 'video/mp4';
  
  const blob = new Blob([arrayBuffer], { type: contentType });
  // Use provided filename or generate one
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = contentType.includes('image') ? (contentType.includes('png') ? 'png' : 'jpg') : 'mp4';
  
  const finalFileName = customFileName || `${timestamp}-${randomString}.${extension}`;
  const fixedFile = new File([blob], finalFileName, { type: contentType });
  
  if (fixedFile.size === 0 || arrayBuffer.byteLength === 0) {
    throw new Error("iOS returned an empty file. Try saving the file to 'Files' first, then upload.");
  }
  
  // Use Supabase client's built-in upload method which handles the new key format automatically
  // Unfortunately, Supabase JS client doesn't support progress callbacks natively
  // So we'll simulate progress based on file size and upload time
  const fileSize = fixedFile.size;
  const startTime = Date.now();
  const maxUploadTime = 300000; // 5 minutes max upload time
  
  // Simulate initial progress
  onProgress(5);
  
  // Start upload using Supabase client (handles new key format automatically)
  const uploadPromise = supabase.storage
    .from('comic-videos')
    .upload(finalFileName, fixedFile, {
      contentType: contentType,
      upsert: false,
    });
  
  // Add timeout to prevent hanging
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Upload timeout after ${maxUploadTime / 1000} seconds. File may be too large or network connection is slow.`));
    }, maxUploadTime);
  });
  
  // Simulate progress during upload (since we can't track real progress)
  let progressInterval: NodeJS.Timeout | null = setInterval(() => {
    const elapsed = Date.now() - startTime;
    // Estimate: assume 1MB per second upload speed
    const estimatedSpeed = 1024 * 1024; // 1MB per second
    const estimatedProgress = Math.min(80, (elapsed * estimatedSpeed / fileSize) * 100);
    onProgress(Math.max(5, estimatedProgress));
    
    // Stop progress simulation if we've exceeded max time
    if (elapsed > maxUploadTime) {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    }
  }, 100); // Update every 100ms
  
  try {
    // Race between upload and timeout
    const { data, error } = await Promise.race([uploadPromise, timeoutPromise]);
    
    // Clear progress interval
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    
    if (error) {
      console.error('[Supabase] Upload error:', error);
      throw new Error(`Failed to upload to Supabase: ${error.message}`);
    }
    
    if (!data) {
      throw new Error('Upload completed but no data returned');
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('comic-videos')
      .getPublicUrl(data.path);
    
    if (!urlData?.publicUrl) {
      throw new Error('Failed to get public URL from Supabase');
    }
    
    console.log(`[Supabase] File uploaded successfully: ${urlData.publicUrl}`);
    onProgress(100);
    return urlData.publicUrl;
  } catch (err) {
    // Clear progress interval on error
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    throw err;
  }
}


