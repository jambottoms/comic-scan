'use server';

// Environment Fix: Use createRequire for ESM compatibility
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { spawnSync } from 'child_process';
import { writeFile, unlink, stat, access } from 'fs/promises';
import path from 'path';

// Load ffmpeg-static at module level
const ffmpegStatic = require('ffmpeg-static');
let ffmpegPath: string;
if (typeof ffmpegStatic === 'string') {
  ffmpegPath = ffmpegStatic;
} else if (ffmpegStatic?.default && typeof ffmpegStatic.default === 'string') {
  ffmpegPath = ffmpegStatic.default;
} else if (ffmpegStatic?.path && typeof ffmpegStatic.path === 'string') {
  ffmpegPath = ffmpegStatic.path;
} else {
  throw new Error('ffmpeg-static returned invalid path format');
}
// Resolve to absolute path for Vercel compatibility
ffmpegPath = path.resolve(ffmpegPath);

/**
 * Result type for server action - returns success/error instead of throwing
 */
export type AnalyzeResult = 
  | { success: true; data: any }
  | { success: false; error: string };

/**
 * Analyze a comic book video from a Supabase Storage URL
 * Final version with exact specifications
 * 
 * Process:
 * 1. Download video to /tmp/input.mov
 * 2. Use spawnSync to convert to /tmp/output.mp4
 * 3. Upload to Google File API
 * 4. Poll until ACTIVE state
 * 5. Call gemini-2.5-flash with file data
 * 6. Cleanup both temp files
 */
