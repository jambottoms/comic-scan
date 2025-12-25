'use client';

import { createClient } from './client';

/**
 * Upload a file to Supabase Storage (client-side)
 * Returns the public URL of the uploaded file
 */
// Helper to detect MIME type from file (iOS Photos often has empty file.type)
function detectMimeType(file: File): string {
  if (file.type && file.type.startsWith('video/')) {
    return file.type;
  }
  
  const fileName = file.name.toLowerCase();
  const extension = fileName.split('.').pop();
  
  const mimeTypes: Record<string, string> = {
    'mp4': 'video/mp4',
    'mov': 'video/quicktime', // iOS Photos default
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'm4v': 'video/x-m4v',
    '3gp': 'video/3gpp',
  };
  
  return extension && mimeTypes[extension] ? mimeTypes[extension] : 'video/mp4';
}

/**
 * Read file completely into memory using FileReader
 * This forces iOS to commit all bytes before upload
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

export async function uploadToSupabase(originalFile: File): Promise<string> {
  const supabase = createClient();
  
  console.log(`[Supabase Upload] Original file: ${originalFile.name}, Size: ${originalFile.size}, Type: ${originalFile.type || '(empty)'}`);
  
  // iOS FIX: Read file completely into memory using FileReader
  // This forces iOS to commit all bytes and resolve the file completely
  // This is more reliable than slice() for HEVC/QuickTime files
  console.log(`[Supabase Upload] Reading file into memory to force iOS commit...`);
  
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await readFileAsArrayBuffer(originalFile);
    console.log(`[Supabase Upload] File read into memory: ${arrayBuffer.byteLength} bytes`);
  } catch (error) {
    console.error(`[Supabase Upload] Failed to read file:`, error);
    throw new Error(`Failed to read video file. This may be an iOS issue. Try: 1) Save video to Files app first, 2) Record in "Most Compatible" format (Settings > Camera > Formats). Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Create new Blob and File from the ArrayBuffer
  // This ensures we have a clean, committed file
  const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
  const fixedFile = new File([blob], 'comic_scan.mp4', { type: 'video/mp4' });
  
  // Validation Check
  if (fixedFile.size === 0 || arrayBuffer.byteLength === 0) {
    throw new Error("iOS returned an empty file. Try saving the video to 'Files' first, then upload.");
  }
  
  if (fixedFile.size !== originalFile.size) {
    console.warn(`[Supabase Upload] Size mismatch: original=${originalFile.size}, fixed=${fixedFile.size}`);
  }
  
  console.log(`[Supabase Upload] Fixed file: ${fixedFile.name}, Size: ${fixedFile.size}, Type: ${fixedFile.type}`);
  
  // Generate a unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const fileName = `${timestamp}-${randomString}.mp4`;
  
  // Upload to Supabase Storage with normalized MP4 file
  const { data, error } = await supabase.storage
    .from('comic-videos')
    .upload(fileName, fixedFile, {
      contentType: 'video/mp4', // Always use video/mp4 after normalization
      upsert: false,
    });

  if (error) {
    console.error('[Supabase] Upload error:', error);
    throw new Error(`Failed to upload to Supabase: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('comic-videos')
    .getPublicUrl(data.path);

  if (!urlData?.publicUrl) {
    throw new Error('Failed to get public URL from Supabase');
  }

  console.log(`[Supabase] File uploaded successfully: ${urlData.publicUrl}`);
  return urlData.publicUrl;
}


