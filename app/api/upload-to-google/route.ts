import { NextRequest, NextResponse } from 'next/server';
import { GoogleAIFileManager } from "@google/generative-ai";

export const maxDuration = 300; // 5 minutes for large uploads

/**
 * API route to upload video from Supabase to Google File API
 * Uses streaming to avoid memory issues
 */
export async function POST(request: NextRequest) {
  try {
    const { videoUrl, mimeType, fileName } = await request.json();
    
    if (!videoUrl || !mimeType) {
      return NextResponse.json(
        { error: 'Missing videoUrl or mimeType' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GOOGLE_API_KEY is not set' },
        { status: 500 }
      );
    }

    console.log(`[API Route] Downloading video from Supabase: ${videoUrl}`);
    
    // Download video from Supabase with streaming
    const downloadResponse = await fetch(videoUrl, {
      headers: { 'Accept': 'video/*' }
    });
    
    if (!downloadResponse.ok) {
      return NextResponse.json(
        { error: `Failed to download from Supabase: ${downloadResponse.statusText}` },
        { status: downloadResponse.status }
      );
    }

    // Stream the download and collect chunks (we'll optimize this later)
    const chunks: Uint8Array[] = [];
    const reader = downloadResponse.body?.getReader();
    
    if (!reader) {
      return NextResponse.json(
        { error: 'Failed to get response stream' },
        { status: 500 }
      );
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks into buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[API Route] Video downloaded: ${fileSizeMB}MB`);

    // Upload to Google File API
    const fileManager = new GoogleAIFileManager(apiKey);
    console.log(`[API Route] Uploading ${fileSizeMB}MB to Google File API...`);
    
    const uploadResult = await fileManager.uploadFile(Buffer.from(buffer), {
      mimeType: mimeType,
      displayName: fileName || `comic-video-${Date.now()}`,
    });

    console.log(`[API Route] Video uploaded. File URI: ${uploadResult.file.uri}, State: ${uploadResult.file.state}`);

    return NextResponse.json({
      uri: uploadResult.file.uri,
      name: uploadResult.file.name,
      state: uploadResult.file.state,
    });

  } catch (error) {
    console.error('[API Route] Upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload video' },
      { status: 500 }
    );
  }
}

