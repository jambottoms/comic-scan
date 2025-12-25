/**
 * Saved scans management - uses API routes to proxy Supabase calls
 * This prevents Arc Browser's privacy features from blocking requests
 */

export interface SavedScan {
  id: string;
  title: string;
  issue: string | null;
  grade: string;
  video_url: string | null;
  thumbnail: string | null;
  result: any;
  created_at: string;
  updated_at: string;
}

export interface SaveScanInput {
  title: string;
  issue?: string;
  grade: string;
  videoUrl?: string;
  thumbnail?: string;
  result: any;
}

/**
 * Get all saved scans, ordered by newest first
 */
export async function getSavedScans(limit?: number): Promise<SavedScan[]> {
  try {
    const url = limit ? `/api/saved-scans?limit=${limit}` : '/api/saved-scans';
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('Failed to fetch saved scans:', response.statusText);
      return [];
    }
    
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Failed to fetch saved scans:', error);
    return [];
  }
}

/**
 * Get a specific saved scan by ID
 */
export async function getSavedScanById(id: string): Promise<SavedScan | null> {
  try {
    const response = await fetch(`/api/saved-scans/${id}`);
    
    if (!response.ok) {
      console.error('Failed to fetch saved scan:', response.statusText);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch saved scan:', error);
    return null;
  }
}

/**
 * Save a new scan to the database
 */
export async function saveScan(input: SaveScanInput): Promise<SavedScan | null> {
  try {
    const response = await fetch('/api/saved-scans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    
    if (!response.ok) {
      console.error('Failed to save scan:', response.statusText);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to save scan:', error);
    return null;
  }
}

/**
 * Delete a saved scan from the database
 */
export async function deleteSavedScan(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/saved-scans/${id}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      console.error('Failed to delete saved scan:', response.statusText);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Failed to delete saved scan:', error);
    return false;
  }
}

/**
 * Check if a scan is already saved (by matching title, issue, and grade)
 */
export async function isScanSaved(title: string, issue: string, grade: string): Promise<string | null> {
  try {
    const response = await fetch('/api/saved-scans/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, issue, grade }),
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.savedId || null;
  } catch (error) {
    console.error('Failed to check if scan is saved:', error);
    return null;
  }
}
