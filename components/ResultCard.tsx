'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { Bookmark, BookmarkCheck, Trash2, Loader2 } from 'lucide-react';
import VideoInvestigatorModal from './VideoInvestigatorModal';
import { saveScan, deleteSavedScan, isScanSaved } from '@/lib/saved-scans';

interface ResultCardProps {
  result: any;
  videoUrl: string | null;
  thumbnail?: string;
  savedScanId?: string; // If viewing from saved scans
  onDelete?: () => void; // Callback when deleted from saved
  embedded?: boolean; // If true, remove internal padding/margins that might conflict with sheet
}

export default function ResultCard({ result, videoUrl, thumbnail, savedScanId, onDelete, embedded = false }: ResultCardProps) {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [investigatorOpen, setInvestigatorOpen] = useState(false);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>(0);
  
  // Save state
  const [isSaved, setIsSaved] = useState(!!savedScanId);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(savedScanId || null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const grade = result.estimatedGrade || 'N/A';
  const title = result.title || "Unknown Comic";
  const issueNum = result.issue ? `${result.issue}` : "";
  
  // Check if this scan is already saved on mount
  useEffect(() => {
    const checkSaved = async () => {
      if (!savedScanId && title && issueNum && grade) {
        const existingId = await isScanSaved(title, issueNum, grade);
        if (existingId) {
          setIsSaved(true);
          setCurrentSavedId(existingId);
        }
      }
    };
    checkSaved();
  }, [savedScanId, title, issueNum, grade]);
  
  // Handle saving
  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    
    try {
      const saved = await saveScan({
        title: title,
        issue: issueNum,
        grade: grade,
        videoUrl: videoUrl || undefined,
        thumbnail: thumbnail,
        result: result,
      });
      
      if (saved) {
        setIsSaved(true);
        setCurrentSavedId(saved.id);
      }
    } catch (error) {
      console.error('Failed to save scan:', error);
    } finally {
      setIsSaving(false);
    }
  };
  
  // Handle unsaving/deleting
  const handleUnsave = async () => {
    if (isDeleting || !currentSavedId) return;
    setIsDeleting(true);
    
    try {
      const success = await deleteSavedScan(currentSavedId);
      if (success) {
        setIsSaved(false);
        setCurrentSavedId(null);
        if (onDelete) {
          onDelete();
        }
      }
    } catch (error) {
      console.error('Failed to delete saved scan:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Function to open Video Investigator modal at timestamp
  const openInvestigator = (seconds: number) => {
    setSelectedTimestamp(seconds);
    setInvestigatorOpen(true);
  };

  // Parse timestamp from text (supports formats like "0:15", "15s", "1:30", etc.)
  const parseTimestamp = (text: string): number | null => {
    // Try MM:SS or HH:MM:SS format first
    const timeColonMatch = text.match(/(\d+):(\d+)/);
    if (timeColonMatch) {
      const minutes = parseInt(timeColonMatch[1], 10);
      const seconds = parseInt(timeColonMatch[2], 10);
      return minutes * 60 + seconds;
    }

    // Try 1m 30s format
    const minSecMatch = text.match(/(\d+)m\s*(\d+)s/i);
    if (minSecMatch) {
      const minutes = parseInt(minSecMatch[1], 10);
      const seconds = parseInt(minSecMatch[2], 10);
      return minutes * 60 + seconds;
    }

    // Try 15s format
    const secMatch = text.match(/(\d+)s/i);
    if (secMatch) {
      return parseInt(secMatch[1], 10);
    }

    // Try 1m format
    const minMatch = text.match(/(\d+)m/i);
    if (minMatch) {
      return parseInt(minMatch[1], 10) * 60;
    }

    return null;
  };

  // Parse reasoning into summary and bullet points with timestamps
  const parseReasoning = (reasoning: any) => {
    if (!reasoning) return { summary: '', bullets: [] };
    
    // Convert reasoning to string if it's not already
    let reasoningText: string;
    if (typeof reasoning === 'string') {
      reasoningText = reasoning;
    } else if (typeof reasoning === 'object') {
      // If it's an object, try to stringify it or extract text
      if (reasoning.text) {
        reasoningText = String(reasoning.text);
      } else if (reasoning.content) {
        reasoningText = String(reasoning.content);
      } else if (reasoning.reasoning) {
        reasoningText = String(reasoning.reasoning);
      } else {
        // Try to stringify the whole object
        reasoningText = JSON.stringify(reasoning, null, 2);
      }
    } else {
      reasoningText = String(reasoning);
    }
    
    console.log('[Parse] Original reasoning:', reasoningText);
    
    // First, try to split by newlines or bullet points (more reliable for structured text)
    const lines = reasoningText.split(/\n+/).filter(l => l.trim().length > 0);
    
    // If we have multiple lines, use them as bullets
    if (lines.length > 1) {
      // First line or two as summary
      const summaryLines = lines.slice(0, Math.min(2, lines.length));
      const summary = summaryLines.join(' ').trim();
      
      // Rest as bullets
      const bullets = lines.slice(summaryLines.length).map(line => {
        const trimmed = line.trim().replace(/^[-•*]\s*/, '');
        if (!trimmed) return null;
        
        // Try to extract timestamp (preserve original text)
        const timestamp = parseTimestamp(trimmed);
        
        // Remove timestamp from text for cleaner display, but be more careful
        let displayText = trimmed;
        if (timestamp !== null) {
          // Only remove the specific timestamp pattern we found, not all numbers
          // This is more conservative to avoid removing important numbers
          const timeColonMatch = trimmed.match(/(\d+):(\d+)/);
          if (timeColonMatch) {
            displayText = trimmed.replace(timeColonMatch[0], '').trim();
          } else {
            const minSecMatch = trimmed.match(/(\d+)m\s*(\d+)s/i);
            if (minSecMatch) {
              displayText = trimmed.replace(minSecMatch[0], '').trim();
            } else {
              const secMatch = trimmed.match(/(\d+)s/i);
              if (secMatch) {
                displayText = trimmed.replace(secMatch[0], '').trim();
              } else {
                const minMatch = trimmed.match(/(\d+)m/i);
                if (minMatch) {
                  displayText = trimmed.replace(minMatch[0], '').trim();
                }
              }
            }
          }
          // Clean up extra spaces and punctuation
          displayText = displayText.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
        }
        
        console.log('[Parse] Line:', trimmed, 'Timestamp:', timestamp, 'Display:', displayText);
        
        return {
          text: displayText || trimmed, // Fallback to original if we removed everything
          timestamp: timestamp
        };
      }).filter((b): b is { text: string; timestamp: number | null } => b !== null);
      
      return { summary, bullets };
    }
    
    // Fallback: Split by sentences
    const sentences = reasoningText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    // First 1-2 sentences as summary
    const summary = sentences.slice(0, 2).join('. ').trim() + (sentences.length > 2 ? '.' : '');
    
    // Rest as bullet points with timestamp extraction
    const bullets = sentences.slice(2).map(s => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      
      // Try to extract timestamp
      const timestamp = parseTimestamp(trimmed);
      
      // Remove timestamp from text for display (conservative approach)
      let displayText = trimmed;
      if (timestamp !== null) {
        const timeColonMatch = trimmed.match(/(\d+):(\d+)/);
        if (timeColonMatch) {
          displayText = trimmed.replace(timeColonMatch[0], '').trim();
        } else {
          const minSecMatch = trimmed.match(/(\d+)m\s*(\d+)s/i);
          if (minSecMatch) {
            displayText = trimmed.replace(minSecMatch[0], '').trim();
          } else {
            const secMatch = trimmed.match(/(\d+)s/i);
            if (secMatch) {
              displayText = trimmed.replace(secMatch[0], '').trim();
            } else {
              const minMatch = trimmed.match(/(\d+)m/i);
              if (minMatch) {
                displayText = trimmed.replace(minMatch[0], '').trim();
              }
            }
          }
        }
        displayText = displayText.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
      }
      
      return {
        text: displayText || trimmed,
        timestamp: timestamp
      };
    }).filter((b): b is { text: string; timestamp: number | null } => b !== null);
    
    // If no clear sentence breaks, try to split by newlines or create bullets from paragraphs
    if (bullets.length === 0 && sentences.length <= 2) {
      // Try splitting by newlines or common separators
      const paragraphs = reasoningText.split(/\n\n|\n/).filter(p => p.trim().length > 0);
      if (paragraphs.length > 1) {
        return {
          summary: paragraphs[0].trim(),
          bullets: paragraphs.slice(1).map(p => {
            const trimmed = p.trim().replace(/^[-•*]\s*/, '');
            const timestamp = parseTimestamp(trimmed);
            let displayText = trimmed;
            if (timestamp !== null) {
              displayText = trimmed
                .replace(/\d+:\d+/g, '')
                .replace(/\d+s/gi, '')
                .replace(/\d+m\s*\d+s/gi, '')
                .replace(/\d+m/gi, '')
                .trim()
                .replace(/\s+/g, ' ');
            }
            return { text: displayText, timestamp };
          })
        };
      }
      // If still no bullets, create them from the reasoning text
      const parts = reasoningText.split(/[;:]/).filter(p => p.trim().length > 0);
      if (parts.length > 1) {
        return {
          summary: parts[0].trim(),
          bullets: parts.slice(1).map(p => {
            const trimmed = p.trim();
            const timestamp = parseTimestamp(trimmed);
            let displayText = trimmed;
            if (timestamp !== null) {
              displayText = trimmed
                .replace(/\d+:\d+/g, '')
                .replace(/\d+s/gi, '')
                .replace(/\d+m\s*\d+s/gi, '')
                .replace(/\d+m/gi, '')
                .trim()
                .replace(/\s+/g, ' ');
            }
            return { text: displayText, timestamp };
          })
        };
      }
    }
    
    return { summary, bullets };
  };

  const { summary, bullets } = result.reasoning ? parseReasoning(result.reasoning) : { summary: '', bullets: [] };
  const issue = result.issue ? `#${result.issue}` : "Unknown Issue";

  return (
    <div className={`w-full max-w-2xl flex flex-col items-center ${embedded ? '' : 'min-h-screen bg-gray-900 text-white p-4 overflow-y-auto'}`}>
      {/* Back to Dashboard Button - Only if NOT embedded */}
      {!embedded && (
        <div className="w-full max-w-2xl mb-4">
          <Link
            href="/"
            className="inline-flex items-center text-purple-400 hover:text-purple-300 transition-colors text-sm font-medium"
          >
            ← Back to Dashboard
          </Link>
        </div>
      )}

      {/* Video Preview - Show above results in smaller landscape box */}
      {videoUrl && (
        <div className="mb-6 w-full max-w-2xl">
          <p className="text-gray-400 text-sm mb-2 text-center">Video Preview:</p>
          <div className="relative w-full" style={{ aspectRatio: '16/9', maxHeight: '400px' }}>
            <video 
              ref={previewVideoRef}
              src={videoUrl} 
              controls 
              className="w-full h-full rounded-xl border border-gray-700 object-contain cursor-pointer"
              onPlay={(e) => {
                // Request fullscreen when video starts playing
                const video = e.currentTarget;
                // Small delay to ensure video is actually playing
                setTimeout(() => {
                  if (video.requestFullscreen) {
                    video.requestFullscreen().catch(err => {
                      console.log('Fullscreen request failed:', err);
                    });
                  } else if ((video as any).webkitRequestFullscreen) {
                    (video as any).webkitRequestFullscreen();
                  } else if ((video as any).mozRequestFullScreen) {
                    (video as any).mozRequestFullScreen();
                  } else if ((video as any).msRequestFullscreen) {
                    (video as any).msRequestFullscreen();
                  }
                }, 100);
              }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}

      {/* The Result Card - CGC Slab Style */}
      <div className="bg-gray-800 p-6 rounded-xl border-2 border-purple-500 max-w-2xl w-full shadow-2xl mb-4">
        {/* CGC Slab Style Header */}
        <div className="bg-gradient-to-b from-gray-900 to-gray-800 border-2 border-gray-600 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-yellow-400 mb-1">
                {title}
              </h2>
              <p className="text-gray-400 text-sm">
                Issue {issue}
              </p>
            </div>
            {/* Large Grade Display - CGC Style */}
            <div className="text-center ml-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Grade</div>
              <div className="text-5xl font-bold text-green-400 leading-none">
                {grade}
              </div>
            </div>
          </div>
          
          {/* Save/Unsave Button */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
            {isSaved ? (
              <button
                onClick={handleUnsave}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-red-600/30 text-purple-400 hover:text-red-400 rounded-lg transition-all text-sm font-medium group"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <BookmarkCheck className="w-4 h-4 group-hover:hidden" />
                    <Trash2 className="w-4 h-4 hidden group-hover:block" />
                  </>
                )}
                <span className="group-hover:hidden">Saved</span>
                <span className="hidden group-hover:inline">Remove</span>
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-purple-600/30 text-gray-300 hover:text-purple-400 rounded-lg transition-all text-sm font-medium"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Bookmark className="w-4 h-4" />
                )}
                {isSaving ? 'Saving...' : 'Save to Collection'}
              </button>
            )}
          </div>
        </div>

        {/* Summary Section */}
        {summary && (
          <div className="mb-4 pb-4 border-b border-gray-700">
            <p className="text-gray-300 text-sm leading-relaxed">
              {summary}
            </p>
          </div>
        )}

        {/* Grading Details - Bullet Points */}
        {bullets.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Grading Details
            </h3>
            <ul className="space-y-2">
              {bullets.map((bullet: { text: string; timestamp: number | null }, index: number) => {
                // Format timestamp for display
                const formatTimestamp = (seconds: number): string => {
                  const mins = Math.floor(seconds / 60);
                  const secs = Math.floor(seconds % 60);
                  return `${mins}:${secs.toString().padStart(2, '0')}`;
                };

                return (
                  <li key={index} className="flex items-start text-gray-300 text-sm">
                    <span className="text-purple-400 mr-2 mt-1">•</span>
                    <span className="flex-1">
                      {bullet.text}
                      {bullet.timestamp !== null && (
                        <button
                          onClick={() => openInvestigator(bullet.timestamp!)}
                          className="ml-2 text-purple-400 hover:text-purple-300 underline text-xs font-medium transition-colors"
                          title={`View frame at ${formatTimestamp(bullet.timestamp)}`}
                        >
                          [{formatTimestamp(bullet.timestamp)}]
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Fallback for unstructured data */}
        {!summary && bullets.length === 0 && result.reasoning && (
          <div className="text-gray-300 text-sm border-t border-gray-700 pt-4 whitespace-pre-wrap break-words">
            <p className="mb-2 text-gray-400 text-xs italic">Raw reasoning (no timestamps detected):</p>
            {result.reasoning}
          </div>
        )}

        {/* Show bullets even if they have no timestamps - helps debug */}
        {bullets.length > 0 && bullets.every(b => b.timestamp === null) && (
          <div className="mt-2 text-yellow-400 text-xs italic">
            Note: No timestamps detected in grading details. The AI may not have included timestamps in MM:SS format.
          </div>
        )}

        {/* JSON Fallback */}
        {!result.title && !result.issue && !result.estimatedGrade && !result.reasoning && (
          <div className="text-gray-400 text-sm pt-4 overflow-x-auto">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Video Investigator Modal */}
      {videoUrl && (
        <VideoInvestigatorModal
          open={investigatorOpen}
          onOpenChange={setInvestigatorOpen}
          videoUrl={videoUrl}
          timestamp={selectedTimestamp}
        />
      )}
    </div>
  );
}

