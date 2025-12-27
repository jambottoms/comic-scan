'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { Bookmark, BookmarkCheck, Trash2, Loader2, ScanLine, Maximize2 } from 'lucide-react';
import VideoInvestigatorModal from './VideoInvestigatorModal';
import ImageViewerModal from './ImageViewerModal';
import HybridGradeDisplay from './HybridGradeDisplay';
import { saveScan, deleteSavedScan, isScanSaved, updateSavedScan } from '@/lib/saved-scans';

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
  
  // Image Viewer State
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageTitle, setSelectedImageTitle] = useState<string>("");
  const [selectedImageDesc, setSelectedImageDesc] = useState<string>("");
  const [selectedImageTimestamp, setSelectedImageTimestamp] = useState<string>("");
  
  const openImageViewer = (url: string, title: string, desc: string, timestamp?: number) => {
    setSelectedImage(url);
    setSelectedImageTitle(title);
    setSelectedImageDesc(desc);
    
    if (timestamp !== undefined) {
      const mins = Math.floor(timestamp / 60);
      const secs = Math.floor(timestamp % 60);
      setSelectedImageTimestamp(`${mins}:${secs.toString().padStart(2, '0')}`);
    } else {
      setSelectedImageTimestamp("");
    }
    
    setImageViewerOpen(true);
  };
  
  // Save state
  const [isSaved, setIsSaved] = useState(!!savedScanId);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(savedScanId || null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const grade = result.estimatedGrade || 'N/A';
  // Clean title: Remove markdown bold/heading chars and trim
  const cleanTitle = (t: string) => t.replace(/^[#*\s]+|[#*\s]+$/g, '').replace(/\*\*/g, '').trim();
  const title = result.title ? cleanTitle(result.title) : "Unknown Comic";
  const issueNum = result.issue ? `${result.issue}` : "";
  const pageQuality = result.pageQuality || "White Pages"; 
  
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

  // Auto-update saved scan if we have new data (like CV analysis)
  // This handles the case where a user saves a scan, and then CV analysis finishes in the background
  useEffect(() => {
    const updateSaved = async () => {
      // Only update if we are viewing a history item (not a saved scan directly),
      // it is marked as saved, and we have a valid ID.
      if (!savedScanId && isSaved && currentSavedId && result) {
        // Check if we have CV data to save
        const hasCV = result.goldenFrames || result.defectMask;
        
        if (hasCV) {
           await updateSavedScan(currentSavedId, {
             title,
             issue: issueNum,
             grade,
             videoUrl: videoUrl || undefined,
             thumbnail,
             result
           });
        }
      }
    };
    
    updateSaved();
  }, [result, isSaved, currentSavedId, savedScanId, title, issueNum, grade, videoUrl, thumbnail]);
  
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

  // Helper to clean text artifacts
  const cleanText = (text: string): string => {
    return text
      // Remove leading bullets/hyphens/numbers
      .replace(/^[-•*\d]+\.\s*/, '')
      .replace(/^[-•*]\s*/, '')
      // Remove specific patterns reported by user like ['**Note:**, "**
      .replace(/^\['\*\*Note:\*\*,?\s*/i, '')
      .replace(/^"\*\*Note:\*\*,?\s*/i, '')
      .replace(/^\*\*Note:\*\*,?\s*/i, '')
      .replace(/^\*\*Analysis:\*\*\s*/i, '')
      .replace(/^\['/g, '')
      .replace(/^"/g, '')
      .replace(/"$/g, '')
      .replace(/'\]$/g, '')
      // Remove markdown bold around words
      .replace(/\*\*(.*?)\*\*/g, '$1')
      // Remove timestamps like (0:15) or [15s]
      .replace(/[([{\s]*\d+:\d+[)\]}\s]*|[([{\s]*\d+s[)\]}\s]*/gi, '')
      // Remove trailing punctuation that might look weird on its own line (but keep end punctuation)
      .replace(/\s+([,:;])\s*$/g, '$1')
      // Remove " at " followed by numbers if it looks like a timestamp intro
      .replace(/\s+at\s*$/i, '')
      // Remove multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
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
    
    // First, try to split by newlines or bullet points (more reliable for structured text)
    const lines = reasoningText.split(/\n+/).filter(l => l.trim().length > 0);
    
    // If we have multiple lines, use them as bullets
    if (lines.length > 1) {
      // First line or two as summary
      const summaryLines = lines.slice(0, Math.min(2, lines.length));
      const summary = cleanText(summaryLines.join(' '));
      
      // Rest as bullets
      const bullets = lines.slice(summaryLines.length).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        
        // Try to extract timestamp (preserve original text)
        const timestamp = parseTimestamp(trimmed);
        
        // Remove timestamp from text for cleaner display
        let displayText = trimmed;
        if (timestamp !== null) {
          // Remove timestamp patterns more aggressively
          displayText = displayText
            .replace(/\d+:\d+/g, '')
            .replace(/\d+s/gi, '')
            .replace(/\d+m\s*\d+s/gi, '')
            .replace(/\d+m/gi, '')
            .replace(/[()[\],]/g, ' '); // Remove brackets often used with timestamps
        }
        
        displayText = cleanText(displayText);
        
        // Skip empty bullets
        if (!displayText) return null;

        return {
          text: displayText,
          timestamp: timestamp
        };
      }).filter((b): b is { text: string; timestamp: number | null } => b !== null);
      
      return { summary, bullets };
    }
    
    // Fallback: Split by sentences
    const sentences = reasoningText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    // First 1-2 sentences as summary
    const summary = cleanText(sentences.slice(0, 2).join('. ') + (sentences.length > 2 ? '.' : ''));
    
    // Rest as bullet points with timestamp extraction
    const bullets = sentences.slice(2).map(s => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      
      const timestamp = parseTimestamp(trimmed);
      let displayText = trimmed;
      if (timestamp !== null) {
         displayText = displayText
            .replace(/\d+:\d+/g, '')
            .replace(/\d+s/gi, '')
            .replace(/\d+m\s*\d+s/gi, '')
            .replace(/\d+m/gi, '')
            .replace(/[()[\],]/g, ' ');
      }
      
      displayText = cleanText(displayText);
      
      // Skip empty bullets
      if (!displayText) return null;

      return {
        text: displayText,
        timestamp: timestamp
      };
    }).filter((b): b is { text: string; timestamp: number | null } => b !== null);
    
    return { summary, bullets };
  };

  const { summary, bullets } = result.reasoning ? parseReasoning(result.reasoning) : { summary: '', bullets: [] };
  const issue = result.issue ? `#${result.issue}` : "Unknown Issue";

  // Helper to find defect description for a golden frame based on timestamp
  const getFrameDescription = (frameIdx: number): { title: string, desc: string } => {
    // Default
    let title = `Golden Frame #${frameIdx + 1}`;
    let desc = "High-resolution capture selected by AI for clarity.";

    const frameTimestamp = result.frameTimestamps ? result.frameTimestamps[frameIdx] : null;
    
    if (frameTimestamp !== null && bullets.length > 0) {
      // Find bullet with closest timestamp (within 2 seconds)
      const match = bullets.find((b: { timestamp: number | null, text: string }) => 
        b.timestamp !== null && Math.abs(b.timestamp - frameTimestamp) < 3.0
      );
      
      if (match) {
        title = "Defect Detected";
        desc = match.text;
      }
    }
    
    return { title, desc };
  };

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

      {/* The Result Card - CGC Slab Style */}
      <div className="bg-gray-800 p-6 rounded-xl border-2 border-purple-500 max-w-2xl w-full shadow-2xl mb-4">
        {/* CGC Slab Style Header */}
        <div className="bg-gradient-to-b from-gray-900 to-gray-800 border-2 border-gray-600 rounded-lg p-0 overflow-hidden mb-4">
          {/* Top colored strip for publisher/imprint style (optional) */}
          <div className="h-1 bg-gradient-to-r from-blue-600 to-purple-600 w-full"></div>
          
          <div className="flex flex-row p-3">
            {/* Left: Grade Box (CGC Style) */}
            <div className="flex-shrink-0 flex flex-col w-20 bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden mr-4">
              <div className="bg-gray-800 text-center py-1 border-b border-gray-600">
                 <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Grade</span>
              </div>
              <div className="flex-1 flex items-center justify-center bg-white">
                <span className="text-3xl font-black text-black">{grade}</span>
              </div>
              <div className="bg-gray-100 text-center py-1 border-t border-gray-200">
                <span className="text-[9px] font-bold text-gray-600 uppercase whitespace-nowrap px-1">{pageQuality}</span>
              </div>
            </div>

            {/* Right: Title and Issue Info */}
            <div className="flex-1 flex flex-col justify-center min-w-0">
               <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight leading-none mb-1 truncate">
                 {title}
               </h2>
               <div className="flex items-center gap-2 text-gray-300">
                 <span className="text-lg font-bold">#{issue.replace('#', '')}</span>
               </div>
                               <div className="text-xs text-gray-500 mt-1 font-mono uppercase tracking-wide">
                 GradeVault • {new Date().getFullYear()}
               </div>
            </div>
          </div>

          {/* Save/Unsave Button Area */}
          <div className="flex items-center justify-end gap-2 px-3 py-2 bg-gray-900/50 border-t border-gray-700">
            {isSaved ? (
              <button
                onClick={handleUnsave}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 rounded text-xs font-semibold uppercase tracking-wide transition-all"
              >
                {isDeleting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                <span>Remove</span>
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold uppercase tracking-wide transition-all"
              >
                {isSaving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Bookmark className="w-3 h-3" />
                )}
                <span>Save</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary Section */}
        {summary && (
          <div className="mb-4 pb-4 border-b border-gray-700">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Analysis Summary</h3>
            <p className="text-gray-300 text-sm leading-relaxed">
              {summary}
            </p>
          </div>
        )}

        {/* Grading Details - Bullet Points */}
        {bullets.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
              Defects & Notes
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
                  <li key={index} className="flex items-start text-gray-300 text-sm group">
                    <span className="text-purple-500 mr-2 mt-1">•</span>
                    <span className="flex-1">
                      {bullet.text}
                      {bullet.timestamp !== null && (
                        <button
                          onClick={() => openInvestigator(bullet.timestamp!)}
                          className="ml-2 text-purple-400 hover:text-purple-300 bg-purple-900/20 hover:bg-purple-900/40 px-1.5 rounded text-xs font-mono transition-colors inline-flex items-center gap-1"
                          title={`View frame at ${formatTimestamp(bullet.timestamp)}`}
                        >
                          <span>▶</span>
                          {formatTimestamp(bullet.timestamp)}
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

      {/* Hybrid Grade Display - AI + CV Analysis */}
      {result.hybridGrade && (
        <div className="max-w-2xl w-full mb-4">
          <HybridGradeDisplay hybridGrade={result.hybridGrade} />
        </div>
      )}

      {/* CV Analysis Section - Golden Frames & Defect Analysis */}
      {(result.analysisImages || result.goldenFrames || result.defectMask) && (
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full mb-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <ScanLine className="w-4 h-4" />
            Condition Analysis
          </h3>
          
          {/* Golden Frames Grid */}
          {result.goldenFrames && result.goldenFrames.length > 0 && (
            <div className="mb-4">
              <p className="text-gray-400 text-xs mb-2">Golden Frames (Tap to Enlarge)</p>
              <div className="grid grid-cols-3 gap-2">
                {result.goldenFrames.slice(0, 3).map((frame: string, idx: number) => {
                  const timestamp = result.frameTimestamps?.[idx] ?? 0;
                  const { title, desc } = getFrameDescription(idx);
                  return (
                    <button 
                      key={idx} 
                      className="aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900 relative group hover:border-purple-500 transition-colors"
                      onClick={() => openImageViewer(
                        frame, 
                        title,
                        desc,
                        timestamp
                      )}
                    >
                      <img src={frame} alt={`Golden Frame ${idx + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-0.5 font-mono">
                        {timestamp.toFixed(2)}s
                      </div>
                    </button>
                  );
                })}
              </div>
              
              {/* Show remaining frames in a second row if we have 5 */}
              {result.goldenFrames.length > 3 && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {result.goldenFrames.slice(3).map((frame: string, idx: number) => {
                    const timestamp = result.frameTimestamps?.[idx + 3] ?? 0;
                    const { title, desc } = getFrameDescription(idx + 3);
                    return (
                      <button 
                        key={idx + 3} 
                        className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-600 bg-gray-900 group hover:border-purple-500 transition-colors"
                        onClick={() => openImageViewer(
                          frame, 
                          title,
                          desc,
                          timestamp
                        )}
                      >
                        <img src={frame} alt={`Golden Frame ${idx + 4}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-0.5 font-mono">
                          {timestamp.toFixed(2)}s
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          
          {/* Deep Scan Results Summary */}
          {(result.cvAnalysis?.damageScore !== undefined || result.damageScore !== undefined || result.defectPercentage !== undefined) && (
            <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <span className="text-gray-400 text-xs uppercase tracking-wide flex items-center gap-2">
                  <span>🔬 Physical Condition Analysis</span>
                  <span className="text-[10px] text-gray-500 normal-case">(CV defect detection)</span>
                </span>
                {(result.cvAnalysis?.damageScore !== undefined || result.damageScore !== undefined) ? (
                  <div className="flex flex-col items-end">
                    <span className={`text-sm font-bold ${
                      (result.cvAnalysis?.damageScore || result.damageScore) < 20 ? 'text-green-400' : 
                      (result.cvAnalysis?.damageScore || result.damageScore) < 40 ? 'text-yellow-400' : 
                      (result.cvAnalysis?.damageScore || result.damageScore) < 65 ? 'text-orange-400' : 'text-red-400'
                    }`}>
                      {(result.cvAnalysis?.damageScore || result.damageScore) < 20 ? '✓ Excellent' : 
                       (result.cvAnalysis?.damageScore || result.damageScore) < 40 ? '⚡ Minor Wear' : 
                       (result.cvAnalysis?.damageScore || result.damageScore) < 65 ? '⚠ Moderate Damage' : '✕ Heavy Damage'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {(result.cvAnalysis?.damageScore || result.damageScore).toFixed(0)}% damage detected
                    </span>
                  </div>
                ) : result.defectPercentage !== undefined && (
                  <span className="text-gray-400 text-xs">
                    Defect coverage: {result.defectPercentage.toFixed(1)}%
                  </span>
                )}
              </div>
              
              {/* Grade Adjustment Message */}
              {result.gradeAdjustment && (
                <div className="mb-3 p-2 bg-blue-900/20 rounded border border-blue-700/30">
                  <p className="text-xs text-blue-300">
                    📊 <span className="font-medium">Grade Adjustment:</span> {result.gradeAdjustment}
                  </p>
                </div>
              )}
              
              {/* Per-region scores with images */}
              {(result.cvAnalysis?.regionScores || result.regionScores) && Object.keys(result.cvAnalysis?.regionScores || result.regionScores).length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 mb-2">Region Damage (lower = better condition):</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(result.cvAnalysis?.regionScores || result.regionScores).map(([region, score]) => {
                      const scoreNum = score as number;
                      const regionLabel = region === 'spine' ? 'Spine' : 
                                         region === 'surface' ? 'Cover' :
                                         region.replace('corner_', '').toUpperCase();
                      const regionImage = result.cvAnalysis?.regionCrops?.[region] || result.regionCrops?.[region];
                      
                      return (
                        <div 
                          key={region} 
                          className={`rounded border overflow-hidden ${
                            scoreNum < 20 ? 'border-green-700/50 bg-green-900/20' :
                            scoreNum < 40 ? 'border-yellow-700/50 bg-yellow-900/20' :
                            scoreNum < 65 ? 'border-orange-700/50 bg-orange-900/20' :
                            'border-red-700/50 bg-red-900/20'
                          }`}
                        >
                          {/* Image */}
                          {regionImage && (
                            <button
                              onClick={() => openImageViewer(
                                regionImage,
                                `${regionLabel} Region`,
                                `Detailed view of ${regionLabel.toLowerCase()} region. Damage score: ${scoreNum.toFixed(0)}%`
                              )}
                              className="w-full aspect-square relative group"
                            >
                              <img 
                                src={regionImage} 
                                alt={regionLabel} 
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                              </div>
                            </button>
                          )}
                          
                          {/* Score badge */}
                          <div className={`px-2 py-1.5 text-center ${
                            scoreNum < 20 ? 'text-green-400' :
                            scoreNum < 40 ? 'text-yellow-400' :
                            scoreNum < 65 ? 'text-orange-400' :
                            'text-red-400'
                          }`}>
                            <div className="font-mono font-bold text-sm">{scoreNum.toFixed(0)}%</div>
                            <div className="text-[10px] opacity-75">{regionLabel}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Defect Overlay / Heatmaps */}
          {(result.defectOverlay || result.defectMask || result.varianceHeatmap) && (
            <div className="mb-4">
              <p className="text-gray-400 text-xs mb-2">Defect Visualization</p>
              
              {/* Primary: Defect Overlay */}
              {result.defectOverlay && (
                <button 
                  className="w-full mb-2 rounded-lg overflow-hidden border border-gray-600 bg-gray-900 relative group hover:border-purple-500 transition-colors"
                  onClick={() => openImageViewer(
                    result.defectOverlay,
                    "Defect Analysis",
                    "AI-detected defects highlighted in red. Shows creases, tears, scratches, and surface wear."
                  )}
                >
                  <img src={result.defectOverlay} alt="Defect Analysis" className="w-full h-auto" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <Maximize2 className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-xs text-center text-gray-300 py-1.5 font-medium">
                    🔍 Detected Defects (Tap to Enlarge)
                  </div>
                </button>
              )}
              
              {/* Heatmaps */}
              <div className="grid grid-cols-2 gap-2">
                {result.varianceHeatmap && (
                  <button 
                    className="rounded-lg overflow-hidden border border-gray-600 bg-gray-900 relative group hover:border-purple-500 transition-colors"
                    onClick={() => openImageViewer(
                      result.varianceHeatmap,
                      "Damage Intensity Heatmap",
                      "Color-coded damage intensity. Red areas indicate higher defect concentration."
                    )}
                  >
                    <img src={result.varianceHeatmap} alt="Damage Heatmap" className="w-full h-auto" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-1">
                      Intensity Heatmap
                    </div>
                  </button>
                )}
                {result.defectMask && (
                  <button 
                    className="rounded-lg overflow-hidden border border-gray-600 bg-gray-900 relative group hover:border-purple-500 transition-colors"
                    onClick={() => openImageViewer(
                      result.defectMask,
                      "Defect Mask",
                      "Binary mask showing all detected surface anomalies and damage areas."
                    )}
                  >
                    <img src={result.defectMask} alt="Defect Mask" className="w-full h-auto" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-300 py-1">
                      Defect Mask
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Corner & Spine Crops */}
          {result.regionCrops && Object.keys(result.regionCrops).length > 0 && (
            <div>
              <p className="text-gray-400 text-xs mb-2">Region Analysis</p>
              <div className="grid grid-cols-5 gap-1">
                {['corner_tl', 'corner_tr', 'spine', 'corner_bl', 'corner_br'].map((region) => {
                  const regionName = region.replace('corner_', '').replace('_', '');
                  const regionTitle = region === 'spine' ? 'Spine' : 
                                     region === 'corner_tl' ? 'Top Left Corner' :
                                     region === 'corner_tr' ? 'Top Right Corner' :
                                     region === 'corner_bl' ? 'Bottom Left Corner' :
                                     'Bottom Right Corner';
                  
                  return result.regionCrops[region] && (
                    <button 
                      key={region} 
                      className="relative group w-full"
                      onClick={() => openImageViewer(
                        result.regionCrops[region],
                        regionTitle,
                        `High-resolution crop of the ${regionTitle.toLowerCase()} for detailed inspection.`
                      )}
                    >
                      <div className="aspect-square rounded overflow-hidden border border-gray-600 bg-gray-900 group-hover:border-purple-500 transition-colors">
                        <img 
                          src={result.regionCrops[region]} 
                          alt={regionTitle} 
                          className="w-full h-full object-cover" 
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                        </div>
                      </div>
                      <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center text-gray-300 py-0.5 uppercase">
                        {regionName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Pixels per MM info */}
          {result.pixelsPerMm && (
            <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
              <span>Resolution: {result.pixelsPerMm.toFixed(1)} px/mm</span>
              <span>≈ {(result.pixelsPerMm * 25.4).toFixed(0)} DPI</span>
            </div>
          )}
        </div>
      )}

      {/* Video Preview - Moved to Bottom */}
      {videoUrl && (
        <div className="mb-6 w-full max-w-2xl">
          <p className="text-gray-400 text-sm mb-2 text-center">Video Preview:</p>
          <div className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-black">
            <video 
              ref={previewVideoRef}
              src={videoUrl} 
              controls 
              playsInline
              className="w-full h-auto max-h-[80vh]"
              onPlay={(e) => {
                // Optional: Auto fullscreen logic if desired
              }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}

      {/* Video Investigator Modal */}
      {videoUrl && (
        <VideoInvestigatorModal
          open={investigatorOpen}
          onOpenChange={setInvestigatorOpen}
          videoUrl={videoUrl}
          timestamp={selectedTimestamp}
        />
      )}
      
      {/* Image Viewer Modal */}
      <ImageViewerModal
        isOpen={imageViewerOpen}
        onClose={() => setImageViewerOpen(false)}
        imageUrl={selectedImage}
        title={selectedImageTitle}
        description={selectedImageDesc}
        timestamp={selectedImageTimestamp}
      />
    </div>
  );
}
