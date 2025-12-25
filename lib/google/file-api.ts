/**
 * Google File API utilities
 * Uploads large videos to Google File API to avoid token limits when sending to Gemini
 */

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

