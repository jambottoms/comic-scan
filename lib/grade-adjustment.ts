/**
 * Grade Adjustment Logic
 * 
 * Adjusts AI-assigned grades based on CV analysis defect detection.
 * Ensures grades reflect actual physical condition detected by deep scan.
 */

// Type exports for components
import type { RegionName, DefectLabel } from './grading-config';

export interface DefectBreakdown {
  region: RegionName;
  defect: DefectLabel;
  baseDeduction: number;
  regionWeight: number;
  totalDeduction: number;
}

export interface NyckelRegionGrade {
  grade: number;
  label: string;
  confidence: number;
}

export interface CVAnalysisData {
  damageScore?: number;
  regionScores?: Record<string, number>;
  regionGrades?: Record<string, NyckelRegionGrade>;
  regionCrops?: Record<string, string>;
  regionOverlays?: Record<string, string>;
  defectMask?: string;
  varianceMap?: string;
  defectLabels?: Record<string, string[]>;
}

export interface NyckelAnalysisData {
  analysisType?: string;
  averageGrade?: number;
  criticalRegionAvg?: number;
  regionGrades?: Record<string, NyckelRegionGrade>;
  lowestRegion?: { region: string; grade: number; label: string };
  damageScore?: number;
  regionScores?: Record<string, number>;
  defectLabels?: Record<string, string[]>;
  images?: CVAnalysisData;
}

export interface HybridGradeResult {
  finalGrade: string;
  displayGrade: string;
  aiGrade: string;
  cvGrade: string;
  nyckelGrade?: string;
  defectGrade?: string;
  agreement: 'strong' | 'moderate' | 'weak';
  gradeDifference: number;
  overallConfidence: string;
  aiConfidence?: string;
  cvConfidence?: string;
  reasoning: string;
  aiReasoning?: string;
  cvReasoning?: string;
  nyckelRegions?: Record<string, NyckelRegionGrade>;
  lowestRegion?: { region: string; grade: number; label: string } | null;
  criticalIssues?: string[];
  cvAnalysis?: CVAnalysisData;
  defectLabels?: Record<string, string[]>;
  detailedAnalysis?: any;
  defectBreakdown?: DefectBreakdown[];
}

export interface GradeAdjustment {
  originalGrade: string;
  adjustedGrade: string;
  adjustment: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Adjust grade based on CV analysis results.
 * 
 * Logic:
 * - If AI assigns high grade but CV detects significant damage → Downgrade
 * - If AI assigns low grade and CV confirms damage → Keep grade
 * - If mismatch between AI and CV → Flag for review
 * 
 * @param aiGrade - Original grade from AI (e.g., "Near Mint 9.4")
 * @param damageScore - CV damage score (0-100, higher = more damage)
 * @param regionScores - Per-region damage scores
 * @returns Adjusted grade and explanation
 */
export function adjustGradeWithCVAnalysis(
  aiGrade: string,
  damageScore: number,
  regionScores: Record<string, number> = {}
): GradeAdjustment {
  
  // Extract numeric grade from AI (e.g., "9.4" from "Near Mint 9.4")
  const gradeMatch = aiGrade.match(/(\d+\.?\d*)/);
  const numericGrade = gradeMatch ? parseFloat(gradeMatch[1]) : null;
  
  if (!numericGrade || damageScore === undefined || damageScore === null) {
    return {
      originalGrade: aiGrade,
      adjustedGrade: aiGrade,
      adjustment: null,
      confidence: 'low'
    };
  }
  
  // Critical regions (corners and spine are most important for grading)
  const criticalRegions = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'spine'];
  const criticalDamageScores = criticalRegions
    .map(r => regionScores[r] || 0)
    .filter(score => score > 0);
  
  const maxCriticalDamage = criticalDamageScores.length > 0 
    ? Math.max(...criticalDamageScores) 
    : 0;
  
  const avgCriticalDamage = criticalDamageScores.length > 0
    ? criticalDamageScores.reduce((a, b) => a + b, 0) / criticalDamageScores.length
    : 0;
  
