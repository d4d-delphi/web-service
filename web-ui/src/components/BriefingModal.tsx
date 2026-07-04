'use client';

import { BriefingResult } from '@/types';

interface BriefingModalProps {
  briefing: BriefingResult;
  onClose: () => void;
}

export default function BriefingModal({ briefing, onClose }: BriefingModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0d1117] border border-amber-900/50 rounded-lg shadow-2xl w-[600px] max-h-[80vh] overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="p-4 border-b border-amber-900/30 bg-amber-950/20 flex justify-between items-center">
          <div>
            <h2 className="text-amber-400 font-bold text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              AI 상황 브리핑
            </h2>
            <p className="text-gray-500 text-xs mt-0.5">RAG 기반 다중출처 융합 분석</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)] space-y-4">
          {/* Summary */}
          <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-900/30">
            <h3 className="text-xs text-amber-500 font-semibold mb-1.5">상황 요약</h3>
            <p className="text-sm text-gray-200 leading-relaxed">{briefing.summary}</p>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-700/30 text-center">
              <p className="text-[10px] text-gray-500 mb-1">분석 신뢰도</p>
              <p className="text-xl font-bold text-amber-400">{briefing.confidence}%</p>
            </div>
            {briefing.launchProbability !== undefined && (
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-700/30 text-center">
                <p className="text-[10px] text-gray-500 mb-1">발사 확률</p>
                <p className={`text-xl font-bold ${briefing.launchProbability >= 70 ? 'text-red-400' : 'text-yellow-400'}`}>
                  {briefing.launchProbability}%
                </p>
              </div>
            )}
            <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-700/30 text-center">
              <p className="text-[10px] text-gray-500 mb-1">참조 사례</p>
              <p className="text-xl font-bold text-blue-400">{briefing.historicalCases.length}건</p>
            </div>
          </div>

          {/* Threat Assessment */}
          <div className="p-3 rounded-lg bg-red-950/20 border border-red-900/30">
            <h3 className="text-xs text-red-400 font-semibold mb-1.5">위협 평가</h3>
            <p className="text-sm text-gray-300 leading-relaxed">{briefing.threatAssessment}</p>
          </div>

          {/* Recommendations */}
          <div className="p-3 rounded-lg bg-green-950/20 border border-green-900/30">
            <h3 className="text-xs text-green-400 font-semibold mb-1.5">권고 조치</h3>
            <ul className="space-y-1.5">
              {briefing.recommendations.map((rec, i) => (
                <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                  <span className="text-green-500 font-bold">{i + 1}.</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>

          {/* Historical Cases */}
          {briefing.historicalCases.length > 0 && (
            <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-900/30">
              <h3 className="text-xs text-blue-400 font-semibold mb-2">유사 과거 사례</h3>
              <div className="space-y-2">
                {briefing.historicalCases.map((c) => (
                  <div key={c.id} className="p-2 rounded bg-gray-900/50 border border-gray-700/30">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-200 font-medium">{c.title}</span>
                      <span className="text-[10px] text-amber-400">
                        유사도 {Math.round((c.similarity || 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {c.date} | {c.missileType}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">{c.outcome}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
