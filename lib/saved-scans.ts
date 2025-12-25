/**
 * Saved scans management using Supabase database
 */

import { createClient } from './supabase/client';

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
    const supabase = createClient();
    
    // If Supabase is not configured, return empty array gracefully
    if (!supabase) {
      return [];
    }
    
    let query = supabase
      .from('saved_scans')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (limit) {
      query = query.limit(limit);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to fetch saved scans:', error);
      return [];
    }
    
    return data || [];
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
    const supabase = createClient();
    
    if (!supabase) {
      return null;
    }
    
    const { data, error } = await supabase
      .from('saved_scans')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Failed to fetch saved scan:', error);
      return null;
    }
    
    return data;
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
    const supabase = createClient();
    
    if (!supabase) {
      console.warn('[SavedScans] Cannot save - Supabase not configured');
      return null;
    }
    
    const { data, error } = await supabase
      .from('saved_scans')
      .insert({
        title: input.title,
        issue: input.issue || null,
        grade: input.grade,
        video_url: input.videoUrl || null,
        thumbnail: input.thumbnail || null,
        result: input.result,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Failed to save scan:', error);
      return null;
    }
    
    return data;
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
    const supabase = createClient();
    
    if (!supabase) {
      return false;
    }
    
    const { error } = await supabase
      .from('saved_scans')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Failed to delete saved scan:', error);
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
    const supabase = createClient();
    
    if (!supabase) {
      return null;
    }
    
    const { data, error } = await supabase
      .from('saved_scans')
      .select('id')
      .eq('title', title)
      .eq('issue', issue)
      .eq('grade', grade)
      .limit(1);
    
    if (error || !data || data.length === 0) {
      return null;
    }
    
    return data[0].id;
  } catch (error) {
    console.error('Failed to check if scan is saved:', error);
    return null;
  }
}

