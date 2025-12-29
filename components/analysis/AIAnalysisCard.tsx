'use client';

import { Sparkles } from 'lucide-react';

interface AIAnalysisCardProps {
  isAnalyzing: boolean;
  result: any;
}

export default function AIAnalysisCard({ isAnalyzing, result }: AIAnalysisCardProps) {
  const skeleton = "animate-pulse bg-gray-700 rounded";

  return (
    <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-xl border border-gray-700 mb-6 shadow-lg">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-700">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          AI Analysis (Phase 1)
        </h3>
      </div>

      {/* Item Details (Year/Variant/Type) */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {isAnalyzing ? (
          <>
            <div className={`${skeleton} h-8 w-full`}></div>
            <div className={`${skeleton} h-8 w-full`}></div>
          </>
        ) : (
          <>
            {result.year && (
              <div className="p-2 bg-gray-900/50 rounded border border-gray-700">
                <span className="text-[10px] text-gray-500 uppercase block">Year</span>
                <span className="text-sm font-medium text-gray-300">{result.year}</span>
              </div>
            )}
            {result.itemType && (
              <div className="p-2 bg-gray-900/50 rounded border border-gray-700">
                <span className="text-[10px] text-gray-500 uppercase block">Type</span>
                <span className="text-sm font-medium text-gray-300 capitalize">{result.itemType}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Summary */}
      <div className="mb-6">
        <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-2">Summary</h4>
        {isAnalyzing ? (
          <div className="space-y-2">
            <div className={`${skeleton} h-3 w-full`}></div>
            <div className={`${skeleton} h-3 w-11/12`}></div>
            <div className={`${skeleton} h-3 w-4/5`}></div>
          </div>
        ) : (
          <p className="text-sm text-gray-300 leading-relaxed">
            {result.summary || "No summary available."}
          </p>
        )}
      </div>

      {/* Identified Defects List */}
      <div>
        <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-2">Identified Issues</h4>
        {isAnalyzing ? (
          <ul className="space-y-2">
            {[1, 2, 3].map(i => (
              <li key={i} className="flex items-center gap-2">
                <div className={`${skeleton} h-2 w-2 rounded-full`}></div>
                <div className={`${skeleton} h-3 w-3/4`}></div>
              </li>
            ))}
          </ul>
        ) : result.reasoning && Array.isArray(result.reasoning) ? (
          <ul className="space-y-3">
            {result.reasoning.map((item: any, idx: number) => (
              <li key={idx} className="flex items-start gap-3 bg-gray-900/30 p-2 rounded">
                {item.timestamp && (
                  <span className="text-[10px] font-mono text-purple-400 bg-purple-900/20 px-1.5 rounded flex-shrink-0 mt-0.5">
                    {item.timestamp}
                  </span>
                )}
                <div className="text-xs">
                  <span className="font-bold text-gray-200 block mb-0.5">{item.defect || "Defect"}</span>
                  <span className="text-gray-400">{item.note || item.text}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500 italic">No specific issues listed.</p>
        )}
      </div>
    </div>
  );
}
