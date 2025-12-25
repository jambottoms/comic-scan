/**
 * Video normalization pipeline using FFmpeg via child_process.spawn
 * Transcodes videos to H.264, 1080p, no audio, 1 fps for Gemini API
 * 
 * Collects FFmpeg output into a Buffer (not a stream) because Google SDK
 * fileManager.uploadFile doesn't support direct streaming from child process stdout
 */

import { spawn } from 'child_process';
import { Readable } from 'stream';
import { existsSync } from 'fs';
import { chmodSync } from 'fs';
import { loadFfmpegPath } from './ffmpeg-loader';

// Lazy load ffmpeg-static to avoid issues with top-level await
let ffmpegPathCache: string | null = null;

// Get FFmpeg binary path with lazy loading
function getFfmpegPath(): string {
  // Return cached path if available
  if (ffmpegPathCache) {
    return ffmpegPathCache;
  }
  
  try {
    // Load path from separate module to prevent bundler static analysis
    let ffmpegBinaryPath = loadFfmpegPath();
    
    if (!ffmpegBinaryPath || typeof ffmpegBinaryPath !== 'string') {
      throw new Error('ffmpeg-static returned invalid path. The binary may not be available for this platform.');
    }
    
    // On Vercel, paths might be different - try to resolve the actual path
    const originalPath = ffmpegBinaryPath;
    
    // Verify the binary exists
    if (!existsSync(ffmpegBinaryPath)) {
      // Log diagnostic information
      console.error(`[FFmpeg] Binary not found at original path: ${ffmpegBinaryPath}`);
      console.error(`[FFmpeg] CWD: ${process.cwd()}, Platform: ${process.platform}, Arch: ${process.arch}`);
      
      // Try alternative paths for Vercel
      const alternatives = [
        ffmpegBinaryPath.replace(/^\/ROOT\//, process.cwd() + '/'),
        ffmpegBinaryPath.replace(/^\/var\/task\//, process.cwd() + '/'),
      ].filter(Boolean);
      
      for (const altPath of alternatives) {
        if (altPath && existsSync(altPath)) {
          console.log(`[FFmpeg] Found binary at alternative path: ${altPath}`);
          ffmpegBinaryPath = altPath;
          break;
        }
      }
      
      if (!existsSync(ffmpegBinaryPath)) {
        throw new Error(`FFmpeg binary not found at: ${originalPath}. This is likely a Vercel deployment issue. Ensure ffmpeg-static is in dependencies and the binary is included in the build.`);
      }
    }
    
    // Ensure binary is executable
    try {
      chmodSync(ffmpegBinaryPath, 0o755);
    } catch (chmodError) {
      // Ignore - binary is usually already executable
      console.warn(`[FFmpeg] Could not set execute permissions (usually OK)`);
    }
    
    console.log(`[FFmpeg] Binary ready at: ${ffmpegBinaryPath}`);
    ffmpegPathCache = ffmpegBinaryPath;
    return ffmpegBinaryPath;
  } catch (error: any) {
    console.error('[FFmpeg] Failed to load ffmpeg-static:', error);
    throw new Error(`FFmpeg setup failed: ${error?.message || String(error)}. Ensure ffmpeg-static is installed: npm install ffmpeg-static`);
  }
}

export interface NormalizeOptions {
  onProgress?: (progress: { percent: number; frames: number; currentFps: number }) => void;
}

/**
 * Normalize video stream: H.264, 1080p, no audio, 1 fps
 * Returns a Buffer of the normalized video (not a stream)
 * 
 * Uses exact ComicScan optimization flags:
 * -i pipe:0 -c:v libx264 -vf scale=-1:1080,fps=1 -an -f mp4 -movflags frag_keyframe+empty_moov pipe:1
 */
export function normalizeVideoStream(
  inputStream: Readable,
  options: NormalizeOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let ffmpegPath: string;
    try {
      ffmpegPath = getFfmpegPath();
    } catch (error) {
      reject(error);
      return;
    }

    console.log(`[FFmpeg] Starting normalization with spawn (binary: ${ffmpegPath})...`);
    
    // Spawn FFmpeg process with exact ComicScan optimization flags
    const ffmpegProcess = spawn(ffmpegPath, [
      '-i', 'pipe:0',                    // Input from stdin
      '-c:v', 'libx264',                 // H.264 codec
      '-vf', 'scale=-1:1080,fps=1',      // Scale to 1080p height, 1 fps
      '-an',                             // No audio
      '-f', 'mp4',                       // MP4 format
      '-movflags', 'frag_keyframe+empty_moov', // Streaming optimization
      'pipe:1'                           // Output to stdout
    ], {
      stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    // Collect FFmpeg stdout chunks into array
    const chunks: Buffer[] = [];
    
    ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
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

    // CRITICAL: Wait for FFmpeg process to close (not just end)
    // The 'close' event ensures all file descriptors are closed and data is fully flushed
    ffmpegProcess.on('close', (code, signal) => {
      if (code === 0) {
        // Combine chunks into single Buffer
        const videoBuffer = Buffer.concat(chunks);
        const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
        console.log(`[FFmpeg] Normalization complete: ${fileSizeMB}MB (${chunks.length} chunks)`);
        
        if (videoBuffer.length === 0) {
          reject(new Error('FFmpeg produced empty output'));
          return;
        }
        
        resolve(videoBuffer);
      } else {
        const errorMsg = signal 
          ? `FFmpeg process killed by signal: ${signal}`
          : `FFmpeg process exited with code: ${code}`;
        console.error(`[FFmpeg] ${errorMsg}`);
        console.error(`[FFmpeg] stderr: ${stderrBuffer.slice(-1000)}`); // Last 1000 chars
        reject(new Error(`Video normalization failed: ${errorMsg}`));
      }
    });

    // Handle input stream errors
    inputStream.on('error', (err) => {
      console.error('[FFmpeg] Input stream error:', err);
      ffmpegProcess.kill('SIGKILL');
      reject(new Error(`Input stream error: ${err.message}`));
    });

    // Pipe input stream to FFmpeg stdin
    inputStream.pipe(ffmpegProcess.stdin);
    
    // Handle stdin errors
    ffmpegProcess.stdin.on('error', (err) => {
      console.error('[FFmpeg] stdin error:', err);
      // Don't reject here, let the process handle it
    });
  });
}

/**
 * Normalize video from a URL (downloads and normalizes)
 * Returns a Buffer of the normalized video
 */
export async function normalizeVideoFromUrl(
  videoUrl: string,
  options: NormalizeOptions = {}
): Promise<Buffer> {
  console.log(`[Video Normalize] Downloading video from: ${videoUrl}`);
  
  // Download video as stream (not ArrayBuffer to save memory)
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

  // Convert Web ReadableStream to Node.js Readable stream
  // @ts-ignore - Readable.fromWeb is available in Node.js 18+
  const inputStream = Readable.fromWeb(response.body);
  
  console.log(`[Video Normalize] Starting FFmpeg normalization...`);
  return normalizeVideoStream(inputStream, options);
}

