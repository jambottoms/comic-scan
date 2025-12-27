/**
 * Client-side Frame Extractor
 * 
 * Extracts golden frames from a video using HTML5 video + canvas.
 * Fast, runs in browser, no server needed.
 */

export interface ExtractedFrame {
  dataUrl: string;
  timestamp: number;
  timestampFormatted: string;
}

/**
 * Extract evenly-spaced frames from a video URL.
 * 
 * @param videoUrl - URL of the video
 * @param numFrames - Number of frames to extract (default: 5)
 * @returns Promise with extracted frame data URLs and timestamps
 */
export async function extractFramesFromVideo(
  videoUrl: string,
  numFrames: number = 5
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    
    let duration = 0;
    const frames: ExtractedFrame[] = [];
    const timestamps: number[] = [];
    
    video.onloadedmetadata = () => {
      duration = video.duration;
      
      // Calculate evenly-spaced timestamps
      // Skip first and last 10% to avoid intro/outro
      const startTime = duration * 0.1;
      const endTime = duration * 0.9;
      const interval = (endTime - startTime) / (numFrames - 1);
      
      for (let i = 0; i < numFrames; i++) {
        timestamps.push(startTime + (interval * i));
      }
      
      // Start extracting
      extractNextFrame();
    };
    
    video.onerror = () => {
      reject(new Error('Failed to load video for frame extraction'));
    };
    
    const extractNextFrame = () => {
      if (timestamps.length === 0) {
        // Done!
        resolve(frames);
        return;
      }
      
      const timestamp = timestamps.shift()!;
      video.currentTime = timestamp;
    };
    
    video.onseeked = () => {
      // Create canvas to capture frame
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      
      // Use video's natural dimensions, but cap at 800px width for performance
      const maxWidth = 800;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      
      // Draw the frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to data URL (JPEG for smaller size)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      // Format timestamp
      const mins = Math.floor(video.currentTime / 60);
      const secs = Math.floor(video.currentTime % 60);
      const timestampFormatted = `${mins}:${secs.toString().padStart(2, '0')}`;
      
      frames.push({
        dataUrl,
        timestamp: video.currentTime,
        timestampFormatted,
      });
      
      // Extract next frame
      extractNextFrame();
    };
    
    // Set timeout for entire operation
    const timeout = setTimeout(() => {
      reject(new Error('Frame extraction timed out'));
    }, 30000); // 30 second timeout
    
    // Override resolve to clear timeout
    const originalResolve = resolve;
    resolve = (value) => {
      clearTimeout(timeout);
      originalResolve(value);
    };
    
    // Start loading video
    video.src = videoUrl;
  });
}

/**
 * Format a timestamp in seconds to MM:SS string.
 */
export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

