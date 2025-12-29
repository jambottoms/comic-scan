'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Calculator, MinusCircle } from 'lucide-react';

interface MathComponentCardProps {
  defects: any[]; // Array of defects from AI or CV
  baseGrade?: number;
  finalGrade?: string;
}

export default function MathComponentCard({
  defects = [],
  baseGrade = 10.0,
  finalGrade
}: MathComponentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Calculate deductions (simplified logic for display)
  // In a real app, this would come from the backend's grading engine
  const calculatedDeductions = defects.map(d => {
    let value = 0.0;
    const severity = d.severity?.toLowerCase() || '';
    const note = (d.note || d.text || '').toLowerCase();
    
    // Heuristic deduction estimation
    if (severity === 'severe' || note.includes('major') || note.includes('tear')) value = 1.0;
    else if (severity === 'moderate' || note.includes('moderate') || note.includes('crease')) value = 0.5;
    else value = 0.2; // Minor/Default

    return {
      name: d.defect || d.type || 'Defect',
      note: d.note || d.description || d.text,
      value: value
    };
  });

  const totalDeductions = calculatedDeductions.reduce((sum, d) => sum + d.value, 0);
  const calculatedFinal = Math.max(0.5, baseGrade - totalDeductions).toFixed(1);
  const displayFinal = finalGrade || calculatedFinal;

  if (defects.length === 0) return null;

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
             {defects.length} deductions
           </span>
           {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-gray-700 bg-gray-900/30">
          <div className="space-y-3">
            {/* Base Score */}
            <div className="flex justify-between items-center pb-2 border-b border-gray-700 border-dashed">
              <span className="text-sm text-gray-400">Base Score</span>
              <span className="text-sm font-mono font-bold text-white">{baseGrade.toFixed(1)}</span>
            </div>

            {/* Deductions */}
            {calculatedDeductions.map((d, i) => (
              <div key={i} className="flex justify-between items-start text-xs">
                <div className="flex items-start gap-2">
                   <MinusCircle className="w-3 h-3 text-red-400 mt-0.5" />
                   <div>
                     <span className="text-gray-300 font-medium block">{d.name}</span>
                     <span className="text-gray-500 text-[10px]">{d.note}</span>
                   </div>
                </div>
                <span className="text-red-400 font-mono">-{d.value.toFixed(1)}</span>
              </div>
            ))}

            {/* Final Calculation */}
            <div className="flex justify-between items-center pt-3 border-t border-gray-600 mt-2">
              <span className="text-sm font-bold text-white">Calculated Grade</span>
              <span className={`text-lg font-black font-mono ${
                parseFloat(displayFinal) >= 9.0 ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {displayFinal}
              </span>
            </div>
            
            <p className="text-[10px] text-gray-500 italic mt-2 text-center">
              * Deductions are estimated based on visible defects. Final verification by CV.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
