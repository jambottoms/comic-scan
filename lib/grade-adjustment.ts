/**
 * Grade Adjustment Logic
 * 
 * Adjusts AI-assigned grades based on CV analysis defect detection.
 * Ensures grades reflect actual physical condition detected by deep scan.
 * 
 * Uses configurable weights from grading-config.ts for defect-based grading.
 */

import { 
  DEFECT_DEDUCTIONS, 
  REGION_WEIGHTS, 
  getGradeTier,
  type DefectLabel, 
  type RegionName 
} from './grading-config';

/**
 * Defect breakdown for a single defect finding
 */
export interface DefectBreakdown {
  region: RegionName;
  defect: DefectLabel;
  baseDeduction: number;
  regionWeight: number;
  totalDeduction: number;
}

/**
 * Result of defect-based grade calculation
 */
export interface DefectGradeResult {
  grade: number;
  totalDeduction: number;
  defectBreakdown: DefectBreakdown[];
  defectSummary: string;
}

/**
 * Calculate grade from detected defects using configurable weights.
 * 
 * Formula: Grade = 10.0 - Σ(Defect Deduction × Region Weight)
 * 
 * @param defectLabels - Map of region name to list of detected defect labels
 * @returns DefectGradeResult with grade and breakdown
 */
export function calculateGradeFromDefects(
  defectLabels: Record<string, string[]>
): DefectGradeResult {
  let grade = 10.0;
  let totalDeduction = 0;
  const defectBreakdown: DefectBreakdown[] = [];
  const defectCounts: Record<string, number> = {};
  
  for (const [region, defects] of Object.entries(defectLabels)) {
    const regionWeight = REGION_WEIGHTS[region as RegionName] || 1.0;
    
    for (const defect of defects) {
      // Skip pristine - no deduction
      if (defect === 'pristine') continue;
      
      const baseDeduction = DEFECT_DEDUCTIONS[defect as DefectLabel] || 0;
      const deduction = baseDeduction * regionWeight;
      
      grade -= deduction;
      totalDeduction += deduction;
      
      defectBreakdown.push({
        region: region as RegionName,
        defect: defect as DefectLabel,
        baseDeduction,
        regionWeight,
        totalDeduction: deduction
      });
      
      // Count defects for summary
      defectCounts[defect] = (defectCounts[defect] || 0) + 1;
    }
  }
  
  // Clamp grade to minimum 0.5
  grade = Math.max(0.5, grade);
  
  // Generate summary string
  const defectSummary = Object.entries(defectCounts)
    .map(([defect, count]) => count > 1 ? `${defect} (×${count})` : defect)
    .join(', ') || 'No defects detected';
  
  return {
    grade,
    totalDeduction,
    defectBreakdown,
    defectSummary
  };
}

/**
 * Calculate grade from defects and blend with CV damage score.
 * 
 * Uses 60% defect-based, 40% CV damage-based when both available.
 * Falls back to single source when only one is available.
 * 
 * @param defectLabels - Map of region name to detected defect labels
 * @param cvDamageScore - CV-detected damage percentage (0-100)
 * @returns Blended grade
 */
