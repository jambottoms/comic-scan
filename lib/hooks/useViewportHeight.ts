'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to get the actual viewport height accounting for mobile browser chrome/address bars.
 * Updates on resize and orientation change.
 * 
 * Returns:
 * - viewportHeight: The actual viewport height in pixels (number)
 * - vh: CSS custom property value string for use in inline styles (e.g., '100vh' or 'calc(var(--vh, 1vh) * 100)')
 */
export function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );

  useEffect(() => {
    // Function to update viewport height
    const updateHeight = () => {
      const height = window.innerHeight;
      setViewportHeight(height);
      
      // Set CSS custom property for use in stylesheets
      // 1vh = 1% of viewport height
      document.documentElement.style.setProperty('--vh', `${height * 0.01}px`);
    };

    // Initial update
    updateHeight();

    // Update on resize
    window.addEventListener('resize', updateHeight);
    
    // Update on orientation change (mobile devices)
    window.addEventListener('orientationchange', updateHeight);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
    };
  }, []);

  return {
    viewportHeight,
    // Return a CSS value that can be used in inline styles
    vh: `calc(var(--vh, 1vh) * 100)`
  };
}


