'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Calculator, MinusCircle } from 'lucide-react';
import { DEFECT_DEDUCTIONS, REGION_WEIGHTS, REGION_DISPLAY_NAMES, DEFECT_DISPLAY_NAMES, roundToCGCGrade, type DefectLabel, type RegionName } from '@/lib/grading-config';

interface MathComponentCardProps {
  defects: any[]; // Array of defects from AI or CV
  regionGrades?: Record<string, { grade: number; label: string; confidence: number }>; // From CV analysis
  baseGrade?: number;
  finalGrade?: string;
}

export default function MathComponentCard({
  defects = [],
  regionGrades,
  baseGrade = 10.0,
  finalGrade
}: MathComponentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // DEBUG: Log what we're receiving
  console.log('[MathComponentCard] Props:', {
    finalGrade,
    regionGrades,
    defectsCount: defects.length,
    baseGrade
  });

  // MEMOIZE calculations to prevent re-computing on every render
  const { calculatedDeductions, totalDeductions, calculationMethod, calculatedFinalGrade, displayFinal, hasAIGrade } = useMemo(() => {
    let deductions: Array<{ name: string; note: string; value: number; region?: string }> = [];
    let total = 0;
    let method = 'estimated';
    let finalGradeNum: number;
    let aiGradeUsed = false;

    if (regionGrades && Object.keys(regionGrades).length > 0) {
      // REAL MATH: Calculate deductions from region-based grading (FOR DISPLAY ONLY)
      method = 'region-based';
      
      console.log('[MathComponentCard] Using region-based calculation');
      console.log('[MathComponentCard] Region grades:', regionGrades);
      
      // For each region, calculate the deduction (FOR DISPLAY)
      Object.entries(regionGrades).forEach(([regionName, regionData]) => {
        const regionWeight = REGION_WEIGHTS[regionName as RegionName] || 1.0;
        const regionGrade = regionData.grade;
        const regionLabel = regionData.label;
        
        console.log(`[MathComponentCard] ${regionName}: grade=${regionGrade}, label=${regionLabel}, weight=${regionWeight}`);
        
        // Deduction = (10.0 - regionGrade) × regionWeight (FOR DISPLAY PURPOSES)
        const baseDeduction = 10.0 - regionGrade;
        const weightedDeduction = baseDeduction * regionWeight;
        
        if (weightedDeduction > 0.05) { // Only show if meaningful
          const displayName = REGION_DISPLAY_NAMES[regionName as RegionName] || regionName;
          const conditionLabel = regionLabel.replace(/_/g, ' ');
          
          deductions.push({
            name: `${displayName}`,
            note: `Condition: ${conditionLabel} (${regionGrade.toFixed(1)}/10) × ${regionWeight}× weight`,
            value: weightedDeduction,
            region: regionName
          });
          
          total += weightedDeduction;
        }
      });

      // Sort by deduction value (highest first)
      deductions.sort((a, b) => b.value - a.value);
      
      // IMPORTANT: The final grade comes from the weighted average (already calculated in finalGrade prop)
      // NOT from subtracting deductions! The deductions are just for display.
      finalGradeNum = finalGrade ? parseFloat(finalGrade) : roundToCGCGrade(baseGrade - total);
      
      console.log('[MathComponentCard] Final grade calculation:', {
        fromProp: finalGrade,
        calculated: roundToCGCGrade(baseGrade - total),
        used: finalGradeNum
      });
    } else {
      // FALLBACK: Estimate from defects (old heuristic method)
      method = 'estimated';
      
      console.log('[MathComponentCard] Using estimated calculation from defects');
      
      // If we have a final grade from AI, use that and calculate the total deduction backwards
      // This ensures the math always adds up correctly: 10.0 - total = finalGrade
      if (finalGrade) {
        finalGradeNum = parseFloat(finalGrade);
        total = baseGrade - finalGradeNum; // Calculate actual deduction from the grade
        aiGradeUsed = true;
        
        // Still show individual defects for informational purposes, but don't use their values
        deductions = defects.map(d => {
          return {
            name: d.defect || d.type || 'Defect',
            note: d.note || d.description || d.text || 'Detected defect',
            value: 0 // Don't show individual values since they're just heuristics
          };
        });
        
        console.log('[MathComponentCard] Using AI grade with calculated deduction:', { finalGradeNum, total });
      } else {
        // No final grade provided - use heuristic estimation
        deductions = defects.map(d => {
          let value = 0.0;
          const severity = d.severity?.toLowerCase() || '';
          const note = (d.note || d.text || '').toLowerCase();
          
          // Heuristic deduction estimation
          if (severity === 'severe' || note.includes('major') || note.includes('tear')) value = 1.5;
          else if (severity === 'moderate' || note.includes('moderate') || note.includes('crease')) value = 0.8;
          else if (severity === 'minor' || note.includes('minor')) value = 0.3;
          else value = 0.5; // Default

          return {
            name: d.defect || d.type || 'Defect',
            note: d.note || d.description || d.text || 'Detected defect',
            value: value
          };
        });

        total = deductions.reduce((sum, d) => sum + d.value, 0);
        finalGradeNum = roundToCGCGrade(Math.max(0.5, baseGrade - total));
        
        console.log('[MathComponentCard] Estimated final grade:', finalGradeNum);
      }
    }

    const display = finalGrade || finalGradeNum.toFixed(1);
    
    console.log('[MathComponentCard] Display final:', display);

    return {
      calculatedDeductions: deductions,
      totalDeductions: total,
      calculationMethod: method,
      calculatedFinalGrade: finalGradeNum,
      displayFinal: display,
      hasAIGrade: aiGradeUsed
    };
  }, [defects, regionGrades, baseGrade, finalGrade]); // Only recalculate when these change

  if (calculatedDeductions.length === 0) return null;

  return (
    <div className="w-full max-w-2xl bg-gray-800 rounded-xl border border-gray-700 mb-6 overflow-hidden">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-gray-300 uppercase tracking-wide">Grading Receipt</span>
        </div>
        <div className="flex items-center gap-3">
           <span className="text-xs text-gray-500">
             {calculatedDeductions.length} deductions
           </span>
           {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-gray-700 bg-gray-900/30">
          <div className="space-y-3">
            {/* Calculation Method Badge */}
            <div className="flex justify-center mb-3">
              <span className={`text-[10px] px-3 py-1 rounded-full font-medium ${
                calculationMethod === 'region-based' 
                  ? 'bg-blue-900/50 text-blue-300 border border-blue-700' 
                  : hasAIGrade 
                    ? 'bg-purple-900/50 text-purple-300 border border-purple-700'
                    : 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
              }`}>
                {calculationMethod === 'region-based' 
                  ? '📐 Region-Based Math' 
                  : hasAIGrade 
                    ? '🤖 AI Grade Analysis' 
                    : '⚠️ Estimated (Train ML for accuracy)'}
              </span>
            </div>

            {/* Base Score */}
            <div className="flex justify-between items-center pb-2 border-b border-gray-700 border-dashed">
              <span className="text-sm text-gray-400">Base Score</span>
              <span className="text-sm font-mono font-bold text-white">{baseGrade.toFixed(1)}</span>
            </div>

            {/* Deductions */}
            {hasAIGrade ? (
              // When using AI grade, show defects as a simple list (no individual values)
              <>
                <div className="space-y-2">
                  {calculatedDeductions.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <MinusCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="text-gray-300 font-medium">{d.name}</span>
                        <span className="text-gray-500 text-[10px] block leading-relaxed">{d.note}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Single total deduction line */}
                <div className="flex justify-between items-center pt-2 border-t border-gray-700 border-dashed text-xs">
                  <span className="text-gray-400">Total Condition Impact</span>
                  <span className="text-red-400 font-mono font-bold">-{totalDeductions.toFixed(1)}</span>
                </div>
              </>
            ) : (
              // When estimating, show individual heuristic values
              <>
                {calculatedDeductions.map((d, i) => (
                  <div key={i} className="flex justify-between items-start text-xs">
                    <div className="flex items-start gap-2 flex-1 mr-2">
                       <MinusCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
                       <div className="flex-1">
                         <span className="text-gray-300 font-medium block">{d.name}</span>
                         <span className="text-gray-500 text-[10px] leading-relaxed">{d.note}</span>
                       </div>
                    </div>
                    <span className="text-red-400 font-mono font-bold flex-shrink-0">-{d.value.toFixed(2)}</span>
                  </div>
                ))}

                {/* Total Deductions Summary */}
                {calculatedDeductions.length > 1 && (
                  <div className="flex justify-between items-center pt-2 border-t border-gray-700 border-dashed text-xs">
                    <span className="text-gray-400">Total Deductions</span>
                    <span className="text-red-400 font-mono font-bold">-{totalDeductions.toFixed(2)}</span>
                  </div>
                )}
              </>
            )}

            {/* Final Calculation */}
            <div className="flex justify-between items-center pt-3 border-t border-gray-600 mt-2">
              <span className="text-sm font-bold text-white">Final Grade</span>
              <div className="flex items-center gap-2">
                {calculationMethod === 'region-based' ? (
                  <span className="text-xs text-gray-500 font-mono">Weighted Avg:</span>
                ) : (
                  <span className="text-xs text-gray-500 font-mono">{baseGrade.toFixed(1)} - {totalDeductions.toFixed(2)} =</span>
                )}
                <span className={`text-lg font-black font-mono ${
                  parseFloat(displayFinal) >= 9.0 ? 'text-green-400' : 
                  parseFloat(displayFinal) >= 7.0 ? 'text-yellow-400' : 'text-orange-400'
                }`}>
                  {displayFinal}
                </span>
              </div>
            </div>
            
            {calculationMethod === 'region-based' ? (
              <p className="text-[10px] text-gray-500 italic mt-2 text-center leading-relaxed">
                * Deductions shown above are for reference only. Final grade is calculated using weighted average of region grades,
                <br />
                not by subtracting deductions. Spine weight: 1.5×, Corners: 1.2×, Surface: 1.0×
              </p>
            ) : hasAIGrade ? (
              <p className="text-[10px] text-blue-400 italic mt-2 text-center leading-relaxed">
                * Grade determined by AI analysis. Defects listed above were detected during grading.
              </p>
            ) : (
              <p className="text-[10px] text-yellow-500 italic mt-2 text-center leading-relaxed">
                * ⚠️ Estimated deductions only. Train the ML model for accurate region-based grading.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
