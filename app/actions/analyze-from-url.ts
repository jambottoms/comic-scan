'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToGoogleFileAPI, uploadStreamToGoogleFileAPI } from "@/lib/google/file-api";
import { normalizeVideoFromUrl } from "@/lib/video/normalize";
import { Readable } from 'stream';

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
    console.log(`[Server Action] Starting video normalization pipeline for: ${videoUrl}`);
    
    // Step 1: Normalize video (downloads as stream, transcodes to H.264, 1080p, 1fps, no audio)
    // This handles all mobile video formats (HEVC, QuickTime, etc.)
    let normalizedStream: Readable;
    try {
      const startTime = Date.now();
      normalizedStream = await normalizeVideoFromUrl(videoUrl, {
        onProgress: (progress) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Server Action] Normalization progress: ${progress.percent.toFixed(1)}% (${progress.frames} frames, ${elapsed}s elapsed)`);
        }
      });
      console.log(`[Server Action] ✅ Video normalization complete`);
    } catch (normalizeError) {
      const errorDetails = normalizeError instanceof Error ? normalizeError.message : String(normalizeError);
      console.error(`[Server Action] ❌ Video normalization failed:`, errorDetails);
      return {
        success: false,
        error: `Failed to normalize video. This may be due to unsupported format or corruption. Error: ${errorDetails}`
      };
    }
    
    // Step 2: Upload normalized stream directly to Google File API
    // Explicitly set mimeType to video/mp4
    const finalMimeType = 'video/mp4';
    let fileUri: string | null = null;
    
    try {
      console.log(`[Server Action] Uploading normalized video to Google File API (mimeType: ${finalMimeType})...`);
      fileUri = await uploadStreamToGoogleFileAPI(normalizedStream, apiKey, finalMimeType);
      console.log(`[Server Action] ✅ File uploaded to Google File API: ${fileUri}`);
    } catch (fileApiError) {
      const errorDetails = fileApiError instanceof Error ? {
        message: fileApiError.message,
        stack: fileApiError.stack,
        name: fileApiError.name
      } : { message: String(fileApiError) };
      
      console.error(`[Server Action] ❌ Google File API upload failed:`, errorDetails);
      
      return {
        success: false,
        error: `Failed to upload normalized video to Google File API. Error: ${errorDetails.message}`
      };
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
    
    // Add timeout wrapper - Vercel has 300s timeout, so use 280s to be safe
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 280 seconds. The video normalization or API call took too long. Please try a shorter video.")), 280000);
    });

    // Build payload - always use File API reference
    if (!fileUri) {
      return {
        success: false,
        error: 'Failed to get file URI from Google File API'
      };
    }
    
    console.log(`[Server Action] Sending video to Gemini API using File API reference: ${fileUri}`);
    console.log(`[Server Action] Payload: fileUri=${fileUri}, mimeType=${finalMimeType}`);
    
    const payload = [
      {
        fileData: {
          fileUri: fileUri,
          mimeType: finalMimeType
        }
      },
      {
        text: "Analyze this comic book video. Look at all frames to identify the comic and assess its condition."
      }
    ];
    
    // Generate content with the model
    console.log(`[Server Action] Calling model.generateContent()...`);
    
    let result: any;
    try {
      const analysisPromise = model.generateContent(payload);
      result = await Promise.race([analysisPromise, timeoutPromise]) as any;
      console.log("[Server Action] ✅ Received response from Gemini API");
    } catch (geminiError: any) {
      // Log the full error from Gemini API
      console.error("[Server Action] ❌ Gemini API error:", {
        name: geminiError?.name,
        message: geminiError?.message,
        stack: geminiError?.stack,
        response: geminiError?.response,
        status: geminiError?.status,
        statusText: geminiError?.statusText,
        fullError: JSON.stringify(geminiError, Object.getOwnPropertyNames(geminiError))
      });
      
      // Try to extract more details from the error
      let errorMessage = geminiError?.message || String(geminiError);
      if (geminiError?.response) {
        try {
          const errorText = await geminiError.response.text();
          console.error("[Server Action] Gemini API error response body:", errorText);
          errorMessage += ` | Response: ${errorText}`;
        } catch (e) {
          // Ignore if we can't read the response
        }
      }
      
      throw new Error(`Gemini API error: ${errorMessage}`);
    }
    
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