  // Grade categories
  const isGemMint = numericGrade >= 9.8;   // 9.8-10.0
  const isMint = numericGrade >= 9.0;      // 9.0-9.7
  const isNearMint = numericGrade >= 8.0;  // 8.0-8.9
  const isFine = numericGrade >= 6.5;      // 6.5-7.9
  const isVeryGood = numericGrade >= 4.5;  // 4.5-6.4
  
  // Damage categories
  const isMinimalDamage = damageScore < 15;
  const isMinorDamage = damageScore >= 15 && damageScore < 30;
  const isModerateDamage = damageScore >= 30 && damageScore < 50;
  const isSignificantDamage = damageScore >= 50 && damageScore < 70;
  const isSevereDamage = damageScore >= 70;
  
  // Critical region damage flags
  const hasCriticalDamage = maxCriticalDamage >= 50;
  const hasModerateCornerDamage = maxCriticalDamage >= 35;
  
  let adjustedNumeric = numericGrade;
  let adjustment: string | null = null;
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  
  // =========================================
  // ADJUSTMENT RULES
  // =========================================
  
  // Rule 1: Gem Mint (9.8-10.0) - Very strict
  if (isGemMint) {
    if (damageScore > 10 || maxCriticalDamage > 15) {
      adjustedNumeric = Math.max(numericGrade - 1.5, 8.5);
      adjustment = `Downgraded from Gem Mint: CV detected damage (overall: ${damageScore.toFixed(0)}, critical regions: ${maxCriticalDamage.toFixed(0)})`;
      confidence = 'high';
    } else if (damageScore > 5) {
      adjustedNumeric = Math.max(numericGrade - 0.5, 9.2);
      adjustment = `Minor adjustment: subtle defects detected (score: ${damageScore.toFixed(0)})`;
      confidence = 'medium';
    }
  }
  
  // Rule 2: Mint (9.0-9.7) - Strict
  else if (isMint) {
    if (isSevereDamage || hasCriticalDamage) {
      adjustedNumeric = Math.max(numericGrade - 2.0, 6.5);
      adjustment = `Significant downgrade: CV detected major damage (score: ${damageScore.toFixed(0)}, critical damage: ${maxCriticalDamage.toFixed(0)})`;
      confidence = 'high';
    } else if (isSignificantDamage || hasModerateCornerDamage) {
      adjustedNumeric = Math.max(numericGrade - 1.0, 7.5);
      adjustment = `Downgraded: noticeable damage detected (score: ${damageScore.toFixed(0)})`;
      confidence = 'high';
    } else if (isModerateDamage) {
      adjustedNumeric = Math.max(numericGrade - 0.5, 8.5);
      adjustment = `Minor adjustment for detected wear (score: ${damageScore.toFixed(0)})`;
      confidence = 'medium';
    }
  }
  
  // Rule 3: Near Mint (8.0-8.9) - Moderate
  else if (isNearMint) {
    if (isSevereDamage) {
      adjustedNumeric = Math.max(numericGrade - 1.5, 5.5);
      adjustment = `Downgraded: severe damage detected (score: ${damageScore.toFixed(0)})`;
      confidence = 'high';
    } else if (isSignificantDamage) {
      adjustedNumeric = Math.max(numericGrade - 1.0, 6.5);
      adjustment = `Adjusted for significant damage (score: ${damageScore.toFixed(0)})`;
      confidence = 'high';
    } else if (isModerateDamage) {
      adjustedNumeric = Math.max(numericGrade - 0.5, 7.5);
      adjustment = `Minor adjustment for moderate wear (score: ${damageScore.toFixed(0)})`;
      confidence = 'medium';
    }
  }
  
