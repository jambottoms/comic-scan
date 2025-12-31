/**
 * GradeVault Grading Configuration
 * 
 * This module contains all configurable weights and deductions used
 * by the grading system. Adjust these values to tune grading severity.
 * 
 * @see GRADING_RULES.md for full documentation
 */

/**
 * Valid CGC grade points
 * CGC only uses specific increments, not arbitrary decimals
 */
export const VALID_CGC_GRADES = [
  10.0,
  9.8, 9.6, 9.4, 9.2, 9.0,
  8.5, 8.0,
  7.5, 7.0,
  6.5, 6.0,
  5.5, 5.0,
  4.5, 4.0,
  3.5, 3.0,
  2.5, 2.0,
  1.8, 1.5, 1.0,
  0.5
] as const;

/**
 * Round a grade to the nearest valid CGC grade point
 * When in doubt, rounds DOWN (conservative grading)
 * 
 * @param grade - Raw calculated grade (0.0 - 10.0)
 * @returns Valid CGC grade point
 * 
 * @example
 * roundToCGCGrade(7.9) => 7.5  // Rounds down
 * roundToCGCGrade(9.1) => 9.0  // Rounds down
 * roundToCGCGrade(9.7) => 9.6  // Rounds down
 */
export function roundToCGCGrade(grade: number): number {
  // Handle NaN - return middle-of-road grade instead of falling through to 0.5
  if (isNaN(grade)) {
    console.warn('[roundToCGCGrade] Received NaN, returning 5.0 as fallback');
    return 5.0;
  }
  
  // Clamp to valid range
  const clamped = Math.max(0.5, Math.min(10.0, grade));
  
  // Find the nearest valid grade, rounding DOWN when between two values
  // Array is in descending order, so find first value <= input
  for (let i = 0; i < VALID_CGC_GRADES.length; i++) {
    const current = VALID_CGC_GRADES[i];
    
    // If the input is at or above this grade point, return it
    if (clamped >= current) {
      return current;
    }
  }
  
  // Fallback to lowest grade (should never reach here due to clamp)
  return 0.5;
}

/**
 * Defect type labels used by Nyckel classification
 */
export type DefectLabel = 
  // Structural (severe)
  | 'spine_split'
  | 'detached_cover'
  | 'missing_piece'
  | 'tear_major'
  // Structural (moderate)
  | 'spine_roll'
  | 'staple_rust'
  | 'tear_minor'
  // Surface
  | 'stain'
  | 'foxing'
  | 'color_touch'
  | 'fingerprint'
  | 'date_stamp'
  | 'writing'
  // Wear
  | 'corner_blunt'
  | 'color_break'
  | 'crease_minor'
  | 'spine_stress'
  // Clean
  | 'pristine';

/**
 * Region names for defect detection
 */
export type RegionName = 
  | 'spine'
  | 'corner_tl'
  | 'corner_tr'
  | 'corner_bl'
  | 'corner_br'
  | 'surface';

/**
 * Defect deductions (points subtracted from 10.0)
 * 
 * These values are the BASE deductions before region weighting.
 * Actual deduction = base × region weight
 * 
 * Categories:
 * - Structural (severe): Major damage affecting integrity
 * - Structural (moderate): Noticeable structural issues
 * - Surface: Cosmetic issues on cover surface
 * - Wear: General wear from handling/age
 */
export const DEFECT_DEDUCTIONS: Record<DefectLabel, number> = {
  // Structural (severe) - Major impact on grade
  spine_split: 3.0,      // Spine paper separating
  detached_cover: 4.0,   // Cover separated from staples
  missing_piece: 5.0,    // Paper missing from cover/pages
  tear_major: 2.5,       // Tear > 1/2" in length
  
  // Structural (moderate) - Significant but not severe
  spine_roll: 1.5,       // Spine curves outward
  staple_rust: 1.5,      // Oxidation on staples
  tear_minor: 1.0,       // Tear < 1/4" in length
  
  // Surface - Cosmetic issues
  color_touch: 2.0,      // Restoration/touch-up detected
  stain: 1.0,            // Visible staining
  foxing: 0.8,           // Age spots/oxidation spots
  fingerprint: 0.3,      // Visible oil marks
  date_stamp: 1.2,       // Date stamp on cover (subscription/newsstand)
  writing: 1.5,          // Writing, names, or marks on cover
  
  // Wear - General handling wear
  color_break: 0.5,      // Crease that breaks ink
  crease_minor: 0.4,     // Light crease, no color break
  corner_blunt: 0.3,     // Rounded corners
  spine_stress: 0.3,     // Light stress marks
  
  // Clean - No defect
  pristine: 0.0,         // No deduction
};

/**
 * Region importance weights
 * 
 * Different areas affect the grade differently:
 * - Spine: Most visible, structural integrity (1.5x)
 * - Corners: High visibility, common wear points (1.2x)
 * - Surface: Center area, less critical (1.0x)
 */
