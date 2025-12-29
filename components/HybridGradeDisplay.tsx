'use client';

import { useState } from 'react';
import { Sparkles, ScanLine, Info, AlertTriangle } from 'lucide-react';
import type { HybridGradeResult } from '@/lib/grade-adjustment';

interface HybridGradeDisplayProps {
  hybridGrade: HybridGradeResult;
}

export default function HybridGradeDisplay({ hybridGrade }: HybridGradeDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);
  const isRange = hybridGrade.finalGrade.includes('-');
  
  return (
    <div className="bg-gray-900 p-4 rounded-xl border border-purple-500/30">
      {/* Main Grade */}
      <div className="text-center mb-4">
        <div className="text-5xl font-bold text-white mb-2">
          {hybridGrade.finalGrade}
        </div>
        <div className="text-lg text-gray-400">
          {hybridGrade.displayGrade}
        </div>
        
        {/* Confidence Badge */}
        <div className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium ${
          hybridGrade.overallConfidence === 'very-high' ? 'bg-green-900/50 text-green-400' :
          hybridGrade.overallConfidence === 'high' ? 'bg-blue-900/50 text-blue-400' :
          hybridGrade.overallConfidence === 'medium' ? 'bg-yellow-900/50 text-yellow-400' :
          'bg-red-900/50 text-red-400'
        }`}>
          {hybridGrade.overallConfidence === 'very-high' ? '✓ Very High Confidence' :
           hybridGrade.overallConfidence === 'high' ? '✓ High Confidence' :
           hybridGrade.overallConfidence === 'medium' ? '⚠ Medium Confidence' :
           '⚠ Low Confidence - Review Recommended'}
        </div>
      </div>
      
      {/* Agreement Status */}
      {isRange && (
        <div className="mb-4 p-3 bg-yellow-900/20 rounded-lg border border-yellow-700/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-yellow-400">
              Grade Range Detected
            </span>
          </div>
          <p className="text-xs text-gray-300">
            {hybridGrade.reasoning}
          </p>
        </div>
      )}
      
      {/* AI vs CV Comparison */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* AI Assessment */}
        <div className="bg-purple-900/20 p-3 rounded-lg border border-purple-700/30">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-medium text-purple-400">AI Analysis</span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {hybridGrade.aiGrade}
          </div>
          <div className="text-[10px] text-gray-400">
            {hybridGrade.aiConfidence} confidence
          </div>
        </div>
        
        {/* CV Assessment */}
        <div className="bg-cyan-900/20 p-3 rounded-lg border border-cyan-700/30">
          <div className="flex items-center gap-2 mb-2">
            <ScanLine className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-medium text-cyan-400">CV Analysis</span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {hybridGrade.cvGrade}
          </div>
          <div className="text-[10px] text-gray-400">
            {hybridGrade.cvAnalysis.damageScore.toFixed(0)}% damage
          </div>
        </div>
      </div>
      
      {/* Agreement Visualization */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
          <span>AI: {hybridGrade.aiGrade}</span>
          <span className={`font-medium ${
            hybridGrade.agreement === 'strong' ? 'text-green-400' :
            hybridGrade.agreement === 'moderate' ? 'text-yellow-400' :
            hybridGrade.agreement === 'weak' ? 'text-orange-400' :
            'text-red-400'
          }`}>
            {hybridGrade.agreement === 'strong' ? 'Strong Agreement' :
             hybridGrade.agreement === 'moderate' ? 'Moderate Agreement' :
             hybridGrade.agreement === 'weak' ? 'Weak Agreement' :
             'Conflict'}
          </span>
          <span>CV: {hybridGrade.cvGrade}</span>
        </div>
        
        {/* Visual grade spectrum */}
        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className="absolute inset-0 flex">
            {/* Gradient bar */}
            <div className="flex-1 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500"></div>
          </div>
          
          {/* AI marker */}
          <div 
            className="absolute top-0 bottom-0 w-1 bg-purple-400 shadow-lg"
            style={{ left: `${(parseFloat(hybridGrade.aiGrade) / 10) * 100}%` }}
          />
          
          {/* CV marker */}
          <div 
            className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-lg"
            style={{ left: `${(parseFloat(hybridGrade.cvGrade) / 10) * 100}%` }}
          />
        </div>
        
        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
          <span>0.0</span>
          <span>5.0</span>
          <span>10.0</span>
        </div>
      </div>
      
      {/* Detailed Reasoning */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-xs text-gray-400 hover:text-white flex items-center justify-center gap-1 transition-colors"
      >
        <Info className="w-3 h-3" />
        {showDetails ? 'Hide' : 'Show'} Detailed Analysis
      </button>
      
      {/* Expanded Details */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
          {/* AI Reasoning */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span className="text-xs font-medium text-purple-400">AI Reasoning</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              {hybridGrade.aiReasoning}
            </p>
          </div>
          
          {/* CV Reasoning */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ScanLine className="w-3 h-3 text-cyan-400" />
              <span className="text-xs font-medium text-cyan-400">CV Reasoning</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              {hybridGrade.cvReasoning}
            </p>
          </div>
          
          {/* Region Breakdown */}
          {hybridGrade.cvAnalysis?.regionScores && Object.keys(hybridGrade.cvAnalysis.regionScores).length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400 mb-2">Region Damage Scores</div>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(hybridGrade.cvAnalysis.regionScores).map(([region, score]) => {
                  const scoreNum = score as number;
                  const regionLabel = region === 'spine' ? 'Spine' : 
                                     region === 'surface' ? 'Surface' :
                                     region.replace('corner_', '').toUpperCase();
                  return (
                    <div 
                      key={region}
                      className={`text-center py-1 px-2 rounded text-xs ${
                        scoreNum < 20 ? 'bg-green-900/30 text-green-400' :
                        scoreNum < 40 ? 'bg-yellow-900/30 text-yellow-400' :
                        scoreNum < 65 ? 'bg-orange-900/30 text-orange-400' :
                        'bg-red-900/30 text-red-400'
                      }`}
                    >
                      <div className="font-bold">{scoreNum.toFixed(0)}%</div>
                      <div className="text-[10px] opacity-75">{regionLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}



