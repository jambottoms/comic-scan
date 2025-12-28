'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronDown, ChevronUp, Scale, AlertTriangle, BookOpen, Settings } from 'lucide-react';
import { 
  DEFECT_DEDUCTIONS, 
  REGION_WEIGHTS, 
  GRADE_TIERS,
  DEFECT_DISPLAY_NAMES,
  REGION_DISPLAY_NAMES,
  type DefectLabel,
  type RegionName
} from '@/lib/grading-config';

// Accordion section component
function AccordionSection({ 
  title, 
  icon: Icon, 
  children, 
  defaultOpen = false 
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-gray-900 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-amber-400" />
          <span className="font-semibold text-white">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 bg-gray-900/50 border-t border-gray-800">
          {children}
        </div>
      )}
    </div>
  );
}

// Grade tier card
function GradeTierCard({ 
  tier, 
  label, 
  shortLabel, 
  min, 
  max 
}: { 
  tier: string;
  label: string; 
  shortLabel: string; 
  min: number; 
  max: number;
}) {
  const getColor = () => {
    if (min >= 9.0) return 'from-green-500 to-emerald-600';
    if (min >= 7.0) return 'from-blue-500 to-cyan-600';
    if (min >= 5.0) return 'from-yellow-500 to-amber-600';
    if (min >= 3.0) return 'from-orange-500 to-red-600';
    return 'from-red-600 to-rose-700';
  };
  
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
      <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${getColor()} flex items-center justify-center font-bold text-white text-sm`}>
        {shortLabel}
      </div>
      <div className="flex-1">
        <div className="font-medium text-white">{label}</div>
        <div className="text-sm text-gray-400">{min.toFixed(1)} - {max.toFixed(1)}</div>
      </div>
    </div>
  );
}

// Defect deduction row
function DefectRow({ defect, deduction }: { defect: DefectLabel; deduction: number }) {
  const getSeverityColor = () => {
    if (deduction >= 3.0) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (deduction >= 1.5) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    if (deduction >= 0.5) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  };
  
  return (
    <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
      <span className="text-gray-200">{DEFECT_DISPLAY_NAMES[defect]}</span>
      <span className={`px-2 py-1 rounded border text-sm font-mono ${getSeverityColor()}`}>
        -{deduction.toFixed(1)}
      </span>
    </div>
  );
}

// Region weight row
function RegionRow({ region, weight }: { region: RegionName; weight: number }) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
      <span className="text-gray-200">{REGION_DISPLAY_NAMES[region]}</span>
      <span className="px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 text-sm font-mono">
        {weight.toFixed(1)}x
      </span>
    </div>
  );
}

export default function RulesPage() {
  const router = useRouter();
  
  // Organize defects by category
  const structuralSevere: DefectLabel[] = ['spine_split', 'detached_cover', 'missing_piece', 'tear_major'];
  const structuralModerate: DefectLabel[] = ['spine_roll', 'staple_rust', 'tear_minor'];
  const surfaceDefects: DefectLabel[] = ['stain', 'foxing', 'color_touch', 'fingerprint', 'date_stamp', 'writing'];
  const wearDefects: DefectLabel[] = ['corner_blunt', 'color_break', 'crease_minor', 'spine_stress'];
  
  return (
    <main className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-black/90 backdrop-blur-lg border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              Grading Rules
            </h1>
            <p className="text-sm text-gray-400">CGC & Overstreet Standards</p>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-4">
        
        {/* Introduction */}
        <div className="p-4 bg-gradient-to-br from-amber-900/20 to-orange-900/20 border border-amber-500/30 rounded-xl">
          <div className="flex gap-3">
            <BookOpen className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-amber-100 mb-1">How GradeVault Grades</h2>
              <p className="text-sm text-amber-200/80">
                GradeVault uses a hybrid system combining AI vision analysis, computer vision defect detection, 
                and industry-standard CGC/Overstreet guidelines to calculate accurate grades.
              </p>
            </div>
          </div>
        </div>
        
        {/* CGC Grade Scale */}
        <AccordionSection title="CGC Grade Scale" icon={Scale} defaultOpen={true}>
          <p className="text-sm text-gray-400 mb-4">
            The 10-point scale used by CGC (Certified Guaranty Company) and adopted by GradeVault.
          </p>
          <div className="grid gap-2">
            {Object.entries(GRADE_TIERS).map(([key, tier]) => (
              <GradeTierCard 
                key={key}
                tier={key}
                label={tier.label}
                shortLabel={tier.shortLabel}
                min={tier.min}
                max={tier.max}
              />
            ))}
          </div>
        </AccordionSection>
        
        {/* Defect Deductions */}
        <AccordionSection title="Defect Deductions" icon={AlertTriangle}>
          <p className="text-sm text-gray-400 mb-4">
            Points deducted from a perfect 10.0 for each defect found. Actual deduction = base × region weight.
          </p>
          
          {/* Structural Severe */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Structural (Severe)
            </h4>
            <div className="space-y-2">
              {structuralSevere.map(defect => (
                <DefectRow key={defect} defect={defect} deduction={DEFECT_DEDUCTIONS[defect]} />
              ))}
            </div>
          </div>
          
          {/* Structural Moderate */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-orange-400 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              Structural (Moderate)
            </h4>
            <div className="space-y-2">
              {structuralModerate.map(defect => (
                <DefectRow key={defect} defect={defect} deduction={DEFECT_DEDUCTIONS[defect]} />
              ))}
            </div>
          </div>
          
          {/* Surface */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-yellow-400 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
              Surface Defects
            </h4>
            <div className="space-y-2">
              {surfaceDefects.map(defect => (
                <DefectRow key={defect} defect={defect} deduction={DEFECT_DEDUCTIONS[defect]} />
              ))}
            </div>
          </div>
          
          {/* Wear */}
          <div>
            <h4 className="text-sm font-medium text-green-400 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Wear Defects
            </h4>
            <div className="space-y-2">
              {wearDefects.map(defect => (
                <DefectRow key={defect} defect={defect} deduction={DEFECT_DEDUCTIONS[defect]} />
              ))}
            </div>
          </div>
        </AccordionSection>
        
        {/* Region Weights */}
        <AccordionSection title="Region Importance" icon={Settings}>
          <p className="text-sm text-gray-400 mb-4">
            Different areas of the comic affect the grade differently. Defects in high-visibility areas 
            like the spine have a multiplied impact.
          </p>
          <div className="space-y-2">
            {(Object.entries(REGION_WEIGHTS) as [RegionName, number][]).map(([region, weight]) => (
              <RegionRow key={region} region={region} weight={weight} />
            ))}
          </div>
          
          <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            <p className="text-sm text-purple-200">
              <strong>Example:</strong> A spine roll (base -1.5) on the spine (1.5x weight) = -2.25 points total.
            </p>
          </div>
        </AccordionSection>
        
        {/* Grading Formula */}
        <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Scale className="w-5 h-5 text-amber-400" />
            Grade Calculation Formula
          </h3>
          <div className="bg-black p-4 rounded-lg font-mono text-sm">
            <div className="text-gray-400 mb-2">// Start with perfect grade</div>
            <div className="text-green-400">Grade = 10.0</div>
            <div className="text-gray-400 mt-3 mb-2">// Subtract for each defect</div>
            <div className="text-amber-400">Grade -= Σ(Defect × Region Weight)</div>
            <div className="text-gray-400 mt-3 mb-2">// Minimum grade is 0.5</div>
            <div className="text-blue-400">Final = max(0.5, Grade)</div>
          </div>
        </div>
        
        {/* Footer Note */}
        <div className="text-center text-sm text-gray-500 pt-4">
          <p>Based on CGC Grading Standards & Overstreet Comic Book Price Guide</p>
          <p className="mt-1">Weights can be adjusted in <code className="text-gray-400">lib/grading-config.ts</code></p>
        </div>
      </div>
    </main>
  );
}