export const REGION_WEIGHTS: Record<RegionName, number> = {
  spine: 1.5,          // Most important - structural
  corner_tl: 1.2,      // Top left corner
  corner_tr: 1.2,      // Top right corner
  corner_bl: 1.2,      // Bottom left corner
  corner_br: 1.2,      // Bottom right corner
  surface: 1.0,        // Center/surface area
};

/**
 * Grade tier thresholds
 * Used for display and categorization
 */
export const GRADE_TIERS = {
  GEM_MINT: { min: 9.8, max: 10.0, label: 'Gem Mint', shortLabel: 'GM' },
  MINT: { min: 9.6, max: 9.7, label: 'Mint', shortLabel: 'MT' },
  NEAR_MINT_PLUS: { min: 9.4, max: 9.5, label: 'Near Mint+', shortLabel: 'NM+' },
  NEAR_MINT: { min: 9.0, max: 9.3, label: 'Near Mint', shortLabel: 'NM' },
  NEAR_MINT_MINUS: { min: 8.5, max: 8.9, label: 'Near Mint-', shortLabel: 'NM-' },
  VERY_FINE_PLUS: { min: 8.0, max: 8.4, label: 'Very Fine+', shortLabel: 'VF+' },
  VERY_FINE: { min: 7.5, max: 7.9, label: 'Very Fine', shortLabel: 'VF' },
  VERY_FINE_MINUS: { min: 7.0, max: 7.4, label: 'Very Fine-', shortLabel: 'VF-' },
  FINE_PLUS: { min: 6.5, max: 6.9, label: 'Fine+', shortLabel: 'FN+' },
  FINE: { min: 6.0, max: 6.4, label: 'Fine', shortLabel: 'FN' },
  FINE_MINUS: { min: 5.5, max: 5.9, label: 'Fine-', shortLabel: 'FN-' },
  VERY_GOOD_PLUS: { min: 5.0, max: 5.4, label: 'Very Good+', shortLabel: 'VG+' },
  VERY_GOOD: { min: 4.0, max: 4.9, label: 'Very Good', shortLabel: 'VG' },
  GOOD_PLUS: { min: 3.5, max: 3.9, label: 'Good+', shortLabel: 'GD+' },
  GOOD: { min: 2.5, max: 3.4, label: 'Good', shortLabel: 'GD' },
  FAIR: { min: 1.5, max: 2.4, label: 'Fair', shortLabel: 'FR' },
  POOR: { min: 0.5, max: 1.4, label: 'Poor', shortLabel: 'PR' },
} as const;

/**
 * Get grade tier info from numeric grade
 */
export function getGradeTier(grade: number): { label: string; shortLabel: string } {
  for (const tier of Object.values(GRADE_TIERS)) {
    if (grade >= tier.min && grade <= tier.max) {
      return { label: tier.label, shortLabel: tier.shortLabel };
    }
  }
  return { label: 'Poor', shortLabel: 'PR' };
}

/**
 * All defect labels for Nyckel training
 */
export const ALL_DEFECT_LABELS: DefectLabel[] = [
  // Structural
  'spine_split',
  'detached_cover',
  'missing_piece',
  'tear_major',
  'spine_roll',
  'staple_rust',
  'tear_minor',
  // Surface
  'stain',
  'foxing',
  'color_touch',
  'fingerprint',
  'date_stamp',
  'writing',
  // Wear
  'corner_blunt',
  'color_break',
  'crease_minor',
  'spine_stress',
  // Clean
  'pristine',
];

/**
 * All region names
 */
export const ALL_REGIONS: RegionName[] = [
  'spine',
  'corner_tl',
  'corner_tr',
  'corner_bl',
  'corner_br',
  'surface',
];

/**
 * Human-readable defect names for UI display
 */
export const DEFECT_DISPLAY_NAMES: Record<DefectLabel, string> = {
  spine_split: 'Spine Split',
  detached_cover: 'Detached Cover',
  missing_piece: 'Missing Piece',
  tear_major: 'Major Tear',
  spine_roll: 'Spine Roll',
  staple_rust: 'Staple Rust',
  tear_minor: 'Minor Tear',
  stain: 'Stain',
  foxing: 'Foxing',
  color_touch: 'Color Touch/Restoration',
  fingerprint: 'Fingerprints',
  date_stamp: 'Date Stamp',
  writing: 'Writing/Marks',
  corner_blunt: 'Corner Blunting',
  color_break: 'Color Breaking Crease',
  crease_minor: 'Minor Crease',
  spine_stress: 'Spine Stress',
  pristine: 'Pristine',
};

/**
 * Human-readable region names for UI display
 */
export const REGION_DISPLAY_NAMES: Record<RegionName, string> = {
  spine: 'Spine',
  corner_tl: 'Top Left Corner',
  corner_tr: 'Top Right Corner',
  corner_bl: 'Bottom Left Corner',
  corner_br: 'Bottom Right Corner',
  surface: 'Cover Surface',
};

