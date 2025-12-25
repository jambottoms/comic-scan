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

export async function uploadToSupabase(file: File): Promise<string> {
  const supabase = createClient();
  
  // Detect MIME type (iOS Photos often has empty file.type)
  const detectedMimeType = detectMimeType(file);
  
  // Generate a unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const fileExt = file.name.split('.').pop() || 'mp4'; // Default to mp4 if no extension
  const fileName = `${timestamp}-${randomString}.${fileExt}`;
  
  console.log(`[Supabase Upload] File: ${file.name}, Type: ${file.type || '(empty)'}, Detected: ${detectedMimeType}`);
  
  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('comic-videos')
    .upload(fileName, file, {
      contentType: detectedMimeType, // Use detected type instead of file.type
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