export function calculateBlendedDefectGrade(
  defectLabels: Record<string, string[]>,
  cvDamageScore: number
): { grade: number; breakdown: DefectGradeResult } {
  const defectResult = calculateGradeFromDefects(defectLabels);
  
  // Convert CV damage score to grade equivalent
  // 0% damage = 10.0, 100% damage = 0.5
  const cvGrade = Math.max(0.5, 10.0 - (cvDamageScore / 10));
  
  // Blend: 60% defect-based, 40% CV-based
  // Defect-based is more specific, CV provides overall context
  const blendedGrade = (defectResult.grade * 0.6) + (cvGrade * 0.4);
  
  return {
    grade: Math.max(0.5, blendedGrade),
    breakdown: defectResult
  };
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

/**
 * Hybrid Grade Result - Combines AI, CV, and Nyckel defect analysis
 */
export interface CVAnalysisData {
  damageScore: number;
  regionScores: Record<string, number>;
  defectLabels?: Record<string, string[]>;  // Nyckel defect labels per region
  regionCrops?: Record<string, string>;
  regionOverlays?: Record<string, string>;
  defectMask?: string;
  varianceMap?: string;
}

export interface HybridGradeResult {
  finalGrade: string;              // "5.5" or "5.0-6.0"
  displayGrade: string;            // "Very Good+ 5.5" or "VG-FN (5.0-6.0)"
  aiGrade: string;
  cvGrade: string;
  defectGrade?: string;            // Grade from Nyckel defect classification
  agreement: 'strong' | 'moderate' | 'weak' | 'conflict';
  gradeDifference: number;
  overallConfidence: 'very-high' | 'high' | 'medium' | 'low';
  aiConfidence: 'high' | 'medium' | 'low';
  cvConfidence: 'high' | 'medium' | 'low';
  reasoning: string;
  aiReasoning: string;
  cvReasoning: string;
  defectSummary?: string;          // Summary of detected defects
  defectBreakdown?: DefectBreakdown[];  // Detailed defect breakdown
  detailedAnalysis: any;
  cvAnalysis: CVAnalysisData;
}

/**
 * Fuse AI, CV, and Nyckel defect grades into a single hybrid assessment
 * 
 * @param aiGrade - Grade from AI vision analysis
 * @param aiConfidence - AI confidence level
 * @param cvDamageScore - CV damage percentage (0-100)
 * @param regionScores - Per-region damage scores from CV
 * @param detailedAnalysis - Detailed AI analysis data
 * @param defectLabels - Optional Nyckel defect labels per region
 */
export function fuseGrades(
  aiGrade: number,
  aiConfidence: 'high' | 'medium' | 'low',
  cvDamageScore: number,
  regionScores: Record<string, number>,
  detailedAnalysis: any,
  defectLabels?: Record<string, string[]>
): HybridGradeResult {
  
  // Step 1: Convert CV damage score to implied grade
  const cvGrade = damageScoreToGrade(cvDamageScore, regionScores);
  const cvConfidence = calculateCVConfidence(cvDamageScore, regionScores);
  
  // Step 1.5: Calculate defect-based grade if labels available
  let defectGradeResult: DefectGradeResult | null = null;
  let defectGradeValue: number | null = null;
  
  if (defectLabels && Object.keys(defectLabels).length > 0) {
    defectGradeResult = calculateGradeFromDefects(defectLabels);
    defectGradeValue = defectGradeResult.grade;
  }
  
  // Step 2: Calculate agreement level
  const gradeDiff = Math.abs(aiGrade - cvGrade);
  let agreement: 'strong' | 'moderate' | 'weak' | 'conflict';
  
  if (gradeDiff <= 0.5) {
    agreement = 'strong';      // Within half a grade
  } else if (gradeDiff <= 1.0) {
    agreement = 'moderate';    // Within 1 grade
  } else if (gradeDiff <= 2.0) {
    agreement = 'weak';        // Within 2 grades
  } else {
    agreement = 'conflict';    // More than 2 grades apart
  }
  
  // Step 3: Determine final grade based on agreement
  let finalGrade: string;
  let displayGrade: string;
  let overallConfidence: 'very-high' | 'high' | 'medium' | 'low';
  let reasoning: string;
  
  if (agreement === 'strong') {
    // AI and CV agree strongly - use weighted average
    // Include defect grade if available (AI 40%, CV 30%, Defect 30%)
    // Otherwise use AI 60%, CV 40%
    let weighted: number;
    if (defectGradeValue !== null) {
      weighted = (aiGrade * 0.4) + (cvGrade * 0.3) + (defectGradeValue * 0.3);
    } else {
      weighted = (aiGrade * 0.6) + (cvGrade * 0.4);
    }
    finalGrade = weighted.toFixed(1);
    displayGrade = formatGrade(weighted);
    overallConfidence = aiConfidence === 'high' && cvConfidence === 'high' 
      ? 'very-high' 
      : 'high';
    reasoning = `AI and CV analysis agree (within ${gradeDiff.toFixed(1)} points). High confidence in grade ${finalGrade}.`;
    if (defectGradeResult && defectGradeResult.defectBreakdown.length > 0) {
      reasoning += ` Detected defects: ${defectGradeResult.defectSummary}.`;
    }
    
  } else if (agreement === 'moderate') {
    // Moderate agreement - show range
    const lower = Math.min(aiGrade, cvGrade);
    const upper = Math.max(aiGrade, cvGrade);
    finalGrade = `${lower.toFixed(1)}-${upper.toFixed(1)}`;
    displayGrade = `${getGradeCategory(lower)}-${getGradeCategory(upper)} (${finalGrade})`;
    overallConfidence = 'medium';
    reasoning = `AI suggests ${aiGrade.toFixed(1)}, CV analysis suggests ${cvGrade.toFixed(1)}. Grade likely between these values.`;
    
  } else if (agreement === 'weak') {
    // Weak agreement - show range with low confidence
    const lower = Math.min(aiGrade, cvGrade);
    const upper = Math.max(aiGrade, cvGrade);
    finalGrade = `${lower.toFixed(1)}-${upper.toFixed(1)}`;
    displayGrade = `${getGradeCategory(lower)}-${getGradeCategory(upper)} (${finalGrade})`;
    overallConfidence = 'low';
    reasoning = `Significant variance detected. AI: ${aiGrade.toFixed(1)}, CV: ${cvGrade.toFixed(1)}. Professional grading recommended.`;
    
  } else {
    // Conflict - flag for manual review
    const lower = Math.min(aiGrade, cvGrade);
    const upper = Math.max(aiGrade, cvGrade);
    finalGrade = `${lower.toFixed(1)}-${upper.toFixed(1)}`;
    displayGrade = `Needs Review (${finalGrade})`;
    overallConfidence = 'low';
    reasoning = `Major discrepancy: AI ${aiGrade.toFixed(1)} vs CV ${cvGrade.toFixed(1)}. Manual inspection strongly recommended.`;
  }
  
  // Step 4: Add specific insights
  const criticalIssues = findCriticalIssues(regionScores, detailedAnalysis);
  if (criticalIssues.length > 0) {
    reasoning += ` Key factors: ${criticalIssues.join(', ')}.`;
  }
  
  return {
    finalGrade,
    displayGrade,
    aiGrade: aiGrade.toFixed(1),
    cvGrade: cvGrade.toFixed(1),
    defectGrade: defectGradeValue?.toFixed(1),
    agreement,
    gradeDifference: gradeDiff,
    overallConfidence,
    aiConfidence,
    cvConfidence,
    reasoning,
    aiReasoning: detailedAnalysis?.frameNotes?.[0] || 'AI analysis complete',
    cvReasoning: `CV detected ${cvDamageScore.toFixed(0)}% damage across key regions`,
    defectSummary: defectGradeResult?.defectSummary,
    defectBreakdown: defectGradeResult?.defectBreakdown,
    detailedAnalysis,
    cvAnalysis: {
      damageScore: cvDamageScore,
      regionScores,
      defectLabels
    }
  };
}

/**
 * Convert CV damage score to implied grade
 * Higher damage = lower grade
 */
function damageScoreToGrade(
  damageScore: number, 
  regionScores: Record<string, number>
): number {
  // Get critical region damage (corners + spine)
  const criticalRegions = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'spine'];
  const criticalScores = criticalRegions
    .map(r => regionScores[r] || 0)
    .filter(s => s > 0);
  
  const maxCritical = criticalScores.length > 0 
    ? Math.max(...criticalScores) 
    : damageScore;
  
  // Use stricter of overall or critical damage
  const effectiveScore = Math.max(damageScore, maxCritical * 0.8);
  
  // Map damage to grade (inverse relationship)
  // 0-10% damage → 9.0-10.0 (Mint)
  // 10-20% → 8.0-9.0 (Near Mint)
  // 20-35% → 6.5-8.0 (Fine)
  // 35-55% → 4.5-6.5 (Very Good)
  // 55-75% → 3.0-4.5 (Good)
  // 75%+ → <3.0 (Fair/Poor)
  
  if (effectiveScore < 10) return 9.5;
  if (effectiveScore < 15) return 8.8;
  if (effectiveScore < 20) return 8.2;
  if (effectiveScore < 30) return 7.5;
  if (effectiveScore < 40) return 6.5;
  if (effectiveScore < 50) return 5.5;
  if (effectiveScore < 60) return 4.5;
  if (effectiveScore < 70) return 3.5;
  return 2.5;
}

