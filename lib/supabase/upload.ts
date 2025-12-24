'use client';

import { createClient } from './client';

/**
 * Upload a file to Supabase Storage (client-side)
 * Returns the public URL of the uploaded file
 */
export async function uploadToSupabase(file: File): Promise<string> {
  const supabase = createClient();
  
  // Generate a unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const fileExt = file.name.split('.').pop();
  const fileName = `${timestamp}-${randomString}.${fileExt}`;
  
  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('comic-videos')
    .upload(fileName, file, {
      contentType: file.type,
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

