/**
 * Grade Adjustment Logic
 * 
 * Adjusts AI-assigned grades based on CV analysis defect detection.
 * Ensures grades reflect actual physical condition detected by deep scan.
 */

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

