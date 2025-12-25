'use server';

// Environment Fix: Use createRequire for ESM compatibility
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { spawn } from 'child_process';
import { writeFile, unlink, stat } from 'fs/promises';
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
 * Complete rewrite to fix 404 model errors and iPhone metadata issues
 * 
 * Process:
 * 1. Download video to /tmp/input.mov
 * 2. Transcode with FFmpeg to /tmp/output.mp4
 * 3. Upload to Google File API and poll until ACTIVE
 * 4. Call gemini-3-flash with file data
 * 5. Cleanup both temp files
 */
export async function analyzeComicFromUrl(videoUrl: string, mimeType?: string): Promise<AnalyzeResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables. Please add it to Vercel environment variables.";
    console.error(`[Server Action] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  console.log(`[Server Action] API key present: ${apiKey ? 'Yes' : 'No'} (length: ${apiKey?.length || 0})`);

  // File paths for brute force transcoding (iPhone fix)
  const inputPath = '/tmp/input.mov';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log(`[Server Action] Starting video analysis pipeline for: ${videoUrl}`);
    
    // Step 1: Download video from Supabase and save to /tmp/input.mov
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
    
    // Step 2: Brute Force Transcoding (iPhone Fix)
    // Use child_process.spawn with path.resolve(ffmpegPath) to transcode physical file
    console.log(`[Server Action] Starting FFmpeg transcoding...`);
    console.log(`[FFmpeg] Binary: ${ffmpegPath}`);
    console.log(`[FFmpeg] Input: ${inputPath}, Output: ${outputPath}`);
    
    // Wrap spawn in Promise and await it so process finishes 100% before moving on
    await new Promise<void>((resolve, reject) => {
      const ffmpegProcess = spawn(path.resolve(ffmpegPath), [
        '-y',                              // Overwrite output file
        '-i', inputPath,                   // Input from physical file
        '-c:v', 'libx264',                 // H.264 codec (iPhone compatibility)
        '-vf', 'scale=-1:1080,fps=1',      // Scale to 1080p height, 1 fps
        '-an',                             // No audio
        '-f', 'mp4',                       // MP4 format
        outputPath                         // Output to physical file
      ], {
        stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout/stderr piped
      });

      // Collect stderr for logging
      let stderrBuffer = '';
      let lastProgressTime = Date.now();
      
      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        
        // Parse FFmpeg progress output
        const frameMatch = stderrBuffer.match(/frame=\s*(\d+)/);
        const fpsMatch = stderrBuffer.match(/fps=\s*([\d.]+)/);
        
        if (frameMatch) {
          const frames = parseInt(frameMatch[1], 10);
          const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0;
          
          // Log progress every 5 seconds
          const now = Date.now();
          if (now - lastProgressTime > 5000) {
            console.log(`[FFmpeg] Progress: ${frames} frames processed, ${fps.toFixed(1)} fps`);
            lastProgressTime = now;
          }
        }
        
        // Clear buffer periodically
        if (stderrBuffer.length > 10000) {
          stderrBuffer = stderrBuffer.slice(-5000);
        }
      });

      // Handle process errors
      ffmpegProcess.on('error', (err) => {
        console.error('[FFmpeg] Process error:', err);
        reject(new Error(`FFmpeg process failed: ${err.message}`));
      });

      // Wait for FFmpeg process to close (100% completion)
      ffmpegProcess.on('close', (code, signal) => {
        if (code === 0) {
          console.log(`[Server Action] ✅ FFmpeg transcoding complete`);
          resolve();
        } else {
          const errorMsg = signal 
            ? `FFmpeg process killed by signal: ${signal}`
            : `FFmpeg process exited with code: ${code}`;
          console.error(`[FFmpeg] ${errorMsg}`);
          console.error(`[FFmpeg] Full stderr output:`, stderrBuffer);
          const errorMatch = stderrBuffer.match(/error:\s*(.+)/i) || stderrBuffer.match(/Error\s+(.+)/i);
          const actualError = errorMatch ? errorMatch[1].trim() : stderrBuffer.slice(-500);
          reject(new Error(`Video transcoding failed: ${errorMsg}. FFmpeg error: ${actualError}`));
        }
      });
    });
    
    // Verify output file exists and has data
    const outputStats = await stat(outputPath);
    if (outputStats.size === 0) {
      throw new Error('Transcoded file is empty on disk');
    }
    const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Transcoded file verified: ${outputSizeMB}MB`);
    
    // Step 3: Correct Google File Upload
    console.log(`[Server Action] Uploading to Google File API...`);
    const fileManager = new GoogleAIFileManager(apiKey);
    
    // Upload the file using fileManager.uploadFile('/tmp/output.mp4', { mimeType: 'video/mp4' })
    const uploadResult = await fileManager.uploadFile(outputPath, {
      mimeType: 'video/mp4',
      displayName: 'ComicScan_Video',
    });
    
    console.log(`[Server Action] File uploaded, URI: ${uploadResult.file.uri}`);
    console.log(`[Server Action] File state: ${uploadResult.file.state}`);
    console.log(`[Server Action] File name: ${uploadResult.file.name}`);
    
    // Polling Fix: After uploadFile, you MUST add a while-loop that calls fileManager.getFile(name)
    // Do not call generateContent until file.state === 'ACTIVE'. If you call it while it is 'PROCESSING', it will throw a 404.
    console.log(`[Server Action] Polling for ACTIVE state...`);
    const pollInterval = 500; // 500ms between polls
    const maxWaitTime = 30000; // 30 seconds max
    const startTime = Date.now();
    
    let activeFile = uploadResult.file;
    let attempt = 0;
    
    // Use while-loop that calls fileManager.getFile(name)
    while (activeFile.state !== 'ACTIVE') {
      // Check timeout
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`File upload timed out - file did not become ACTIVE within ${maxWaitTime / 1000} seconds. Current state: ${activeFile.state}`);
      }
      
      if (activeFile.state === 'FAILED') {
        const errorMsg = activeFile.error?.message || 'Unknown error';
        throw new Error(`File upload failed: ${errorMsg}`);
      }
      
      // Log state every 5 attempts
      if (attempt % 5 === 0) {
        console.log(`[Server Action] File state: ${activeFile.state} (attempt ${attempt + 1})`);
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Call fileManager.getFile(name) to check state
      activeFile = await fileManager.getFile(uploadResult.file.name);
      attempt++;
    }
    
    console.log(`[Server Action] ✅ File is ACTIVE after ${attempt} attempts`);
    
    // Step 4: Model Naming & Call
    // Model ID: Change the model ID to gemini-3-flash-preview. This is the required API string for the December 2025 release.
    console.log(`[Server Action] Using model: gemini-3-flash-preview (December 2025 release)`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview",
      systemInstruction: "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning."
    });
    
    // Add timeout wrapper - Vercel has 300s timeout, so use 280s to be safe
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 280 seconds. The video transcoding or API call took too long. Please try a shorter video.")), 280000);
    });

    // Google Call: Pass the file to the model using: { fileData: { mimeType: 'video/mp4', fileUri: uploadResponse.file.uri } }
    const payload = [
      {
        fileData: {
          mimeType: 'video/mp4',
          fileUri: uploadResult.file.uri
        }
      },
      {
        text: "Analyze this comic book video. Look at all frames to identify the comic and assess its condition."
      }
    ];
    
    console.log(`[Server Action] Sending to Gemini API...`);
    console.log(`[Server Action] File URI: ${uploadResult.file.uri}`);
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
          errorMessage = `API error (${error.message.includes("404") ? "Model not found" : "Unknown"}). Using gemini-3-flash-preview. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try again in a few moments (API may be temporarily unavailable). Original error: ${error.message}`;
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
    // Cleanup: In a finally block, use fs.promises.unlink to delete both /tmp/input.mov and /tmp/output.mp4
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
  }
}
