'use client';

import { InferenceResult, HypothesisNode } from '@/types';

interface InferencePanelProps {
  inferenceResult: InferenceResult | null;
}

function ProbabilityBar({ node }: { node: HypothesisNode }) {
  const pct = Math.round(node.posterior * 100);
  const categoryColors: Record<string, string> = {
    missile_launch: 'bg-red-500',
    exercise: 'bg-yellow-500',
    provocation: 'bg-orange-500',
    normal: 'bg-green-500',
  };
  const barColor = categoryColors[node.category] || 'bg-gray-500';

  return (
    <div className="mb-1.5">
      <div className="flex justify-between items-center text-[10px] mb-0.5">
        <span className="text-gray-300 truncate max-w-[140px]">{node.name}</span>
        <span className="text-gray-400 font-mono ml-1">{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
        <span>불확실성: {Math.round(node.uncertainty * 100)}%</span>
        <span>근거: {node.evidenceChain.length}건</span>
      </div>
    </div>
  );
}

export default function InferencePanel({ inferenceResult }: InferencePanelProps) {
  if (!inferenceResult || inferenceResult.hypotheses.length === 0) {
    return (
      <div className="p-3 text-center">
        <p className="text-gray-500 text-xs">징후 입력 대기 중...</p>
        <p className="text-gray-600 text-[10px] mt-1">시나리오를 재생하면 베이지안 추론이 시작됩니다</p>
      </div>
    );
  }

  const top = inferenceResult.topHypothesis;

  return (
    <div className="space-y-2">
      {/* Top Hypothesis Highlight */}
      {top && (
        <div className="p-2 rounded bg-amber-950/30 border border-amber-900/40">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] text-amber-500 uppercase tracking-wider">최유력 가설</span>
            <span className="text-[9px] text-gray-500">
              신뢰도 {Math.round(inferenceResult.overallConfidence * 100)}%
            </span>
          </div>
          <p className="text-amber-300 text-xs font-medium">{top.name}</p>
          <p className="text-amber-400/80 text-sm font-bold mt-0.5">
            {Math.round(top.posterior * 100)}%
          </p>
        </div>
      )}

      {/* All Hypotheses */}
      <div className="p-2 rounded bg-gray-900/50 border border-gray-700/30">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[9px] text-gray-500 uppercase tracking-wider">가설 분포</span>
          <span className="text-[9px] text-gray-600">증거 {inferenceResult.evidenceCount}건</span>
        </div>
        {inferenceResult.hypotheses.slice(0, 5).map((h) => (
          <ProbabilityBar key={h.id} node={h} />
        ))}
      </div>
    </div>
  );
}
