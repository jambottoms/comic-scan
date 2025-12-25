/**
 * Video normalization pipeline for Next.js ESM on Vercel
 * Uses physical files instead of streams for better FFmpeg compatibility
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { existsSync, chmodSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';

// Use createRequire for ESM compatibility
const require = createRequire(import.meta.url);

export interface NormalizeOptions {
  onProgress?: (progress: { percent: number; frames: number; currentFps: number }) => void;
}

/**
 * Get FFmpeg binary path using createRequire for ESM
 */
function getFfmpegPath(): string {
  try {
    // Load ffmpeg-static using require (works in ESM with createRequire)
    const ffmpegStatic = require('ffmpeg-static');
    
    // Handle different export formats
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
    
    // Resolve the path to ensure it works on Vercel
    ffmpegPath = path.resolve(ffmpegPath);
    
    // Verify binary exists
    if (!existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg binary not found at: ${ffmpegPath}. Ensure ffmpeg-static is installed.`);
    }
    
    // Ensure binary is executable
    try {
      chmodSync(ffmpegPath, 0o755);
    } catch (chmodError) {
      // Ignore - binary is usually already executable
      console.warn(`[FFmpeg] Could not set execute permissions (usually OK)`);
    }
    
    console.log(`[FFmpeg] Binary ready at: ${ffmpegPath}`);
    return ffmpegPath;
  } catch (error: any) {
    console.error('[FFmpeg] Failed to load ffmpeg-static:', error);
    throw new Error(`FFmpeg setup failed: ${error?.message || String(error)}`);
  }
}

/**
 * Normalize video from a URL using two-step file process
 * 1. Download raw video to /tmp/raw_input.mov
 * 2. Run FFmpeg on physical file to /tmp/normalized.mp4
 * 
 * Flags: -c:v libx264 -vf scale=-1:1080,fps=1 -an -f mp4
 */
export async function normalizeVideoFromUrl(
  videoUrl: string,
  options: NormalizeOptions = {}
): Promise<void> {
  const rawInputPath = '/tmp/raw_input.mov';
  const normalizedPath = '/tmp/normalized.mp4';
  
  console.log(`[Video Normalize] Downloading video from: ${videoUrl}`);
  
  // Step 1: Download raw video from Supabase to /tmp/raw_input.mov
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

  // Read the entire response into a buffer
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  console.log(`[Video Normalize] Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)}MB, writing to ${rawInputPath}`);
  
  // Write raw video to temporary file
  await writeFile(rawInputPath, buffer);
  console.log(`[Video Normalize] Raw video saved to ${rawInputPath}`);
  
  // Step 2: Run FFmpeg on the physical file
  const ffmpegPath = getFfmpegPath();
  
  console.log(`[Video Normalize] Starting FFmpeg normalization...`);
  console.log(`[FFmpeg] Input: ${rawInputPath}, Output: ${normalizedPath}`);
  
  return new Promise((resolve, reject) => {
    // Spawn FFmpeg process with physical file paths
    const ffmpegProcess = spawn(ffmpegPath, [
      '-y',                              // Overwrite output file
      '-i', rawInputPath,                // Input from physical file
      '-c:v', 'libx264',                 // H.264 codec
      '-vf', 'scale=-1:1080,fps=1',      // Scale to 1080p height, 1 fps
      '-an',                             // No audio
      '-f', 'mp4',                       // MP4 format
      normalizedPath                     // Output to physical file
    ], {
      stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout/stderr piped
    });

    // Handle FFmpeg stderr for progress/logging
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
          
          if (options.onProgress) {
            options.onProgress({
              percent: 0, // FFmpeg doesn't provide percent
              frames: frames,
              currentFps: fps,
            });
          }
        }
      }
      
      // Clear buffer periodically to avoid memory issues
      if (stderrBuffer.length > 10000) {
        stderrBuffer = stderrBuffer.slice(-5000);
      }
    });

    // Handle process errors
    ffmpegProcess.on('error', (err) => {
      console.error('[FFmpeg] Process error:', err);
      reject(new Error(`FFmpeg process failed: ${err.message}`));
    });

    // Wait for FFmpeg process to close
    ffmpegProcess.on('close', (code, signal) => {
      if (code === 0) {
        console.log(`[FFmpeg] Normalization complete: ${normalizedPath}`);
        resolve();
      } else {
        const errorMsg = signal 
          ? `FFmpeg process killed by signal: ${signal}`
          : `FFmpeg process exited with code: ${code}`;
        console.error(`[FFmpeg] ${errorMsg}`);
        console.error(`[FFmpeg] Full stderr output:`, stderrBuffer);
        // Extract the actual error message from stderr if possible
        const errorMatch = stderrBuffer.match(/error:\s*(.+)/i) || stderrBuffer.match(/Error\s+(.+)/i);
        const actualError = errorMatch ? errorMatch[1].trim() : stderrBuffer.slice(-500);
        reject(new Error(`Video normalization failed: ${errorMsg}. FFmpeg error: ${actualError}`));
      }
    });
  });
}
