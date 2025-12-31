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
    
    let pollInterval: NodeJS.Timeout | null = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    
    // Query function with retry logic
    const queryProgress = async () => {
      try {
        console.log('[Progress Poll] Polling for job:', jobId);
        
        const { data, error } = await supabase
          .from('analysis_jobs')
          .select('progress_percentage, progress_message, progress_step, cv_status, status')
          .eq('id', jobId)
          .single();
        
        if (error) {
          console.warn('[Progress Poll] Error:', error.message);
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            console.error('[Progress Poll] Max retries reached, stopping polling');
            if (pollInterval) clearInterval(pollInterval);
          }
          return;
        }
        
        // Reset retry count on success
        retryCount = 0;
        
        if (data) {
          console.log('[Progress Poll] Data received:', {
            percentage: data.progress_percentage,
            message: data.progress_message,
            step: data.progress_step,
            cv_status: data.cv_status,
            status: data.status
          });
          
          // Check multiple completion signals
          const isComplete = 
            data.cv_status === 'complete' || 
            data.status === 'complete' ||
            data.progress_percentage === 100;
          
          const newProgress = {
            percentage: data.progress_percentage || 0,
            message: data.progress_message || 'Processing...',
            step: data.progress_step || 'unknown',
            isComplete
          };
          
          console.log('[Progress Poll] Setting progress state:', newProgress);
          setProgress(newProgress);
          
          // Stop polling when complete
          if (isComplete) {
            console.log('[Progress Poll] Complete! Stopping polling.');
            if (pollInterval) clearInterval(pollInterval);
          }
        } else {
          console.warn('[Progress Poll] No data found for job:', jobId);
        }
      } catch (err) {
        console.error('[Progress Poll] Exception:', err);
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          console.error('[Progress Poll] Max retries reached, stopping polling');
          if (pollInterval) clearInterval(pollInterval);
        }
      }
    };
    
    // Immediate query on mount (don't wait for interval)
    queryProgress();
    
    // Poll every 1 second for faster updates on mobile
    pollInterval = setInterval(queryProgress, 1000);
    
    // Add visibility change listener to resume polling when tab refocuses (iOS Safari optimization)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Progress Poll] Tab visible, querying immediately');
        queryProgress();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup on unmount
    return () => {
      if (pollInterval) clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [jobId, enabled]);
  
  return progress;
}