  // Rule 4: Fine (6.5-7.9) - Already moderate grade
  else if (isFine) {
    if (isSevereDamage) {
      adjustedNumeric = Math.max(numericGrade - 1.0, 4.5);
      adjustment = `Adjusted for severe damage (score: ${damageScore.toFixed(0)})`;
      confidence = 'high';
    } else if (isSignificantDamage) {
      adjustedNumeric = Math.max(numericGrade - 0.5, 5.5);
      adjustment = `Minor adjustment for damage (score: ${damageScore.toFixed(0)})`;
      confidence = 'medium';
    }
    // Moderate damage expected at this grade level
  }
  
  // Rule 5: Very Good and below (< 6.5) - Damage expected
  else if (isVeryGood) {
    if (isSevereDamage) {
      adjustedNumeric = Math.max(numericGrade - 0.5, 3.0);
      adjustment = `Confirmed severe damage (score: ${damageScore.toFixed(0)})`;
      confidence = 'medium';
    }
    // Significant damage is expected at this grade
  }
  
  // =========================================
  // POSITIVE CONFIRMATION
  // =========================================
  // If AI assigned low grade and CV confirms damage, increase confidence
  if (numericGrade < 8.0 && damageScore > 30) {
    confidence = 'high';
    if (!adjustment) {
      adjustment = `CV confirms condition (damage score: ${damageScore.toFixed(0)})`;
    }
  }
  
  // If AI assigned high grade and CV confirms minimal damage, increase confidence
  if (numericGrade >= 9.0 && damageScore < 15 && maxCriticalDamage < 20) {
    confidence = 'high';
    if (!adjustment) {
      adjustment = `CV confirms excellent condition (minimal defects detected)`;
    }
  }
  
  // Format adjusted grade
  const adjustedGrade = adjustedNumeric !== numericGrade 
    ? formatGrade(adjustedNumeric)
    : aiGrade;
  
  return {
    originalGrade: aiGrade,
    adjustedGrade,
    adjustment,
    confidence
  };
}

/**
 * Format numeric grade to text format.
 */
function formatGrade(numeric: number): string {
  if (numeric >= 9.8) return `Gem Mint ${numeric.toFixed(1)}`;
  if (numeric >= 9.6) return `Mint ${numeric.toFixed(1)}`;
  if (numeric >= 9.0) return `Mint ${numeric.toFixed(1)}`;
  if (numeric >= 8.5) return `Near Mint+ ${numeric.toFixed(1)}`;
  if (numeric >= 8.0) return `Near Mint ${numeric.toFixed(1)}`;
  if (numeric >= 7.5) return `Near Mint- ${numeric.toFixed(1)}`;
  if (numeric >= 7.0) return `Fine+ ${numeric.toFixed(1)}`;
  if (numeric >= 6.5) return `Fine ${numeric.toFixed(1)}`;
  if (numeric >= 6.0) return `Fine- ${numeric.toFixed(1)}`;
  if (numeric >= 5.5) return `Very Good+ ${numeric.toFixed(1)}`;
  if (numeric >= 4.5) return `Very Good ${numeric.toFixed(1)}`;
  if (numeric >= 4.0) return `Very Good- ${numeric.toFixed(1)}`;
  if (numeric >= 3.5) return `Good+ ${numeric.toFixed(1)}`;
  if (numeric >= 3.0) return `Good ${numeric.toFixed(1)}`;
  return `Fair ${numeric.toFixed(1)}`;
}

/**
 * Legacy two-way grade fusion: combines AI grade with CV variance-based analysis.
 * Used when Nyckel ML is not available.
 * 
 * @param aiGrade - AI estimated grade (numeric)
 * @param aiConfidence - AI confidence level
 * @param damageScore - CV damage score (0-100)
 * @param regionScores - Per-region damage scores
 * @param detailedAnalysis - Gemini multi-frame analysis
 * @param defectLabels - Detected defect labels per region
 * @returns Fused grade result
 */
