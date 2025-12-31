'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ListOrdered } from 'lucide-react';
import { 
  DEFECT_DEDUCTIONS, 
  REGION_WEIGHTS, 
  DEFECT_DISPLAY_NAMES,
  REGION_DISPLAY_NAMES,
  type DefectLabel,
  type RegionName 
} from '@/lib/grading-config';
import { 
  type DefectBreakdown, 
  type HybridGradeResult, 
  type CVAnalysisData
} from '@/lib/grade-adjustment';

interface GradeScorecardProps {
  hybridGrade: HybridGradeResult | null;
  cvAnalysis: CVAnalysisData | null;
  regionScores?: Record<string, number>;
  defectLabels?: Record<string, string[]>;
  defectBreakdown?: DefectBreakdown[];
}

/**
 * Get color class based on grade value
 */
function getGradeColor(grade: number): string {
  if (grade >= 9.0) return 'text-green-400';
  if (grade >= 7.0) return 'text-yellow-400';
  if (grade >= 5.0) return 'text-orange-400';
  return 'text-red-400';
}

export default function GradeScorecard({ 
  hybridGrade, 
  cvAnalysis,
  regionScores,
  defectLabels,
  defectBreakdown
}: GradeScorecardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Use data from props or hybridGrade
  const labels = defectLabels || hybridGrade?.cvAnalysis?.defectLabels || cvAnalysis?.defectLabels || {};
  const breakdown = defectBreakdown || hybridGrade?.defectBreakdown || [];
  
  // Check if we have defect data to show
  const hasDefectData = breakdown.length > 0 || Object.values(labels).some(arr => arr.length > 0 && arr[0] !== 'pristine');
  
  if (!hasDefectData) {
    return null; // Don't render if no defect data
  }
  
  // Build display breakdown from labels if no breakdown provided
  let displayBreakdown = breakdown;
  if (breakdown.length === 0 && Object.keys(labels).length > 0) {
    displayBreakdown = [];
    for (const [region, defectList] of Object.entries(labels)) {
      for (const defect of defectList) {
        if (defect === 'pristine') continue;
        const baseDeduction = DEFECT_DEDUCTIONS[defect as DefectLabel] || 0;
        const regionWeight = REGION_WEIGHTS[region as RegionName] || 1.0;
        displayBreakdown.push({
          region: region as RegionName,
          defect: defect as DefectLabel,
          baseDeduction,
          regionWeight,
          totalDeduction: baseDeduction * regionWeight
        });
      }
    }
  }
  
  const totalDeduction = displayBreakdown.reduce((sum, b) => sum + b.totalDeduction, 0);
  const calculatedGrade = Math.max(0.5, 10.0 - totalDeduction);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 max-w-2xl w-full mb-4 overflow-hidden">
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Defect Ledger
          </h3>
          <span className="text-xs text-gray-500">
            ({displayBreakdown.length} issue{displayBreakdown.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-mono font-bold ${getGradeColor(calculatedGrade)}`}>
            {calculatedGrade.toFixed(1)}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>
      
      {/* Expanded Content - Defect Ledger */}
      {isExpanded && (
        <div className="border-t border-gray-700 p-4">
          <div className="space-y-2">
            {/* Starting grade */}
            <div className="flex items-center justify-between text-sm border-b border-gray-600 pb-2">
              <span className="text-gray-400">Starting Grade</span>
              <span className="font-mono font-bold text-green-400">10.0</span>
            </div>
            
            {/* Deduction lines */}
            {displayBreakdown.length > 0 ? (
              <div className="space-y-1.5 py-2">
                {displayBreakdown.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-red-400 font-mono">-{item.totalDeduction.toFixed(2)}</span>
                      <span className="text-gray-300">
                        {DEFECT_DISPLAY_NAMES[item.defect] || item.defect}
                      </span>
                      <span className="text-gray-500 text-[10px]">
                        ({REGION_DISPLAY_NAMES[item.region] || item.region})
                      </span>
                    </div>
                    <span className="text-gray-500 font-mono text-[10px]">
                      {item.baseDeduction} × {item.regionWeight}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-gray-500 text-sm italic">
                No defects detected - pristine condition
              </div>
            )}
            
            {/* Total line */}
            <div className="flex items-center justify-between text-sm border-t border-gray-600 pt-2">
              <span className="text-white font-bold">Defect-Based Grade</span>
              <span className={`font-mono font-black text-lg ${getGradeColor(calculatedGrade)}`}>
                {calculatedGrade.toFixed(1)}
              </span>
            </div>
            
            {/* Total deduction */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Total Deductions</span>
              <span className="font-mono text-red-400">-{totalDeduction.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
