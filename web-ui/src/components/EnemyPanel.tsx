'use client';

import { TimelineEvent, InferenceResult, EvidenceContribution } from '@/types';

interface EnemyPanelProps {
  events: TimelineEvent[];
  currentTime: number;
  inferenceResult: InferenceResult | null;
}

// 카테고리별 색상 (가설 성격)
const categoryAccent: Record<string, { text: string; bar: string; ring: string }> = {
  missile_launch: { text: 'text-red-300', bar: 'bg-red-500', ring: 'border-red-900/40' },
  provocation: { text: 'text-orange-300', bar: 'bg-orange-500', ring: 'border-orange-900/40' },
  exercise: { text: 'text-yellow-300', bar: 'bg-yellow-500', ring: 'border-yellow-900/40' },
  normal: { text: 'text-green-300', bar: 'bg-green-500', ring: 'border-green-900/40' },
};

function likelihoodColor(pct: number) {
  if (pct >= 75) return 'text-red-400';
  if (pct >= 50) return 'text-orange-400';
  if (pct >= 25) return 'text-yellow-400';
  return 'text-gray-300';
}

function likelihoodBar(pct: number) {
  if (pct >= 75) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
  if (pct >= 50) return 'bg-orange-500';
  if (pct >= 25) return 'bg-yellow-500';
  return 'bg-gray-500';
}

export default function EnemyPanel({ events, currentTime, inferenceResult }: EnemyPanelProps) {
  const visibleEvents = events.filter((e) => e.timestamp <= currentTime);
  const top = inferenceResult?.topHypothesis ?? null;

  // 발생 가능성(%) — 데이터가 축적될수록 상승
  const likelihoodPct = top ? Math.round(top.posterior * 100) : 0;
  const confidencePct = inferenceResult ? Math.round(inferenceResult.overallConfidence * 100) : 0;
  const evidenceCount = inferenceResult?.evidenceCount ?? 0;
  const accent = top ? categoryAccent[top.category] ?? categoryAccent.normal : categoryAccent.normal;

  // 예상 발생 시점 — 타임라인의 발사(핵심) 이벤트 시각
  const climaxEvent =
    events.find((e) => e.type === 'launch') ?? events.find((e) => e.type === 'strike') ?? null;
  const climaxOccurred = climaxEvent ? currentTime >= climaxEvent.timestamp : false;

  // 증거별 기여도 조회 맵
  const contribMap = new Map<string, EvidenceContribution>(
    (inferenceResult?.evidenceContributions ?? []).map((c) => [c.actionId, c])
  );

  return (
    <div className="h-full flex flex-col bg-[#0d1117] border-r border-amber-900/30">
      {/* Header */}
      <div className="p-3 border-b border-amber-900/30 bg-amber-950/20">
        <h2 className="text-sm font-bold text-amber-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          상황 예측 (FORECAST)
        </h2>
      </div>

      {/* Incident Forecast Card */}
      <div className="px-3 pt-3">
        {top ? (
          <div className={`p-3 rounded-lg bg-gray-900/60 border ${accent.ring}`}>
            <div className="flex justify-between items-center text-[9px] uppercase tracking-wider mb-1">
              <span className="text-amber-500/80">예측 상황</span>
              <span className="text-gray-500">증거 {evidenceCount}건</span>
            </div>
            <p className={`text-sm font-bold leading-snug ${accent.text}`}>{top.name}</p>

            {/* Likelihood % */}
            <div className="flex items-end gap-2 mt-2">
              <span className={`text-4xl font-bold leading-none ${likelihoodColor(likelihoodPct)}`}>
                {likelihoodPct}
                <span className="text-lg">%</span>
              </span>
              <span className="text-[10px] text-gray-500 mb-1">발생 가능성</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${likelihoodBar(likelihoodPct)}`}
                style={{ width: `${likelihoodPct}%` }}
              />
            </div>

            {/* Predicted timing */}
            <div className="mt-3 flex justify-between items-center">
              <span className="text-[10px] text-gray-500">예상 발생 시점</span>
              <span
                className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                  climaxOccurred
                    ? 'text-red-300 bg-red-950/40'
                    : 'text-amber-300 bg-amber-950/30'
                }`}
              >
                {climaxEvent ? climaxEvent.time : '분석 중'}
                {climaxOccurred ? ' · 발생' : ''}
              </span>
            </div>
            <div className="mt-1 flex justify-between items-center text-[9px] text-gray-600">
              <span>신뢰도 {confidencePct}%</span>
              <span>데이터 축적 시 확률 상승 ↑</span>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-700/30 text-center">
            <p className="text-gray-500 text-xs">징후 입력 대기 중...</p>
            <p className="text-gray-600 text-[10px] mt-1">
              시나리오를 재생하면 발생 가능성이 산출됩니다
            </p>
          </div>
        )}
      </div>

      {/* Collected Data + Contribution */}
      <div className="flex-1 px-3 py-3 overflow-hidden flex flex-col">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex justify-between">
          <span>수집 데이터 · 기여도</span>
          <span className="text-gray-600 normal-case">{visibleEvents.length}건</span>
        </h3>
        <div className="space-y-1.5 overflow-y-auto flex-1">
          {visibleEvents
            .slice()
            .reverse()
            .map((event) => {
              const contrib = contribMap.get(event.id);
              // 절대 기여도: 현재 발생 가능성(%) 중 이 증거가 차지하는 퍼센트포인트
              // (모든 증거의 기여도 합 = 발생 가능성 %)
              const cPct = contrib ? Math.round(contrib.contribution * likelihoodPct) : 0;
              return (
                <div
                  key={event.id}
                  className="p-2 rounded bg-gray-900/50 border border-gray-700/30 text-xs animate-fade-in"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-gray-500 font-mono text-[10px]">{event.time}</span>
                    <EventTypeBadge type={event.type} />
                    <SourceBadge actionClass={event.actionClass} />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-gray-300 font-medium text-[11px]">{event.title}</p>
                      <p className="text-gray-500 text-[10px]">{event.description}</p>
                    </div>
                    {/* Contribution to likelihood — size scales with % */}
                    <span
                      className={`font-mono font-bold leading-none shrink-0 ${
                        cPct > 0 ? 'text-amber-400' : 'text-gray-600'
                      }`}
                      style={{ fontSize: cPct > 0 ? `${11 + Math.min(cPct, 60) * 0.4}px` : '10px' }}
                      title="발생 가능성 기여도"
                    >
                      {cPct > 0 ? `+${cPct}%` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    intel: 'bg-blue-500/20 text-blue-400',
    movement: 'bg-yellow-500/20 text-yellow-400',
    launch: 'bg-red-500/20 text-red-400',
    strike: 'bg-orange-500/20 text-orange-400',
    bda: 'bg-green-500/20 text-green-400',
    alert: 'bg-red-500/20 text-red-400',
  };
  const labels: Record<string, string> = {
    intel: '정보',
    movement: '이동',
    launch: '발사',
    strike: '타격',
    bda: 'BDA',
    alert: '경보',
  };

  return (
    <span className={`text-[9px] px-1 py-0.5 rounded ${styles[type] || 'bg-gray-500/20 text-gray-400'}`}>
      {labels[type] || type}
    </span>
  );
}

function SourceBadge({ actionClass }: { actionClass?: string }) {
  if (!actionClass) return null;
  const styles: Record<string, string> = {
    IMINT: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    SIGINT: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    MASINT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    UAV: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    OSINT: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    HUMINT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };
  return (
    <span className={`text-[8px] px-1 py-0.5 rounded border ${styles[actionClass] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {actionClass}
    </span>
  );
}
