'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";

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
export async function analyzeComicFromUrl(videoUrl: string): Promise<AnalyzeResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables. Please add it to Vercel environment variables.";
    console.error(`[Server Action] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  // Log API key status (without exposing the key)
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
    
    const buffer = Buffer.from(arrayBuffer);
    const base64Video = buffer.toString("base64");
    const base64SizeMB = (base64Video.length / 1024 / 1024).toFixed(2);
    const base64SizeChars = base64Video.length;
    console.log(`[Server Action] Video converted to base64: ${base64SizeMB}MB (${base64SizeChars.toLocaleString()} characters)`);
    
    // Validate base64 encoding
    if (!base64Video || base64Video.length === 0) {
      return {
        success: false,
        error: "Failed to encode video to base64. The video file may be corrupted."
      };
    }
    
    // Validate base64 format (should only contain valid base64 characters)
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64Video)) {
      return {
        success: false,
        error: "Invalid base64 encoding detected. The video file may be corrupted."
      };
    }
    
    // Determine mime type from URL or default to mp4
    // Validate mimeType is a valid video format
    let mimeType = 'video/mp4';
    const urlLower = videoUrl.toLowerCase();
    if (urlLower.endsWith('.webm')) {
      mimeType = 'video/webm';
    } else if (urlLower.endsWith('.mov') || urlLower.endsWith('.qt')) {
      mimeType = 'video/quicktime';
    } else if (urlLower.endsWith('.avi')) {
      mimeType = 'video/x-msvideo';
    } else if (urlLower.endsWith('.mkv')) {
      mimeType = 'video/x-matroska';
    }
    
    // Validate mimeType format
    if (!mimeType.startsWith('video/')) {
      console.warn(`[Server Action] Invalid mimeType detected: ${mimeType}, defaulting to video/mp4`);
      mimeType = 'video/mp4';
    }
    
    // Log file size info
    // Note: Token estimation for video is unreliable - Gemini processes video frames efficiently
    // and doesn't tokenize raw base64. The actual token count is much lower than base64 size.
    // We'll let the API handle size limits and return proper errors if needed.
    console.log(`[Server Action] Video file size: ${fileSizeMB}MB binary, ${base64SizeMB}MB base64`);
    console.log(`[Server Action] MIME type: ${mimeType}`);
    
    // Warn for very large files, but don't reject - let API handle it
    const binarySizeMB = parseFloat(fileSizeMB);
    if (binarySizeMB > 50) {
      console.warn(`[Server Action] WARNING: Video is very large (${fileSizeMB}MB). May exceed API limits or take a long time to process.`);
    } else if (binarySizeMB > 20) {
      console.warn(`[Server Action] WARNING: Video is large (${fileSizeMB}MB). Processing may take longer.`);
    }

    // Initialize Google Generative AI
    // The SDK uses v1 (stable) API by default for stable models like gemini-2.5-flash
    // v1beta is only used for preview/experimental models
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // System instruction
    const systemInstruction = "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning.";

    // Use gemini-2.5-flash (stable model, uses v1 API)
    // Note: Stable models like gemini-2.5-flash use the v1 API endpoint automatically
    console.log(`[Server Action] Using model: gemini-2.5-flash (stable, v1 API)`);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction
    });
    
    // TEST: First verify API works with simple request
    try {
      console.log("[Server Action] Testing API with simple 'test' prompt...");
      const testResult = await model.generateContent("test");
      const testText = await testResult.response.text();
      console.log(`[Server Action] API test successful. Response: ${testText.substring(0, 50)}...`);
    } catch (testError) {
      console.error("[Server Action] API test failed:", testError);
      const testErrorMsg = testError instanceof Error ? testError.message : String(testError);
      return {
        success: false,
        error: `API test failed. This suggests an API key, quota, or permission issue. Error: ${testErrorMsg}`
      };
    }
    
    // Add timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 60 seconds. The video may be too long or the API is slow. Please try a shorter video.")), 60000);
    });

    // Validate payload structure before sending
    const payload = [
      {
        inlineData: {
          data: base64Video,
          mimeType: mimeType
        }
      },
      {
        text: "Analyze this comic book video. Look at all frames to identify the comic and assess its condition."
      }
    ];
    
    // Validate payload structure
    if (!payload[0]?.inlineData?.data || !payload[0]?.inlineData?.mimeType) {
      return {
        success: false,
        error: "Malformed payload: inlineData structure is invalid."
      };
    }
    
    if (!payload[1]?.text || typeof payload[1].text !== 'string') {
      return {
        success: false,
        error: "Malformed payload: text prompt is invalid."
      };
    }
    
    console.log("[Server Action] Payload validated. Sending video to Gemini API...");
    console.log(`[Server Action] Payload structure: ${payload.length} parts (1 video, 1 text)`);
    
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