export async function analyzeComicFromUrl(videoUrl: string, mimeType?: string): Promise<AnalyzeResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables. Please add it to Vercel environment variables.";
    console.error(`[Server Action] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  console.log(`[Server Action] API key present: ${apiKey ? 'Yes' : 'No'} (length: ${apiKey?.length || 0})`);

  // File paths
  const inputPath = '/tmp/input.mov';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log(`[Server Action] Starting video analysis pipeline for: ${videoUrl}`);
    
    // Step 1: Download the Supabase video to /tmp/input.mov
    console.log(`[Server Action] Downloading video from Supabase...`);
    const response = await fetch(videoUrl, {
      headers: {
        'Accept': 'video/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Read entire response into buffer and write to file
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Downloaded ${fileSizeMB}MB, writing to ${inputPath}`);
    
    await writeFile(inputPath, buffer);
    console.log(`[Server Action] ✅ Video saved to ${inputPath}`);
    
    // Step 2: FFmpeg Fix - Use ffmpeg-static via spawnSync to convert it to /tmp/output.mp4
    console.log(`[Server Action] Starting FFmpeg transcoding with spawnSync...`);
    console.log(`[FFmpeg] Binary: ${ffmpegPath}`);
    console.log(`[FFmpeg] Input: ${inputPath}, Output: ${outputPath}`);
    
    // Use spawnSync with exact flags
    const ffmpegResult = spawnSync(path.resolve(ffmpegPath), [
      '-y',
      '-i', '/tmp/input.mov',
      '-c:v', 'libx264',
      '-vf', 'scale=-1:1080,fps=1',
      '-an',
      '-f', 'mp4',
      '/tmp/output.mp4'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout/stderr piped
    });

    // Check FFmpeg result
    if (ffmpegResult.error) {
      throw new Error(`FFmpeg process failed: ${ffmpegResult.error.message}`);
    }

    if (ffmpegResult.status !== 0) {
      const stderr = ffmpegResult.stderr?.toString() || 'Unknown error';
      console.error(`[FFmpeg] stderr:`, stderr);
      throw new Error(`FFmpeg process exited with code: ${ffmpegResult.status}. Error: ${stderr.slice(-500)}`);
    }

    console.log(`[Server Action] ✅ FFmpeg transcoding complete`);
    
    // Verify output file exists and has data
    const outputStats = await stat(outputPath);
    if (outputStats.size === 0) {
      throw new Error('Transcoded file is empty on disk');
    }
    const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Transcoded file verified: ${outputSizeMB}MB`);
    
    // Step 3: Upload to Google File API
    console.log(`[Server Action] Uploading to Google File API...`);
    const fileManager = new GoogleAIFileManager(apiKey);
    
    // Upload the file
    const uploadResult = await fileManager.uploadFile(outputPath, {
      mimeType: 'video/mp4',
      displayName: 'ComicScan_Video',
    });
    
    console.log(`[Server Action] File uploaded, URI: ${uploadResult.file.uri}`);
    console.log(`[Server Action] File state: ${uploadResult.file.state}`);
    console.log(`[Server Action] File name: ${uploadResult.file.name}`);
    
    // Step 4: The Polling Loop (To prevent 404)
    // After fileManager.uploadFile(), write a while loop that calls fileManager.getFile()
    // Await until file.state === 'ACTIVE'. (If you call the model before this, it will 404)
    console.log(`[Server Action] Polling for ACTIVE state...`);
    const pollInterval = 500; // 500ms between polls
    const maxWaitTime = 30000; // 30 seconds max
    const startTime = Date.now();
    
    let file = uploadResult.file;
    
    // Write a while loop that calls fileManager.getFile()
    while (file.state !== 'ACTIVE') {
      // Check timeout
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`File upload timed out - file did not become ACTIVE within ${maxWaitTime / 1000} seconds. Current state: ${file.state}`);
      }
      
      if (file.state === 'FAILED') {
        const errorMsg = file.error?.message || 'Unknown error';
        throw new Error(`File upload failed: ${errorMsg}`);
      }
      
      // Log state periodically
      console.log(`[Server Action] File state: ${file.state}, waiting for ACTIVE...`);
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Call fileManager.getFile()
      file = await fileManager.getFile(uploadResult.file.name);
    }
    
    console.log(`[Server Action] ✅ File is ACTIVE`);
    
    // Step 5: Model ID - Use gemini-2.5-flash. (This is the verified stable ID for Dec 2025)
    console.log(`[Server Action] Using model: gemini-2.5-flash (verified stable ID for Dec 2025)`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning."
    });
    
    // Add timeout wrapper - Vercel has 300s timeout, so use 280s to be safe
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 280 seconds. The video transcoding or API call took too long. Please try a shorter video.")), 280000);
    });

    // Step 6: The Final Call - Pass the file to model.generateContent using:
    // [{ fileData: { mimeType: 'video/mp4', fileUri: file.uri } }, { text: "Analyze this comic video." }]
    const payload = [
      { 
        fileData: { 
          mimeType: 'video/mp4', 
          fileUri: file.uri 
        } 
      }, 
      { 
        text: "You are a professional comic book analyzer. From this video, 1) Identify all unique panels. 2) For each panel, extract the dialogue and specify which character is speaking. 3) Describe the visual action in each panel. Return the data as a clean JSON array of panels." 
      }
    ];
    
    console.log(`[Server Action] Sending to Gemini API...`);
    console.log(`[Server Action] File URI: ${file.uri}`);
    console.log(`[Server Action] MIME Type: video/mp4`);
    
    // Generate content with the model
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
    const geminiResponse = result.response;
    const text = await geminiResponse.text();
    
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
  } finally {
    // Step 7: Cleanup - Delete both files in /tmp in a finally block
    // Use Promise.allSettled so that if one file is missing, the other still gets deleted
    const cleanupPromises = [
      unlink(inputPath).catch(err => {
        console.warn(`[Server Action] Failed to cleanup ${inputPath}:`, err);
      }),
      unlink(outputPath).catch(err => {
        console.warn(`[Server Action] Failed to cleanup ${outputPath}:`, err);
      }),
    ];
    
    const results = await Promise.allSettled(cleanupPromises);
    const cleaned = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Server Action] Cleaned up ${cleaned}/${cleanupPromises.length} temp files`);
    
    // Safety check: After unlinking, use fs.promises.access to check if files still exist
    // If they do, log an error
    try {
      await access(inputPath);
      console.error(`[Server Action] ⚠️ SAFETY CHECK FAILED: ${inputPath} still exists after unlink!`);
    } catch (err) {
      // File doesn't exist (expected) - this is fine
    }
    
    try {
      await access(outputPath);
      console.error(`[Server Action] ⚠️ SAFETY CHECK FAILED: ${outputPath} still exists after unlink!`);
    } catch (err) {
      // File doesn't exist (expected) - this is fine
    }
  }
}
