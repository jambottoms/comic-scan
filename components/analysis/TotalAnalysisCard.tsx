'use client';

import { Loader2, ScanLine, Sparkles, ShieldCheck } from 'lucide-react';

interface TotalAnalysisCardProps {
  status: string;
  aiGrade: string | null;
  hybridGrade: any | null;
  gradingScale?: string;
}

export default function TotalAnalysisCard({
  status,
  aiGrade,
  hybridGrade,
  gradingScale = 'CGC'
}: TotalAnalysisCardProps) {
  const isAnalyzing = status === 'analyzing' || status === 'uploading';
  const isCVComplete = !!hybridGrade;
  
  // Determine what to show
  let displayGrade = '...';
  let confidence = 'Pending';
  let confidenceColor = 'text-gray-400';
  let badgeColor = 'text-gray-400';
  let label = 'Estimated Grade';
  let icon = <Loader2 className="w-5 h-5 animate-spin text-purple-400" />;
  
  if (isCVComplete) {
    displayGrade = hybridGrade.finalGrade || hybridGrade.displayGrade;
    confidence = 'Verified';
    confidenceColor = 'text-green-400';
    label = 'Verified Grade';
    icon = <ShieldCheck className="w-5 h-5 text-green-400" />;
  } else if (aiGrade) {
    displayGrade = aiGrade;
    confidence = 'AI Estimate';
    confidenceColor = 'text-purple-400';
    label = 'Estimated Grade';
    icon = <Sparkles className="w-5 h-5 text-purple-400" />;
  }

  // Determine grade color
  const gradeNum = parseFloat(displayGrade);
  if (!isNaN(gradeNum)) {
    if (gradeNum >= 9.0) badgeColor = 'text-green-400';
    else if (gradeNum >= 7.0) badgeColor = 'text-yellow-400';
    else if (gradeNum >= 5.0) badgeColor = 'text-orange-400';
    else badgeColor = 'text-red-400';
  }

  if (status === 'uploading' || (status === 'analyzing' && !aiGrade)) {
    return (
      <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-xl border-2 border-gray-700 shadow-xl mb-6 relative overflow-hidden">
         {/* Scanning animation overlay */}
         <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-scan-line" />
         </div>
         
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
               <div className="w-16 h-16 rounded-full bg-gray-900 border-2 border-gray-700 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
               </div>
               <div>
                  <div className="h-4 w-32 bg-gray-700 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-24 bg-gray-700/50 rounded animate-pulse"></div>
               </div>
            </div>
            <div className="h-10 w-24 bg-gray-700 rounded animate-pulse"></div>
         </div>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-2xl bg-gray-800 p-6 rounded-xl border-2 ${isCVComplete ? 'border-green-500' : 'border-purple-500'} shadow-xl mb-6 relative overflow-hidden transition-all duration-500`}>
      {/* Top Strip */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${isCVComplete ? 'from-green-500 to-emerald-400' : 'from-purple-500 to-blue-500'}`}></div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Grade Badge */}
          <div className="flex flex-col items-center">
             <div className="w-20 h-20 rounded-lg bg-white flex items-center justify-center shadow-inner relative overflow-hidden">
                <span className={`text-4xl font-black font-mono tracking-tighter ${badgeColor} z-10`}>
                  {displayGrade}
                </span>
                {/* CGC Pattern */}
                <div className="absolute top-0 left-0 w-full h-2 bg-gray-200"></div>
             </div>
             <span className="text-[10px] font-bold text-gray-500 mt-1 uppercase tracking-widest">{gradingScale} Scale</span>
          </div>

          <div className="flex flex-col">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
               {icon}
               {label}
            </h2>
            <div className={`text-xs font-medium mt-1 ${confidenceColor} px-2 py-0.5 bg-gray-900/50 rounded-full w-fit flex items-center gap-1`}>
              {status === 'analyzing' && !isCVComplete && <Loader2 className="w-3 h-3 animate-spin" />}
              {confidence}
            </div>
            
            {!isCVComplete && (
               <p className="text-xs text-gray-500 mt-2 italic">
                 Final verification pending...
               </p>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <div className="text-right">
           <div className={`px-3 py-1 rounded border ${
             isCVComplete 
               ? 'bg-green-900/20 border-green-800 text-green-400' 
               : 'bg-purple-900/20 border-purple-800 text-purple-400'
           }`}>
             <span className="text-xs font-bold uppercase tracking-wide">
               {isCVComplete ? 'Complete' : 'Processing'}
             </span>
           </div>
        </div>
      </div>
    </div>
  );
}