export function fuseGrades(
  aiGrade: number,
  aiConfidence: string,
  damageScore: number,
  regionScores: Record<string, number>,
  detailedAnalysis: any,
  defectLabels: Record<string, string[]>
): {
  finalGrade: string;
  displayGrade: string;
  aiGrade: string;
  cvGrade: string;
  agreement: 'strong' | 'moderate' | 'weak';
  gradeDifference: number;
  overallConfidence: string;
  reasoning: string;
  cvAnalysis: { damageScore: number; regionScores: Record<string, number> };
  defectLabels: Record<string, string[]>;
} {
  // Import roundToCGCGrade
  const { roundToCGCGrade } = require('./grading-config');
  
  // Convert damage score to grade (inverse: 0% damage = 10.0, 100% damage = 0.5)
  // Use a curve that's more realistic for comic grading
  const cvGradeNum = Math.max(0.5, 10.0 - (damageScore / 10));
  
  // Calculate agreement
  const gradeDifference = Math.abs(aiGrade - cvGradeNum);
  let agreement: 'strong' | 'moderate' | 'weak' = 'moderate';
  if (gradeDifference < 0.5) agreement = 'strong';
  else if (gradeDifference > 2.0) agreement = 'weak';
  
  // Determine final grade - weight AI higher when CV damage-based (less reliable)
  // 60% AI, 40% CV variance
  let finalGradeNum = (aiGrade * 0.6) + (cvGradeNum * 0.4);
  
  // If Gemini multi-frame analysis provided a grade, factor it in
  if (detailedAnalysis?.finalGrade) {
    const geminiGrade = parseFloat(detailedAnalysis.finalGrade);
    if (!isNaN(geminiGrade)) {
      // Reweight: 40% AI, 30% CV, 30% Gemini
      finalGradeNum = (aiGrade * 0.4) + (cvGradeNum * 0.3) + (geminiGrade * 0.3);
    }
  }
  
  // Round to valid CGC grade
  finalGradeNum = roundToCGCGrade(finalGradeNum);
  
  // Determine confidence
  let overallConfidence = 'medium';
  if (agreement === 'strong' && aiConfidence === 'high') {
    overallConfidence = 'high';
  } else if (agreement === 'weak') {
    overallConfidence = 'low';
  }
  
  const reasoning = `AI grade: ${aiGrade.toFixed(1)}, CV damage: ${damageScore.toFixed(0)}%`;
  
  return {
    finalGrade: finalGradeNum.toFixed(1),
    displayGrade: finalGradeNum.toFixed(1),
    aiGrade: aiGrade.toFixed(1),
    cvGrade: cvGradeNum.toFixed(1),
    agreement,
    gradeDifference,
    overallConfidence,
    reasoning,
    cvAnalysis: { damageScore, regionScores },
    defectLabels
  };
}

/**
 * Three-way grade fusion: combines AI grade, Nyckel ML regions, and Gemini multi-frame analysis.
 * 
 * @param aiGrade - AI estimated grade (numeric)
 * @param aiConfidence - AI confidence level ('low', 'medium', 'high')
 * @param nyckelAnalysis - Nyckel ML region analysis with regionGrades
 * @param detailedAnalysis - Gemini multi-frame analysis with confirmedDefects
 * @returns Fused grade result
 */
