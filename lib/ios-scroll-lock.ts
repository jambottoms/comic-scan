/**
 * iOS Scroll Lock Utility
 * 
 * Prevents overscroll and background scrolling on iOS Safari.
 * Tracks touch positions and prevents default behavior at scroll boundaries.
 */

interface TouchPosition {
  startY: number;
  startScrollTop: number;
}

/**
 * Create touch handlers to prevent overscroll on iOS
 * 
 * @param scrollContainerRef - Ref to the scrollable container element
 * @returns Object with touchStart and touchMove handlers
 */
export function createScrollLock(scrollContainerRef: React.RefObject<HTMLElement | null>) {
  let touchPosition: TouchPosition | null = null;
  
  const handleTouchStart = (e: React.TouchEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    touchPosition = {
      startY: e.touches[0].clientY,
      startScrollTop: container.scrollTop
    };
  };
  
  const handleTouchMove = (e: React.TouchEvent) => {
    const container = scrollContainerRef.current;
    if (!container || !touchPosition) return;
    
    const currentY = e.touches[0].clientY;
    const deltaY = touchPosition.startY - currentY;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    
    const isAtTop = scrollTop <= 0;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight;
    
    // Prevent overscroll at boundaries
    if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
      e.preventDefault();
    }
  };
  
  return {
    handleTouchStart,
    handleTouchMove
  };
}

/**
 * Lock body scroll (for modal/overlay scenarios)
 */
export function lockBodyScroll() {
  const scrollY = window.scrollY;
  
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
  
  return scrollY;
}

/**
 * Unlock body scroll and restore scroll position
 */
export function unlockBodyScroll(scrollY: number) {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  
  window.scrollTo(0, scrollY);
}

