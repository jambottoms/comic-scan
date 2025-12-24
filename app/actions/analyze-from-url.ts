'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Analyze a comic book video from a Supabase Storage URL
 * This bypasses Vercel's 4.5MB body size limit by downloading from Supabase
 */
export async function analyzeComicFromUrl(videoUrl: string) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables. Please add it to Vercel environment variables.";
    console.error(`[Server Action] ${errorMsg}`);
    throw new Error(errorMsg);
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
        throw new Error(`Download from Supabase timed out after ${downloadTimeout/1000} seconds. The video file may be too large or the connection is slow.`);
      }
      throw new Error(`Failed to download video from Supabase: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
    }
    
    if (!fetchResponse.ok) {
      const statusText = fetchResponse.statusText || 'Unknown error';
      const status = fetchResponse.status;
      throw new Error(`Failed to download video from Supabase: HTTP ${status} ${statusText}`);
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

    // Use gemini-2.5-flash (latest fast model with video support)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction
    });

    console.log("[Server Action] Sending video to Gemini API...");
    
    // Add timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 60 seconds. The video may be too long or the API is slow. Please try a shorter video.")), 60000);
    });

    const analysisPromise = model.generateContent([
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

    const result = await Promise.race([analysisPromise, timeoutPromise]) as any;
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
      return parsedResult;
    } catch (parseError) {
      console.error("Failed to parse JSON:", cleanText);
      throw new Error(`Invalid JSON response from AI: ${cleanText.substring(0, 100)}`);
    }

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
      } else if (error.message.includes("not found") || error.message.includes("404")) {
        errorMessage = `Model not found. Tried: gemini-2.5-flash. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try a different model name. Original error: ${error.message}`;
      } else if (error.message.includes("timeout") || error.message.includes("timed out")) {
        errorMessage = error.message; // Keep timeout messages as-is
      } else if (error.message.includes("Failed to download")) {
        errorMessage = error.message; // Keep download error messages as-is
      }
    } else {
      errorMessage = `Failed to analyze comic: ${String(error)}. Check Vercel logs for details.`;
    }
    
    // Always throw a new Error with a clean message to ensure it's serializable
    // This prevents Next.js from hiding the error in production
    const finalError = new Error(errorMessage);
    // Preserve original error info in the error object for logging
    (finalError as any).originalError = errorDetails;
    throw finalError;
  }
}

