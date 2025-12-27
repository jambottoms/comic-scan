/**
 * Video history management using localStorage
 */

export interface VideoHistoryItem {
  id: string;
  title: string;
  issue: string;
  grade: string;
  videoUrl: string | null;
  result: any;
  timestamp: number;
  thumbnail?: string; // Base64 thumbnail or URL
}

const STORAGE_KEY = 'comic-scan-history';
const MAX_HISTORY = 50; // Keep last 50 items

/**
 * Get all video history items
 */
export function getVideoHistory(): VideoHistoryItem[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const history = JSON.parse(stored) as VideoHistoryItem[];
    // Sort by timestamp, newest first
    return history.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Failed to load video history:', error);
    return [];
  }
}

/**
 * Add a new video to history
 */
export function addToHistory(item: Omit<VideoHistoryItem, 'id' | 'timestamp'>): string {
  if (typeof window === 'undefined') return '';
  
  try {
    const history = getVideoHistory();
    const newItem: VideoHistoryItem = {
      ...item,
      id: `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    
    // Add to beginning
    history.unshift(newItem);
    
    // Limit to MAX_HISTORY items
    const limited = history.slice(0, MAX_HISTORY);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
    return newItem.id;
  } catch (error) {
    console.error('Failed to save video history:', error);
    return '';
  }
}

/**
 * Get a specific video by ID
 */
export function getVideoById(id: string): VideoHistoryItem | null {
  const history = getVideoHistory();
  return history.find(item => item.id === id) || null;
}

/**
 * Update an existing history entry
 */
export function updateHistoryEntry(id: string, updates: Partial<VideoHistoryItem>): void {
  if (typeof window === 'undefined') return;
  
  try {
    const history = getVideoHistory();
    const index = history.findIndex(item => item.id === id);
    
    if (index !== -1) {
      history[index] = { ...history[index], ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  } catch (error) {
    console.error('Failed to update video history:', error);
  }
}

/**
 * Delete a video from history
 */
export function deleteFromHistory(id: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const history = getVideoHistory();
    const filtered = history.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to delete video from history:', error);
  }
}

/**
 * Clear all history
 */
export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear video history:', error);
  }
}

/**
 * Generate thumbnail from video URL (creates a base64 thumbnail)
 */
export async function generateThumbnail(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;
    video.currentTime = 1; // Seek to 1 second
    
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        resolve(thumbnail);
      } else {
        resolve(null);
      }
    };
    
    video.onerror = () => resolve(null);
    
    // Timeout after 5 seconds
    setTimeout(() => resolve(null), 5000);
  });
}