/**
 * Calculate CV confidence based on data quality
 */
function calculateCVConfidence(
  damageScore: number,
  regionScores: Record<string, number>
): 'high' | 'medium' | 'low' {
  const numRegionsAnalyzed = Object.values(regionScores).filter(s => s > 0).length;
  
  // High confidence if:
  // - Multiple regions analyzed (5+)
  // - Clear damage pattern (very high or very low)
  if (numRegionsAnalyzed >= 5) {
    if (damageScore < 15 || damageScore > 60) {
      return 'high';  // Clear extreme
    }
    return 'medium';
  }
  
  if (numRegionsAnalyzed >= 3) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Find critical issues from region scores
 */
function findCriticalIssues(
  regionScores: Record<string, number>,
  detailedAnalysis: any
): string[] {
  const issues: string[] = [];
  
  // Check for severe corner damage
  const corners = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br'];
  const severeCorners = corners.filter(c => (regionScores[c] || 0) > 50);
  if (severeCorners.length >= 2) {
    issues.push('multiple corners damaged');
  }
  
  // Check for spine issues
  if ((regionScores['spine'] || 0) > 40) {
    issues.push('significant spine wear');
  }
  
  // Check AI-detected defects
  const confirmedDefects = detailedAnalysis?.confirmedDefects || [];
  const severeDefects = confirmedDefects.filter((d: any) => 
    d.severity === 'severe' || d.severity === 'moderate'
  );
  if (severeDefects.length > 0) {
    issues.push(`${severeDefects.length} major defects confirmed`);
  }
  
  return issues;
}

/**
 * Get grade category abbreviation
 */
function getGradeCategory(grade: number): string {
  if (grade >= 9.0) return 'MT';
  if (grade >= 8.0) return 'NM';
  if (grade >= 6.5) return 'FN';
  if (grade >= 4.5) return 'VG';
  if (grade >= 3.0) return 'GD';
  return 'FR';
}

