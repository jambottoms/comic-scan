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
  onProgress: (progress: number) => void
): Promise<string> {
  const supabase = createClient();
  
  console.log(`[Supabase Upload] Original file: ${originalFile.name}, Size: ${originalFile.size}, Type: ${originalFile.type || '(empty)'}`);
  
  // Read file into memory (iOS fix)
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await readFileAsArrayBuffer(originalFile);
    console.log(`[Supabase Upload] File read into memory: ${arrayBuffer.byteLength} bytes`);
  } catch (error) {
    console.error(`[Supabase Upload] Failed to read file:`, error);
    throw new Error(`Failed to read video file. This may be an iOS issue. Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
  const fixedFile = new File([blob], 'comic_scan.mp4', { type: 'video/mp4' });
  
  if (fixedFile.size === 0 || arrayBuffer.byteLength === 0) {
    throw new Error("iOS returned an empty file. Try saving the video to 'Files' first, then upload.");
  }
  
  // Generate unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const fileName = `${timestamp}-${randomString}.mp4`;
  
  // Get Supabase URL and key from environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase environment variables are not set');
  }
  
  // Get the storage URL for upload
  const storageUrl = `${supabaseUrl}/storage/v1/object/comic-videos/${fileName}`;
  
  // Upload using XMLHttpRequest for progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        onProgress(percentComplete);
        console.log(`[Supabase Upload] Progress: ${percentComplete.toFixed(1)}%`);
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Get public URL using Supabase client
        const { data: urlData } = supabase.storage
          .from('comic-videos')
          .getPublicUrl(fileName);
        
        if (!urlData?.publicUrl) {
          reject(new Error('Failed to get public URL from Supabase'));
          return;
        }
        
        console.log(`[Supabase] File uploaded successfully: ${urlData.publicUrl}`);
        resolve(urlData.publicUrl);
      } else {
        try {
          const error = JSON.parse(xhr.responseText || '{}');
          reject(new Error(`Failed to upload to Supabase: ${error.message || xhr.statusText}`));
        } catch {
          reject(new Error(`Failed to upload to Supabase: ${xhr.statusText || 'Unknown error'}`));
        }
      }
    });
    
    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });
    
    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was aborted'));
    });
    
    xhr.open('POST', storageUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${supabaseKey}`);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.setRequestHeader('x-upsert', 'false');
    
    xhr.send(fixedFile);
  });
}

