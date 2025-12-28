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
    // Try without crossOrigin first for same-origin videos
    // This avoids CORS issues for videos from the same domain
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true; // Required for iOS
    
    let duration = 0;
    const frames: ExtractedFrame[] = [];
    const timestamps: number[] = [];
    let corsAttempted = false;
    
    const handleError = () => {
      // If first attempt failed and we haven't tried with CORS, try with crossOrigin
      if (!corsAttempted && !video.crossOrigin) {
        console.log('[FrameExtractor] Retrying with crossOrigin=anonymous');
        corsAttempted = true;
        video.crossOrigin = 'anonymous';
        video.src = videoUrl;
        return;
      }
      
      console.warn('[FrameExtractor] Video loading failed (CORS or network error)');
      // Resolve with empty array instead of rejecting - graceful degradation
      resolve([]);
    };
    
    video.onloadedmetadata = () => {
      duration = video.duration;
      
      if (!duration || duration <= 0) {
        console.warn('[FrameExtractor] Invalid video duration');
        resolve([]);
        return;
      }
      
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
    
    video.onerror = handleError;
    
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
      try {
        // Create canvas to capture frame
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.warn('[FrameExtractor] Canvas context not available');
          extractNextFrame(); // Skip this frame, try next
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
        // This can throw a SecurityError if CORS is not properly configured
        let dataUrl: string;
        try {
          dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        } catch (securityError) {
          console.warn('[FrameExtractor] Canvas tainted - CORS issue, skipping frames');
          // Return whatever frames we have so far
          resolve(frames);
          return;
        }
        
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
      } catch (err) {
        console.warn('[FrameExtractor] Error extracting frame:', err);
        extractNextFrame(); // Try next frame
      }
    };
    
    // Set timeout for entire operation
    const timeout = setTimeout(() => {
      console.warn('[FrameExtractor] Timed out, returning partial results');
      resolve(frames); // Return what we have instead of rejecting
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

