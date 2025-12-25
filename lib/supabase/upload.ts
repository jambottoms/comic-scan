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

export async function uploadToSupabase(originalFile: File): Promise<string> {
  const supabase = createClient();
  
  // iOS FIX: Force iOS to resolve the file into a real Blob
  // The slice() operation forces the mobile OS to actually provide the bytes
  // This fixes the "size" and "type" issues that plague mobile Chrome/Safari
  console.log(`[Supabase Upload] Original file: ${originalFile.name}, Size: ${originalFile.size}, Type: ${originalFile.type || '(empty)'}`);
  
  const blob = originalFile.slice(0, originalFile.size, 'video/mp4');
  
  // Rename and re-type the file to standard MP4
  // This bypasses the Apple .MOV / .HEVC naming issues
  const fixedFile = new File([blob], 'comic_scan.mp4', { type: 'video/mp4' });
  
  // Validation Check - iOS sometimes returns empty files
  if (fixedFile.size === 0) {
    throw new Error("iOS returned an empty file. Try saving the video to 'Files' first, then upload.");
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


