'use server';

import { GoogleAIFileManager } from "@google/generative-ai";

/**
 * Upload a file to Google File API using streaming to avoid memory issues
 * Returns the file URI and state
 */
export async function uploadVideoToGoogle(
  fileStream: ReadableStream<Uint8Array>,
  mimeType: string,
  fileName: string
): Promise<{ uri: string; name: string; state: string }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  const fileManager = new GoogleAIFileManager(apiKey);
  
  // Convert stream to buffer (we'll optimize this later with streaming upload)
  const chunks: Uint8Array[] = [];
  const reader = fileStream.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  
  // Combine chunks into single buffer
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  
  console.log(`[Google Upload] Uploading ${(buffer.length / 1024 / 1024).toFixed(2)}MB to Google File API...`);
  
  const uploadResult = await fileManager.uploadFile(Buffer.from(buffer), {
    mimeType: mimeType,
    displayName: fileName,
  });
  
  return {
    uri: uploadResult.file.uri,
    name: uploadResult.file.name,
    state: uploadResult.file.state,
  };
}

/**
 * Get file state from Google File API
 */
export async function getGoogleFileState(fileName: string): Promise<{ state: string; error?: string }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  const fileManager = new GoogleAIFileManager(apiKey);
  const file = await fileManager.getFile(fileName);
  
  return {
    state: file.state,
    error: file.error?.message,
  };
}

