/**
 * Real-time Progress Polling Hook
 * 
 * Polls the Supabase analysis_jobs table for progress updates
 * during CV analysis and displays them in the UI.
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface ProgressState {
  percentage: number;
  message: string;
  step: string;
  isComplete: boolean;
}

export function useProgressPolling(jobId: string, enabled: boolean = true) {
  const [progress, setProgress] = useState<ProgressState>({
    percentage: 0,
    message: 'Initializing...',
    step: 'init',
    isComplete: false
  });
  
  useEffect(() => {
    if (!enabled || !jobId) {
      console.log('[Progress Poll] Hook disabled or no jobId', { enabled, jobId });
      return;
    }
    
    console.log('[Progress Poll] Starting polling for job:', jobId);
    const supabase = createClient();
    
    if (!supabase) {
      console.warn('[Progress Poll] Supabase client not available');
      return;
    }
    
    // Poll every 2 seconds
    const pollInterval = setInterval(async () => {
      try {
        console.log('[Progress Poll] Polling for job:', jobId);
        
        const { data, error } = await supabase
          .from('analysis_jobs')
          .select('progress_percentage, progress_message, progress_step, cv_status')
          .eq('id', jobId)
          .single();
        
        if (error) {
          console.warn('[Progress Poll] Error:', error.message);
          return;
        }
        
        if (data) {
          console.log('[Progress Poll] Data received:', data);
          
          const isComplete = data.cv_status === 'complete' || data.progress_percentage === 100;
          
          setProgress({
            percentage: data.progress_percentage || 0,
            message: data.progress_message || 'Processing...',
            step: data.progress_step || 'unknown',
            isComplete
          });
          
          // Stop polling when complete
          if (isComplete) {
            console.log('[Progress Poll] Complete! Stopping polling.');
            clearInterval(pollInterval);
          }
        } else {
          console.warn('[Progress Poll] No data found for job:', jobId);
        }
      } catch (err) {
        console.error('[Progress Poll] Exception:', err);
      }
    }, 2000);
    
    // Cleanup on unmount
    return () => clearInterval(pollInterval);
  }, [jobId, enabled]);
  
  return progress;
}

