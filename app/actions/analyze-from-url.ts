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
    console.log("[Server Action] Video converted to base64");
    
    // Determine mime type from URL or default to mp4
    const mimeType = videoUrl.toLowerCase().endsWith('.webm') ? 'video/webm' : 
                     videoUrl.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 
                     'video/mp4';

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // System instruction
    const systemInstruction = "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning.";

    // Try models in order of preference for comic book video analysis
    // Newer models require -preview suffix and have better spatial understanding
    const modelNames = [
      "gemini-2.5-pro",           // Stable, good for comics
      "gemini-2.5-pro-latest",     // Latest 2.5 version
      "gemini-3-pro-preview",      // Best for comics (spatial understanding)
      "gemini-3-pro",              // Without preview suffix
      "gemini-3-flash-preview",    // Faster alternative
      "gemini-3-flash",            // Without preview suffix
      "gemini-1.5-pro",            // Fallback
      "gemini-pro-vision"          // Last resort
    ];
    
    // Try each model until one works
    // Note: getGenerativeModel() doesn't validate the model - errors only occur when calling generateContent()
    let model;
    let modelName;
    let lastError: Error | null = null;
    let triedModels: string[] = [];
    
    for (const tryModelName of modelNames) {
      try {
        console.log(`[Server Action] Trying model: ${tryModelName}`);
        model = genAI.getGenerativeModel({ 
          model: tryModelName,
          systemInstruction: systemInstruction
        });
        modelName = tryModelName;
        triedModels.push(tryModelName);
        
        console.log(`[Server Action] Model object created, testing with generateContent...`);
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Video analysis timed out after 60 seconds. The video may be too long or the API is slow. Please try a shorter video.")), 60000);
        });

        // Actually try to use the model - this is where "model not found" errors occur
        const testPromise = model.generateContent([
          {
            inlineData: {
              data: base64Video,
              mimeType: mimeType
            }
          },
          {
            text: "Analyze this comic book video. Look at all frames to identify the comic and assess its condition."
          }
        ]);
        
        // If we get here without error, the model works!
        console.log(`[Server Action] Successfully using model: ${modelName}`);
        const result = await Promise.race([testPromise, timeoutPromise]) as any;
        
        // Model works! Continue with processing the result
        console.log("[Server Action] Received response from Gemini API");
        
        // Get the response text
        const response = result.response;
        const text = response.text();
        
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
        
      } catch (modelError) {
        lastError = modelError instanceof Error ? modelError : new Error(String(modelError));
        const errorMsg = lastError.message;
        console.log(`[Server Action] Model ${tryModelName} failed: ${errorMsg}`);
        
        // If it's a "model not found" error, try next model
        if (errorMsg.includes("not found") || errorMsg.includes("404") || errorMsg.includes("is not found")) {
          continue; // Try next model
        }
        
        // If it's a timeout, return that error
        if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
          return {
            success: false,
            error: `Video analysis timed out after 60 seconds. The video may be too long or the API is slow. Please try a shorter video.`
          };
        }
        
        // For other errors, try next model (might be temporary API issue)
        if (triedModels.length < modelNames.length) {
          continue;
        }
        
        // If we've tried all models, return error
        return {
          success: false,
          error: `All models failed. Tried: ${triedModels.join(", ")}. Last error: ${errorMsg}`
        };
      }
    }
    
    // If we get here, all models failed
    return {
      success: false,
      error: `No available Gemini models found. Tried: ${triedModels.join(", ")}. Please check: 1) Your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Your API key may need access to newer models. Last error: ${lastError?.message || "Unknown"}`
    };

  } catch (error) {
    // Enhanced error logging for production debugging
    const errorDetails = {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.constructor.name : typeof error,
    };
    
    console.error("[Server Action] ========== ERROR DETAILS ==========");
    console.error("[Server Action] Error analyzing comic:", errorDetails);
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
      } else       if (error.message.includes("not found") || error.message.includes("404") || error.message.includes("500")) {
        errorMessage = `API error (${error.message.includes("500") ? "500 Internal Server Error" : "Model not found"}). Tried multiple models. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try again in a few moments (API may be temporarily unavailable). Original error: ${error.message}`;
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

