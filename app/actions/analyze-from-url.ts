'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToGoogleFileAPI } from "@/lib/google/file-api";

/**
 * Result type for server action - returns success/error instead of throwing
 */
export type AnalyzeResult = 
  | { success: true; data: any }
  | { success: false; error: string };

/**
 * Analyze a comic book video from a Supabase Storage URL
 * This bypasses Vercel's 4.5MB body size limit by downloading from Supabase
 * Returns a result object instead of throwing to avoid Next.js error hiding
 */
export async function analyzeComicFromUrl(videoUrl: string, mimeType?: string): Promise<AnalyzeResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables. Please add it to Vercel environment variables.";
    console.error(`[Server Action] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  console.log(`[Server Action] API key present: ${apiKey ? 'Yes' : 'No'} (length: ${apiKey?.length || 0})`);

  try {
    console.log(`[Server Action] Downloading video from Supabase: ${videoUrl}`);
    
    // Download video from Supabase Storage URL with timeout
    const downloadTimeout = 30000; // 30 seconds for download
    const downloadController = new AbortController();
    const downloadTimeoutId = setTimeout(() => downloadController.abort(), downloadTimeout);
    
    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(videoUrl, { 
        signal: downloadController.signal,
        headers: {
          'Accept': 'video/*',
        }
      });
      clearTimeout(downloadTimeoutId);
    } catch (fetchError) {
      clearTimeout(downloadTimeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return { 
          success: false, 
          error: `Download from Supabase timed out after ${downloadTimeout/1000} seconds. The video file may be too large or the connection is slow.` 
        };
      }
      return { 
        success: false, 
        error: `Failed to download video from Supabase: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}` 
      };
    }
    
    if (!fetchResponse.ok) {
      const statusText = fetchResponse.statusText || 'Unknown error';
      const status = fetchResponse.status;
      return { 
        success: false, 
        error: `Failed to download video from Supabase: HTTP ${status} ${statusText}` 
      };
    }
    
    const arrayBuffer = await fetchResponse.arrayBuffer();
    const fileSizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Video downloaded: ${fileSizeMB}MB`);
    
    // Determine mimeType
    let finalMimeType = mimeType || 'video/mp4';
    if (!mimeType) {
      const urlLower = videoUrl.toLowerCase();
      if (urlLower.endsWith('.webm')) {
        finalMimeType = 'video/webm';
      } else if (urlLower.endsWith('.mov') || urlLower.endsWith('.qt')) {
        finalMimeType = 'video/quicktime';
      } else if (urlLower.endsWith('.avi')) {
        finalMimeType = 'video/x-msvideo';
      } else if (urlLower.endsWith('.mkv')) {
        finalMimeType = 'video/x-matroska';
      }
    }
    
    if (!finalMimeType.startsWith('video/')) {
      finalMimeType = 'video/mp4';
    }
    
    console.log(`[Server Action] MIME type: ${finalMimeType}`);
    
    // For large files (>20MB), use Google File API to avoid token limits
    // This preserves full video quality without compression
    const binarySizeMB = parseFloat(fileSizeMB);
    const useFileAPI = binarySizeMB > 20;
    
    let fileUri: string | null = null;
    let base64Video: string | null = null;
    
    if (useFileAPI) {
      // Upload to Google File API for large videos (preserves quality, avoids token limits)
      console.log(`[Server Action] File is large (${fileSizeMB}MB), uploading to Google File API...`);
      
      try {
        // Convert ArrayBuffer to Blob for upload
        const blob = new Blob([arrayBuffer], { type: finalMimeType });
        const file = new File([blob], 'comic-video', { type: finalMimeType });
        
        fileUri = await uploadToGoogleFileAPI(file, apiKey);
        console.log(`[Server Action] File uploaded to Google File API: ${fileUri}`);
      } catch (fileApiError) {
        console.error(`[Server Action] Google File API upload failed:`, fileApiError);
        // For very large files, fail if File API doesn't work
        if (binarySizeMB > 50) {
          return {
            success: false,
            error: `File is too large (${fileSizeMB}MB) and Google File API upload failed. Please try a shorter video (under 30 seconds). Error: ${fileApiError instanceof Error ? fileApiError.message : String(fileApiError)}`
          };
        }
        // For medium files, fall back to base64 (may cause 500 error)
        console.log(`[Server Action] Falling back to base64 inline (may cause 500 error)...`);
        const buffer = Buffer.from(arrayBuffer);
        base64Video = buffer.toString("base64");
      }
    } else {
      // For small files, use base64 inline (faster)
      console.log(`[Server Action] File is small (${fileSizeMB}MB), using base64 inline...`);
      const buffer = Buffer.from(arrayBuffer);
      base64Video = buffer.toString("base64");
      console.log(`[Server Action] Base64 size: ${(base64Video.length / 1024 / 1024).toFixed(2)}MB`);
    }
    
    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // System instruction
    const systemInstruction = "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning.";

    // Use gemini-2.5-flash (stable model, uses v1 API)
    console.log(`[Server Action] Using model: gemini-2.5-flash (stable, v1 API)`);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction
    });
    
    // Add timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 60 seconds. The video may be too long or the API is slow. Please try a shorter video.")), 60000);
    });

    // Build payload - use file URI if available, otherwise base64
    console.log(`[Server Action] Sending video to Gemini API (${fileUri ? 'File API reference' : 'base64 inline'})...`);
    const payload: any[] = [];
    
    if (fileUri) {
      // Use Google File API reference (no token limit issues)
      payload.push({
        fileData: {
          fileUri: fileUri,
          mimeType: finalMimeType
        }
      });
    } else if (base64Video) {
      // Use base64 inline (for small files)
      payload.push({
        inlineData: {
          data: base64Video,
          mimeType: finalMimeType
        }
      });
    } else {
      return {
        success: false,
        error: 'Failed to prepare video data for analysis'
      };
    }
    
    payload.push({
      text: "Analyze this comic book video. Look at all frames to identify the comic and assess its condition."
    });
    
    // Generate content with the model
    const analysisPromise = model.generateContent(payload);
    
    const result = await Promise.race([analysisPromise, timeoutPromise]) as any;
    
    console.log("[Server Action] Received response from Gemini API");
    
    // Get the response text (text() is async and must be awaited)
    const response = result.response;
    const text = await response.text();
    
    // Clean up markdown code blocks if Gemini sends them
    let cleanText = text.trim();
    
    // Remove markdown code blocks more robustly
    if (cleanText.startsWith("```")) {
      const lines = cleanText.split("\n");
      cleanText = lines.slice(1, -1).join("\n");
    }
    cleanText = cleanText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    
    // Parse JSON with better error handling
    try {
      const parsedResult = JSON.parse(cleanText);
      console.log("[Server Action] Parsed JSON result:", parsedResult);
      return { success: true, data: parsedResult };
    } catch (parseError) {
      console.error("Failed to parse JSON:", cleanText);
      return { 
        success: false, 
        error: `Invalid JSON response from AI: ${cleanText.substring(0, 100)}` 
      };
    }

  } catch (error) {
    // Enhanced error logging for production debugging
    const errorDetails = {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.constructor.name : typeof error,
    };
    
    // Check if it's a Gemini API error with more details
    let geminiErrorDetails = null;
    if (error && typeof error === 'object' && 'response' in error) {
      try {
        geminiErrorDetails = JSON.stringify(error);
      } catch (e) {
        geminiErrorDetails = String(error);
      }
    }
    
    console.error("[Server Action] ========== ERROR DETAILS ==========");
    console.error("[Server Action] Error analyzing comic:", errorDetails);
    if (geminiErrorDetails) {
      console.error("[Server Action] Gemini API error details:", geminiErrorDetails);
    }
    console.error("[Server Action] Video URL:", videoUrl);
    console.error("[Server Action] API Key set:", !!process.env.GOOGLE_API_KEY);
    console.error("[Server Action] ==================================");
    
    // Provide more helpful error messages
    let errorMessage = "Failed to analyze comic. Check Vercel logs for details.";
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Handle specific error cases
      if (error.message.includes("GOOGLE_API_KEY")) {
        errorMessage = "Google API key is missing. Please add GOOGLE_API_KEY to Vercel environment variables.";
      } else if (error.message.includes("unexpected response") || error.message.includes("Unexpected")) {
        errorMessage = "Server action error: The response may be too large or the request timed out. Try a shorter video.";
      } else if (error.message.includes("not found") || error.message.includes("404") || error.message.includes("500")) {
        if (error.message.includes("500")) {
          errorMessage = `500 Internal Server Error from Gemini API. Possible causes: 1) Token overflow (video too large - try smaller/shorter video) 2) Malformed payload (invalid base64 or mimeType) 3) API quota/permission issue 4) Temporary API outage. Check Vercel logs for token estimates. Original error: ${error.message}`;
        } else {
          errorMessage = `API error (${error.message.includes("404") ? "Model not found" : "Unknown"}). Using gemini-2.5-flash. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try again in a few moments (API may be temporarily unavailable). Original error: ${error.message}`;
        }
      } else if (error.message.includes("invalid") || error.message.includes("malformed") || error.message.includes("format")) {
        errorMessage = `Invalid payload format. The video may be corrupted or in an unsupported format. Error: ${error.message}`;
      } else if (error.message.includes("timeout") || error.message.includes("timed out")) {
        errorMessage = error.message; // Keep timeout messages as-is
      } else if (error.message.includes("Failed to download")) {
        errorMessage = error.message; // Keep download error messages as-is
      }
    } else {
      errorMessage = `Failed to analyze comic: ${String(error)}. Check Vercel logs for details.`;
    }
    
    // Return error as result object instead of throwing
    // This prevents Next.js from hiding the error in production
    return { success: false, error: errorMessage };
  }
}

