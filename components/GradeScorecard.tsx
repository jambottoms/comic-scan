'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Scale, ListOrdered, GitMerge } from 'lucide-react';
import { 
  DEFECT_DEDUCTIONS, 
  REGION_WEIGHTS, 
  DEFECT_DISPLAY_NAMES,
  REGION_DISPLAY_NAMES,
  getGradeTier,
  type DefectLabel,
  type RegionName 
} from '@/lib/grading-config';
import { 
  type DefectBreakdown, 
  type HybridGradeResult, 
  type CVAnalysisData,
  type NyckelRegionGrade,
  type NyckelAnalysisData
} from '@/lib/grade-adjustment';

interface GradeScorecardProps {
  hybridGrade: HybridGradeResult | null;
  cvAnalysis: CVAnalysisData | null;
  nyckelAnalysis?: NyckelAnalysisData | null;
  regionScores?: Record<string, number>;
  defectLabels?: Record<string, string[]>;
  defectBreakdown?: DefectBreakdown[];
  nyckelRegions?: Record<string, NyckelRegionGrade>;
}

type TabId = 'regions' | 'ledger' | 'fusion';

/**
 * Convert damage percentage (0-100) to grade (0.5-10.0)
 * 0% damage = 10.0, 100% damage = 0.5
 */