export function fuseThreeWayGrades(
  aiGrade: number,
  aiConfidence: string,
  nyckelAnalysis: {
    averageGrade?: number;
    criticalRegionAvg?: number;
    regionGrades?: Record<string, { grade: number; label: string; confidence: number }>;
    lowestRegion?: { region: string; grade: number; label: string };
  },
  detailedAnalysis: {
    finalGrade?: string;
    confidence?: string;
    confirmedDefects?: Array<{ type: string; severity: string; framesVisible: number }>;
  }
): {
  finalGrade: string;
  displayGrade: string;
  aiGrade: number;
  nyckelGrade: number;
  agreement: 'strong' | 'moderate' | 'weak';
  gradeDifference: number;
  overallConfidence: string;
  reasoning: string;
  nyckelRegions: Record<string, { grade: number; label: string; confidence: number }>;
  lowestRegion: { region: string; grade: number; label: string } | null;
  criticalIssues: string[];
} {
  // Get Nyckel weighted average grade
  const nyckelGrade = nyckelAnalysis.averageGrade ?? 5.0;
  
  // Get Gemini multi-frame grade if available
  const geminiGrade = detailedAnalysis.finalGrade ? parseFloat(detailedAnalysis.finalGrade) : null;
  
  // Calculate agreement between AI and Nyckel
  const gradeDifference = Math.abs(aiGrade - nyckelGrade);
  let agreement: 'strong' | 'moderate' | 'weak' = 'moderate';
  if (gradeDifference < 0.5) agreement = 'strong';
  else if (gradeDifference > 1.5) agreement = 'weak';
  
  // Determine final grade using weighted average
  // Weights: Nyckel ML (highest - region-based), Gemini multi-frame, AI estimate (lowest)
  let finalGradeNum: number;
  let reasoning: string;
  
  if (geminiGrade && !isNaN(geminiGrade)) {
    // Three-way fusion: 50% Nyckel, 30% Gemini, 20% AI
    finalGradeNum = (nyckelGrade * 0.5) + (geminiGrade * 0.3) + (aiGrade * 0.2);
    reasoning = `Fused: Nyckel ${nyckelGrade.toFixed(1)} (50%), Gemini ${geminiGrade.toFixed(1)} (30%), AI ${aiGrade.toFixed(1)} (20%)`;
  } else {
    // Two-way fusion: 70% Nyckel, 30% AI
    finalGradeNum = (nyckelGrade * 0.7) + (aiGrade * 0.3);
    reasoning = `Fused: Nyckel ${nyckelGrade.toFixed(1)} (70%), AI ${aiGrade.toFixed(1)} (30%)`;
  }
  
  // Round to valid CGC grade
  const { roundToCGCGrade } = require('./grading-config');
  finalGradeNum = roundToCGCGrade(finalGradeNum);
  
  // Determine overall confidence
  let overallConfidence = 'medium';
  if (agreement === 'strong' && aiConfidence === 'high') {
    overallConfidence = 'high';
  } else if (agreement === 'weak') {
    overallConfidence = 'low';
  }
  
  // Check for critical issues from defects
  const criticalIssues: string[] = [];
  if (detailedAnalysis.confirmedDefects) {
    for (const defect of detailedAnalysis.confirmedDefects) {
      if (defect.severity === 'severe' && defect.framesVisible >= 3) {
        criticalIssues.push(`${defect.type} (severe, visible in ${defect.framesVisible} frames)`);
      }
    }
  }
  
  return {
    finalGrade: finalGradeNum.toFixed(1),
    displayGrade: finalGradeNum.toFixed(1),
    aiGrade,
    nyckelGrade,
    agreement,
    gradeDifference,
    overallConfidence,
    reasoning,
    nyckelRegions: nyckelAnalysis.regionGrades || {},
    lowestRegion: nyckelAnalysis.lowestRegion || null,
    criticalIssues
  };
}

/**
 * Get severity level from damage score.
 */
export function getDamageSeverity(damageScore: number): {
  level: 'minimal' | 'minor' | 'moderate' | 'significant' | 'severe';
  color: string;
  description: string;
} {
  if (damageScore < 15) {
    return {
      level: 'minimal',
      color: 'text-green-400',
      description: 'Excellent condition with minimal defects'
    };
  } else if (damageScore < 30) {
    return {
      level: 'minor',
      color: 'text-yellow-400',
      description: 'Minor wear and defects present'
    };
  } else if (damageScore < 50) {
    return {
      level: 'moderate',
      color: 'text-orange-400',
      description: 'Moderate damage and wear visible'
    };
  } else if (damageScore < 70) {
    return {
      level: 'significant',
      color: 'text-red-400',
      description: 'Significant damage affecting grade'
    };
  } else {
    return {
      level: 'severe',
      color: 'text-red-600',
      description: 'Severe damage, poor condition'
    };
  }
}

