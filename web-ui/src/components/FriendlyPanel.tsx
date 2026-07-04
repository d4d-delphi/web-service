'use client';

import { FriendlyAsset, BriefingResult, InferenceResult } from '@/types';
import InferencePanel from './InferencePanel';

interface FriendlyPanelProps {
  friendlies: FriendlyAsset[];
  briefing: BriefingResult | null;
  onRequestBriefing: () => void;
  isLoadingBriefing: boolean;
  inferenceResult?: InferenceResult | null;
}

function AssetStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ready: 'bg-green-500/20 text-green-400 border-green-500/30',
    engaged: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    returning: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    standby: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const labels: Record<string, string> = {
    ready: '준비완료',
    engaged: '교전중',
    returning: '복귀중',
    standby: '대기',
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[status] || colors.standby}`}>
      {labels[status] || status}
    </span>
  );
}

function AssetIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    MISSILE: '🚀',
    FIGHTER: '✈️',
    ISR: '👁️',
    SHIP: '🚢',
    COMMAND: '📡',
  };
  return <span className="text-sm">{icons[type] || '•'}</span>;
}

export default function FriendlyPanel({
  friendlies,
  briefing,
  onRequestBriefing,
  isLoadingBriefing,
  inferenceResult,
}: FriendlyPanelProps) {
  return (
    <div className="h-full flex flex-col bg-[#0d1117] border-l border-blue-900/30">
      {/* Header */}
      <div className="p-3 border-b border-blue-900/30 bg-blue-950/20">
        <h2 className="text-sm font-bold text-blue-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          아군 정보 (FRIENDLY)
        </h2>
      </div>

      {/* Asset List */}
      <div className="px-3 py-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">가용 자산</h3>
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
          {friendlies.map((asset) => (
            <div
              key={asset.id}
              className="p-2 rounded bg-blue-950/20 border border-blue-900/20 hover:border-blue-700/40 text-xs transition-all"
            >
              <div className="flex justify-between items-center">
                <span className="font-medium text-blue-300 flex items-center gap-1.5">
                  <AssetIcon type={asset.type} />
                  {asset.name}
                </span>
                <AssetStatusBadge status={asset.status} />
              </div>
              {asset.capability && (
                <p className="text-blue-400/60 text-[10px] mt-0.5 ml-6">{asset.capability}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bayesian Inference */}
      <div className="px-3 py-2 border-t border-blue-900/20">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">베이지안 추론</h3>
        <InferencePanel inferenceResult={inferenceResult || null} />
      </div>

      {/* AI Analysis Section */}
      <div className="flex-1 px-3 py-2 overflow-hidden">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider">AI 분석</h3>
          <button
            onClick={onRequestBriefing}
            disabled={isLoadingBriefing}
            className="text-[10px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50 transition-all"
          >
            {isLoadingBriefing ? '분석중...' : '브리핑 요청'}
          </button>
        </div>

        {isLoadingBriefing && (
          <div className="p-3 rounded bg-amber-950/20 border border-amber-900/30 text-center">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-amber-500 mx-auto mb-2"></div>
            <p className="text-amber-400/70 text-xs">AI 분석 진행 중...</p>
          </div>
        )}

        {briefing && !isLoadingBriefing && (
          <div className="space-y-2 overflow-y-auto max-h-[calc(100%-40px)]">
            {/* Summary */}
            <div className="p-2 rounded bg-amber-950/20 border border-amber-900/30 glow-amber">
              <p className="text-amber-300 text-[11px] leading-relaxed">{briefing.summary}</p>
            </div>

            {/* Confidence & Probability */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="p-2 rounded bg-gray-900/50 border border-gray-700/30 text-center">
                <p className="text-[9px] text-gray-500">신뢰도</p>
                <p className="text-sm font-bold text-amber-400">{briefing.confidence}%</p>
              </div>
              {briefing.launchProbability !== undefined && (
                <div className="p-2 rounded bg-gray-900/50 border border-gray-700/30 text-center">
                  <p className="text-[9px] text-gray-500">발사확률</p>
                  <p className={`text-sm font-bold ${briefing.launchProbability >= 70 ? 'text-red-400' : 'text-yellow-400'}`}>
                    {briefing.launchProbability}%
                  </p>
                </div>
              )}
            </div>

            {/* Threat Assessment */}
            <div className="p-2 rounded bg-gray-900/50 border border-gray-700/30">
              <p className="text-[9px] text-gray-500 mb-1">위협 평가</p>
              <p className="text-[11px] text-gray-300">{briefing.threatAssessment}</p>
            </div>

            {/* Recommendations */}
            <div className="p-2 rounded bg-gray-900/50 border border-gray-700/30">
              <p className="text-[9px] text-gray-500 mb-1">권고 조치</p>
              <ul className="space-y-0.5">
                {briefing.recommendations.map((rec, i) => (
                  <li key={i} className="text-[10px] text-green-400/80 flex items-start gap-1">
                    <span className="text-green-500 mt-0.5">▸</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>

            {/* Historical Cases */}
            {briefing.historicalCases.length > 0 && (
              <div className="p-2 rounded bg-gray-900/50 border border-gray-700/30">
                <p className="text-[9px] text-gray-500 mb-1">유사 과거 사례</p>
                {briefing.historicalCases.slice(0, 2).map((c) => (
                  <div key={c.id} className="mt-1 p-1.5 rounded bg-gray-800/50 text-[10px]">
                    <p className="text-gray-300">{c.title}</p>
                    <p className="text-gray-500">{c.date} | 유사도 {Math.round((c.similarity || 0) * 100)}%</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