function damageToGrade(damagePercent: number): number {
  return Math.max(0.5, 10.0 - (damagePercent / 10.5));
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

/**
 * Get background color class based on grade value
 */
function getGradeBgColor(grade: number): string {
  if (grade >= 9.0) return 'bg-green-500';
  if (grade >= 7.0) return 'bg-yellow-500';
  if (grade >= 5.0) return 'bg-orange-500';
  return 'bg-red-500';
}

/**
 * Get confidence badge styling
 */
function getConfidenceStyle(confidence: string): { bg: string; text: string } {
  switch (confidence) {
    case 'very-high':
      return { bg: 'bg-green-900/30', text: 'text-green-400' };
    case 'high':
      return { bg: 'bg-green-900/20', text: 'text-green-400' };
    case 'medium':
      return { bg: 'bg-yellow-900/20', text: 'text-yellow-400' };
    case 'low':
    default:
      return { bg: 'bg-red-900/20', text: 'text-red-400' };
  }
}

/**
 * Get agreement badge styling
 */
function getAgreementStyle(agreement: string): { bg: string; text: string; label: string } {
  switch (agreement) {
    case 'strong':
      return { bg: 'bg-green-900/30', text: 'text-green-400', label: 'Strong Agreement' };
    case 'moderate':
      return { bg: 'bg-yellow-900/20', text: 'text-yellow-400', label: 'Moderate Agreement' };
    case 'weak':
      return { bg: 'bg-orange-900/20', text: 'text-orange-400', label: 'Weak Agreement' };
    case 'conflict':
    default:
      return { bg: 'bg-red-900/20', text: 'text-red-400', label: 'Conflict - Review Needed' };
  }
}

export default function GradeScorecard({ 
  hybridGrade, 
  cvAnalysis,
  nyckelAnalysis,
  regionScores,
  defectLabels,
  defectBreakdown,
  nyckelRegions 
}: GradeScorecardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('regions');
  
  // Use data from props or hybridGrade
  const scores = regionScores || hybridGrade?.cvAnalysis?.regionScores || cvAnalysis?.regionScores || {};
  const labels = defectLabels || hybridGrade?.cvAnalysis?.defectLabels || cvAnalysis?.defectLabels || {};
  const breakdown = defectBreakdown || hybridGrade?.defectBreakdown || [];
  
  // Nyckel ML region grades (new format with labels and confidence)
  const nyckelGrades = nyckelRegions || 
    (hybridGrade as any)?.nyckelRegions || 
    nyckelAnalysis?.regionGrades || 
    cvAnalysis?.regionGrades ||
    null;
  
  // Check if we have Nyckel ML data
  const hasNyckelData = nyckelGrades !== null && Object.keys(nyckelGrades || {}).length > 0;
  
  // Check if we have any data to show
  const hasRegionData = Object.keys(scores).length > 0 || hasNyckelData;
  const hasDefectData = breakdown.length > 0 || Object.values(labels).some(arr => arr.length > 0 && arr[0] !== 'pristine');
  const hasFusionData = hybridGrade !== null;
  
  if (!hasRegionData && !hasDefectData && !hasFusionData) {
    return null; // Don't render if no data
  }
  
  // Calculate weighted region score
  const regionGrades: Record<string, number> = {};
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const [region, damagePercent] of Object.entries(scores)) {
    const grade = damageToGrade(damagePercent);
    regionGrades[region] = grade;
    const weight = REGION_WEIGHTS[region as RegionName] || 1.0;
    weightedSum += grade * weight;
    totalWeight += weight;
  }
  
  const compositeGrade = totalWeight > 0 ? weightedSum / totalWeight : 10.0;
  
  // Calculate defect-based grade from breakdown
  let defectGrade = 10.0;
  if (breakdown.length > 0) {
    const totalDeduction = breakdown.reduce((sum, b) => sum + b.totalDeduction, 0);
    defectGrade = Math.max(0.5, 10.0 - totalDeduction);
  }

  const tabs = [
    { id: 'regions' as TabId, label: 'Regions', icon: Scale, available: hasRegionData },
    { id: 'ledger' as TabId, label: 'Deductions', icon: ListOrdered, available: hasDefectData },
    { id: 'fusion' as TabId, label: 'Fusion', icon: GitMerge, available: hasFusionData },
  ].filter(t => t.available);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 max-w-2xl w-full mb-4 overflow-hidden">
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Grading Scorecard
          </h3>
          {hybridGrade && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${getConfidenceStyle(hybridGrade.overallConfidence).bg} ${getConfidenceStyle(hybridGrade.overallConfidence).text}`}>
              {hybridGrade.overallConfidence.toUpperCase()}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
      
      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-700">
          {/* Tab Navigation */}
          <div className="flex border-b border-gray-700">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 px-3 text-xs font-medium uppercase tracking-wide flex items-center justify-center gap-1.5 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-700 text-white border-b-2 border-purple-500'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
          
          {/* Tab Content */}
          <div className="p-4">
            {activeTab === 'regions' && hasRegionData && (
              <RegionScoresPanel 
                scores={scores} 
                labels={labels} 
                regionGrades={regionGrades}
                compositeGrade={compositeGrade}
                nyckelGrades={nyckelGrades}
              />
            )}
            
            {activeTab === 'ledger' && (
              <DefectLedgerPanel 
                breakdown={breakdown}
                labels={labels}
                defectGrade={defectGrade}
              />
            )}
            
            {activeTab === 'fusion' && hasFusionData && hybridGrade && (
              <GradeFusionPanel hybridGrade={hybridGrade} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Panel 1: Region Scores (CGC-Style)
// ============================================
function RegionScoresPanel({ 
  scores, 
  labels, 
  regionGrades,
  compositeGrade,
  nyckelGrades
}: { 
  scores: Record<string, number>;
  labels: Record<string, string[]>;
  regionGrades: Record<string, number>;
  compositeGrade: number;
  nyckelGrades?: Record<string, NyckelRegionGrade> | null;
}) {
  // Use Nyckel grades if available, otherwise fall back to damage-based grades
  const hasNyckel = nyckelGrades && Object.keys(nyckelGrades).length > 0;
  
  // Get grade for a region (prefer Nyckel, fall back to damage-based)
  const getRegionGrade = (region: string): number => {
    if (hasNyckel && nyckelGrades?.[region]) {
      return nyckelGrades[region].grade;
    }
    return regionGrades[region] ?? 10.0;
  };
  
  // Get label for a region (from Nyckel or defect labels)
  const getRegionLabel = (region: string): string | null => {
    if (hasNyckel && nyckelGrades?.[region]) {
      return nyckelGrades[region].label;
    }
    const defects = labels[region];
    if (defects && defects.length > 0 && defects[0] !== 'pristine') {
      return defects[0];
    }
    return null;
  };
  
  // Get confidence for a region (from Nyckel)
  const getRegionConfidence = (region: string): number | null => {
    if (hasNyckel && nyckelGrades?.[region]) {
      return nyckelGrades[region].confidence;
    }
    return null;
  };
  
  // Determine which regions have data
  const regionsWithData = hasNyckel 
    ? Object.keys(nyckelGrades || {})
    : Object.keys(regionGrades);
  
  // Group corners together
  const cornerRegions = ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br'];
  const availableCorners = cornerRegions.filter(r => regionsWithData.includes(r));
  const cornerGrades = availableCorners.map(r => getRegionGrade(r));
  const avgCornerGrade = cornerGrades.length > 0 
    ? cornerGrades.reduce((a, b) => a + b, 0) / cornerGrades.length 
    : 10.0;

  // Calculate composite from Nyckel grades if available
  let displayComposite = compositeGrade;
  if (hasNyckel) {
    let totalWeight = 0;
    let weightedSum = 0;
    for (const region of regionsWithData) {
      const grade = getRegionGrade(region);
      const weight = REGION_WEIGHTS[region as RegionName] || 1.0;
      weightedSum += grade * weight;
      totalWeight += weight;
    }
    displayComposite = totalWeight > 0 ? weightedSum / totalWeight : 10.0;
  }

  return (
    <div className="space-y-3">
      {/* Nyckel ML indicator */}
      {hasNyckel && (
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-700">
          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/30 text-purple-400 font-medium">
            ML-Powered
          </span>
          <span className="text-[10px] text-gray-500">
            Grades from Nyckel region classifier
          </span>
        </div>
      )}
      
      {/* Spine */}
      {regionsWithData.includes('spine') && (
        <RegionRow 
          name="Spine" 
          grade={getRegionGrade('spine')} 
          weight={REGION_WEIGHTS['spine']}
          defects={labels['spine']}
          gradeLabel={getRegionLabel('spine')}
          confidence={getRegionConfidence('spine')}
        />
      )}
      
      {/* Corners (grouped) */}
      {availableCorners.length > 0 && (
        <div className="space-y-1">
          <RegionRow 
            name="Corners" 
            grade={avgCornerGrade} 
            weight={1.2}
            isGroup
          />
          <div className="pl-4 space-y-1">
            {availableCorners.map(region => (
              <RegionRow 
                key={region}
                name={REGION_DISPLAY_NAMES[region as RegionName] || region} 
                grade={getRegionGrade(region)} 
                weight={REGION_WEIGHTS[region as RegionName]}
                defects={labels[region]}
                gradeLabel={getRegionLabel(region)}
                confidence={getRegionConfidence(region)}
                isSubItem
              />
            ))}
          </div>
        </div>
      )}
      
      {/* Surface */}
      {regionsWithData.includes('surface') && (
        <RegionRow 
          name="Surface" 
          grade={getRegionGrade('surface')} 
          weight={REGION_WEIGHTS['surface']}
          defects={labels['surface']}
          gradeLabel={getRegionLabel('surface')}
          confidence={getRegionConfidence('surface')}
        />
      )}
      
      {/* Divider */}
      <div className="border-t border-gray-600 pt-3 mt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-white">Weighted Composite</span>
          <span className={`text-lg font-black font-mono ${getGradeColor(displayComposite)}`}>
            {displayComposite.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}

function RegionRow({ 
  name, 
  grade, 
  weight,
  defects,
  gradeLabel,
  confidence,
  isGroup = false,
  isSubItem = false
}: { 
  name: string; 
  grade: number; 
  weight: number;
  defects?: string[];
  gradeLabel?: string | null;
  confidence?: number | null;
  isGroup?: boolean;
  isSubItem?: boolean;
}) {
  const barWidth = (grade / 10) * 100;
  const hasDefects = defects && defects.length > 0 && defects[0] !== 'pristine';
  
  // Format grade label for display
  const formatLabel = (label: string): string => {
    return label.replace(/_/g, ' ').split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  
  // Get confidence badge color
  const getConfidenceBadgeColor = (conf: number): string => {
    if (conf >= 0.85) return 'bg-green-900/30 text-green-400';
    if (conf >= 0.7) return 'bg-yellow-900/30 text-yellow-400';
    return 'bg-red-900/30 text-red-400';
  };
  
  return (
    <div className={`flex items-center gap-3 ${isSubItem ? 'text-xs' : 'text-sm'}`}>
      <div className={`${isSubItem ? 'w-24' : 'w-20'} ${isGroup ? 'font-semibold text-white' : 'text-gray-300'}`}>
        {isSubItem && <span className="text-gray-600 mr-1">•</span>}
        {name}
      </div>
      
      {/* Progress bar */}
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all ${getGradeBgColor(grade)}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      
      {/* Grade value */}
      <div className={`w-10 text-right font-mono font-bold ${getGradeColor(grade)}`}>
        {grade.toFixed(1)}
      </div>
      
      {/* Weight indicator (when not sub-item) */}
      {!isSubItem && !gradeLabel && (
        <div className="w-8 text-right text-[10px] text-gray-500 font-mono">
          ×{weight}
        </div>
      )}
      
      {/* Grade label from Nyckel (e.g., "Near Mint") */}
      {gradeLabel && !isGroup && (
        <div className="text-[10px] text-gray-400 truncate max-w-[70px]" title={gradeLabel}>
          {formatLabel(gradeLabel)}
        </div>
      )}
      
      {/* Confidence badge from Nyckel */}
      {confidence !== null && confidence !== undefined && !isGroup && (
        <div 
          className={`text-[9px] px-1 py-0.5 rounded font-mono ${getConfidenceBadgeColor(confidence)}`}
          title={`Confidence: ${(confidence * 100).toFixed(0)}%`}
        >
          {(confidence * 100).toFixed(0)}%
        </div>
      )}
      
      {/* Defect indicator (fallback when no gradeLabel) */}
      {hasDefects && !gradeLabel && !isGroup && (
        <div className="text-[10px] text-red-400 truncate max-w-[60px]" title={defects?.join(', ')}>
          {defects?.[0]}
        </div>
      )}
    </div>
  );
}

// ============================================
// Panel 2: Defect Ledger
// ============================================
function DefectLedgerPanel({ 
  breakdown, 
  labels,
  defectGrade 
}: { 
  breakdown: DefectBreakdown[];
  labels: Record<string, string[]>;
  defectGrade: number;
}) {
  // If no breakdown but we have labels, create synthetic breakdown
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
  );
}

// ============================================
// Panel 3: Grade Fusion
// ============================================
function GradeFusionPanel({ hybridGrade }: { hybridGrade: HybridGradeResult }) {
  const agreementStyle = getAgreementStyle(hybridGrade.agreement);
  const confidenceStyle = getConfidenceStyle(hybridGrade.overallConfidence);
  
  // Determine weights used
  const hasDefectGrade = hybridGrade.defectGrade !== undefined;
  const aiWeight = hasDefectGrade ? 40 : 60;
  const cvWeight = hasDefectGrade ? 30 : 40;
  const defectWeight = hasDefectGrade ? 30 : 0;
  
  const aiGrade = parseFloat(hybridGrade.aiGrade);
  const cvGrade = parseFloat(hybridGrade.cvGrade);
  const defGrade = hybridGrade.defectGrade ? parseFloat(hybridGrade.defectGrade) : 0;
  
  // Parse final grade (might be a range like "8.0-9.0")
  const finalGradeStr = hybridGrade.finalGrade;
  const isRange = finalGradeStr.includes('-');
  const finalGradeNum = isRange 
    ? (parseFloat(finalGradeStr.split('-')[0]) + parseFloat(finalGradeStr.split('-')[1])) / 2
    : parseFloat(finalGradeStr);
  
  const tier = getGradeTier(finalGradeNum);

  return (
    <div className="space-y-4">
      {/* Grade Sources */}
      <div className="space-y-2">
        <GradeSourceRow 
          label="AI Analysis" 
          grade={aiGrade} 
          weight={aiWeight}
          confidence={hybridGrade.aiConfidence}
        />
        <GradeSourceRow 
          label="CV Analysis" 
          grade={cvGrade} 
          weight={cvWeight}
          confidence={hybridGrade.cvConfidence}
        />
        {hasDefectGrade && (
          <GradeSourceRow 
            label="Defect Analysis" 
            grade={defGrade} 
            weight={defectWeight}
          />
        )}
      </div>
      
      {/* Weight visualization */}
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-700">
        <div 
          className="bg-blue-500 transition-all" 
          style={{ width: `${aiWeight}%` }}
          title={`AI: ${aiWeight}%`}
        />
        <div 
          className="bg-purple-500 transition-all" 
          style={{ width: `${cvWeight}%` }}
          title={`CV: ${cvWeight}%`}
        />
        {hasDefectGrade && (
          <div 
            className="bg-orange-500 transition-all" 
            style={{ width: `${defectWeight}%` }}
            title={`Defect: ${defectWeight}%`}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span className="text-blue-400">AI {aiWeight}%</span>
        <span className="text-purple-400">CV {cvWeight}%</span>
        {hasDefectGrade && <span className="text-orange-400">Defect {defectWeight}%</span>}
      </div>
      
      {/* Agreement indicator */}
      <div className={`px-3 py-2 rounded-lg ${agreementStyle.bg}`}>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-medium ${agreementStyle.text}`}>
            {agreementStyle.label}
          </span>
          <span className="text-xs text-gray-400">
            Δ {hybridGrade.gradeDifference.toFixed(1)} points
          </span>
        </div>
      </div>
      
      {/* Final Grade */}
      <div className="border-t border-gray-600 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">Final Grade</div>
            <div className="text-lg font-bold text-white">{tier.label}</div>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-black font-mono ${getGradeColor(finalGradeNum)}`}>
              {hybridGrade.finalGrade}
            </div>
            <div className={`text-xs font-medium px-2 py-0.5 rounded inline-block ${confidenceStyle.bg} ${confidenceStyle.text}`}>
              {hybridGrade.overallConfidence.replace('-', ' ').toUpperCase()}
            </div>
          </div>
        </div>
      </div>
      
      {/* Reasoning */}
      {hybridGrade.reasoning && (
        <div className="text-xs text-gray-400 bg-gray-900/50 p-3 rounded-lg">
          {hybridGrade.reasoning}
        </div>
      )}
    </div>
  );
}

function GradeSourceRow({ 
  label, 
  grade, 
  weight,
  confidence 
}: { 
  label: string; 
  grade: number; 
  weight: number;
  confidence?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-300">{label}</span>
        {confidence && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${getConfidenceStyle(confidence).bg} ${getConfidenceStyle(confidence).text}`}>
            {confidence}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className={`font-mono font-bold ${getGradeColor(grade)}`}>
          {grade.toFixed(1)}
        </span>
        <span className="text-gray-500 text-xs w-8 text-right">
          {weight}%
        </span>
      </div>
    </div>
  );
}

