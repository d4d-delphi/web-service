'use client';

import { useRef, useEffect } from 'react';
import { TimelineEvent, ScenarioPhase, InferenceResult } from '@/types';

interface EnemyPanelProps {
  events: TimelineEvent[];
  currentTime: number;
  inferenceResult: InferenceResult | null;
  scenarios?: { id: string; name: string; phases: ScenarioPhase[] }[];
  /**
   * 좌측 패널 표시 모드.
   *  - 'enemy'    : 평시/시나리오 분석 뷰(기존). inferenceResult 로 자동 전환.
   *  - 'timeline' : 이벤트 타임라인 뷰. 시나리오 전환 시 상위(page.tsx)에서 전환함.
   */
  viewMode?: 'enemy' | 'timeline';
}

type Risk = { dot: string; ring: string; line: string; name: string; badge: string; prob: string; };

const REACHED: Record<'yellow' | 'amber' | 'orange' | 'red', Risk> = {
  yellow: { dot: 'bg-yellow-400 border-yellow-300', ring: 'shadow-[0_0_10px_rgba(250,204,21,0.55)]', line: 'bg-yellow-500/40', name: 'text-yellow-200', badge: 'text-yellow-300/90 border-yellow-700/50 bg-yellow-950/30', prob: 'text-yellow-300' },
  amber: { dot: 'bg-amber-400 border-amber-300', ring: 'shadow-[0_0_10px_rgba(251,191,36,0.55)]', line: 'bg-amber-500/40', name: 'text-amber-200', badge: 'text-amber-300/90 border-amber-700/50 bg-amber-950/30', prob: 'text-amber-300' },
  orange: { dot: 'bg-orange-500 border-orange-400', ring: 'shadow-[0_0_10px_rgba(249,115,22,0.6)]', line: 'bg-orange-500/40', name: 'text-orange-200', badge: 'text-orange-300/90 border-orange-700/50 bg-orange-950/30', prob: 'text-orange-300' },
  red: { dot: 'bg-red-500 border-red-400', ring: 'shadow-[0_0_12px_rgba(239,68,68,0.7)]', line: 'bg-red-500/50', name: 'text-red-200', badge: 'text-red-300 border-red-700/50 bg-red-950/40', prob: 'text-red-300' },
};
const FUTURE: Risk = { dot: 'bg-transparent border-gray-600', ring: '', line: 'bg-gray-800', name: 'text-gray-500', badge: 'text-gray-600 border-gray-700/50 bg-transparent', prob: 'text-gray-600' };

function riskFor(prob: number | null, isLaunch: boolean): Risk {
  if (isLaunch || (prob ?? 0) >= 90) return REACHED.red;
  if ((prob ?? 0) >= 60) return REACHED.orange;
  if ((prob ?? 0) >= 40) return REACHED.amber;
  return REACHED.yellow;
}
function phaseDday(description: string): string | null {
  const m = description.match(/([DH][+\-]\d+(?:\s*~\s*[DH]?[+\-]?\d+)?)/);
  return m ? m[1].replace(/\s+/g, '') : null;
}
function phaseProb(description: string): number | null {
  const m = description.match(/(\d+)\s*%/);
  return m ? parseInt(m[1], 10) : null;
}

const PEACETIME_REPORTS: { category: string; color: string; dot: string; time: string; report: string }[] = [
  {
    category: '핵·WMD',
    color: 'text-red-400',
    dot: 'bg-red-500',
    time: '06:30',
    report: '영변 5MW 원자로 냉각수 배출 주기 정상 범위 유지, 이상 징후 없음',
  },
  {
    category: '미사일',
    color: 'text-orange-400',
    dot: 'bg-orange-500',
    time: '09:15',
    report: '동창리 서해위성발사장 연료 저장시설 주변 차량 3대 식별, 평시 수준',
  },
  {
    category: '지상군',
    color: 'text-yellow-400',
    dot: 'bg-yellow-500',
    time: '11:40',
    report: '비무장지대 인근 포병 부대 정기 기동훈련 식별, 규모 및 패턴 이상 없음',
  },
  {
    category: '해군',
    color: 'text-blue-400',
    dot: 'bg-blue-500',
    time: '14:22',
    report: '남포항 잠수함 기지 잠수함 2척 정박 확인, 출항 징후 없음',
  },
  {
    category: '공군',
    color: 'text-cyan-400',
    dot: 'bg-cyan-500',
    time: '16:05',
    report: '순천 비행장 MiG-29 편대 이착륙 훈련 식별, 주 1회 정기훈련 범위 내',
  },
  {
    category: '사회·경제',
    color: 'text-gray-400',
    dot: 'bg-gray-500',
    time: '19:48',
    report: '평양 시내 식량 배급 일정 정상 운영, 주민 동요 징후 없음',
  },
];

export default function EnemyPanel({ events, currentTime, inferenceResult, scenarios = [], viewMode = 'enemy' }: EnemyPanelProps) {
  // 30% 이상인 시나리오들 필터링 및 확률 높은 순 정렬
  const confirmedHypotheses = (inferenceResult?.hypotheses || [])
    .filter(h => h.posterior >= 0.3)
    .sort((a, b) => b.posterior - a.posterior);

  const isScenarioActive = confirmedHypotheses.length > 0;

  // 타임라인 모드: 이벤트를 시각순 세로 타임라인으로 표시. 시나리오 전환 시
  // 좌측 패널이 EnemyPanel(발사 시퀀스)에서 이 뷰로 전환된다.
  if (viewMode === 'timeline') {
    return (
      <div className="h-full flex flex-col layer-1 border-r border-gray-800/50">
        <div className="p-3 border-b border-gray-800 bg-gray-900/40 shrink-0">
          <h2 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
            이벤트 타임라인
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">관측 징후 시각순 · 현재 시각 이전은 강조</p>
        </div>
        <EventTimeline events={events} currentTime={currentTime} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col layer-1 border-r border-gray-800/50">

      {isScenarioActive ? (
        /* 시나리오 진행 뷰: 식별된 위협 시나리오 블록만 표시 */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b border-gray-800 bg-gray-900/40 shrink-0">
            <h2 className="text-sm font-bold text-amber-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              미사일 시나리오
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {confirmedHypotheses.map(h => {
              const scenario = scenarios.find(s => s.id === h.id);
              return (
                <ScenarioBlock
                  key={h.id}
                  hypothesisId={h.id}
                  posterior={h.posterior}
                  scenario={scenario}
                  events={events}
                  currentTime={currentTime}
                />
              );
            })}
          </div>
        </div>
      ) : (
        /* 평시 뷰: 6개 분야별 최근 보고 */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b border-gray-800 bg-gray-900/40 shrink-0">
            <h2 className="text-sm font-bold text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              분야별 동향 (24H)
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5">
            {PEACETIME_REPORTS.map((item) => (
              <div key={item.category} className="p-2.5 rounded border border-gray-800 bg-gray-900/40">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dot}`} />
                    <span className={`text-[11px] font-bold ${item.color}`}>{item.category}</span>
                  </div>
                  <span className="text-[10px] text-gray-600 font-mono">{item.time}</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-snug break-keep">{item.report}</p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function ScenarioBlock({ hypothesisId, posterior, scenario, events, currentTime }: any) {
  const probPct = Math.round(posterior * 100);

  // Hooks must run unconditionally, before any early return, to satisfy
  // React's rules-of-hooks. Guard the derived data against a null scenario.
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const activeStageIdRef = useRef<number | null>(null);

  const stages = (scenario?.phases ?? []).map((phase: any) => {
    const inWindow = events.filter((e: any) => e.timestamp >= phase.startTime && e.timestamp < phase.endTime);
    const collected = inWindow.filter((e: any) => e.timestamp <= currentTime);
    const isLaunch = inWindow.some((e: any) => e.type === 'launch' || e.type === 'strike');
    const reached = currentTime >= phase.startTime;
    const active = reached && currentTime < phase.endTime;
    const completed = currentTime >= phase.endTime;
    return {
      phase,
      inWindow,
      collected,
      isLaunch,
      reached,
      active,
      completed,
      dday: phaseDday(phase.description),
      prob: phaseProb(phase.description)
    };
  });

  // 시나리오 전환/Phase 진행 시 현재 Phase를 중심으로 타임라인을 펼친다.
  // 활성 Phase가 바뀔 때만 가장 가까운 방향으로 스크롤(사용자 수동 스크롤 최소 간섭).
  useEffect(() => {
    const active = stages.find((s: any) => s.active);
    if (active && active.phase.id !== activeStageIdRef.current) {
      activeStageIdRef.current = active.phase.id;
      activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [stages]);

  if (!scenario) {
    return (
      <div className="rounded border border-gray-700 bg-gray-800/30 overflow-hidden mb-2">
        <div className="p-3 flex items-center justify-between">
           <span className="text-[12px] font-bold text-gray-400">{hypothesisId}</span>
           <span className="text-[10px] text-gray-500 font-mono">{probPct}%</span>
        </div>
      </div>
    );
  }

  const launchReached = stages.some((s: any) => s.isLaunch && s.reached);

  const gaugeText = (pct: number) => {
    if (pct >= 90) return 'text-red-500';
    if (pct >= 60) return 'text-orange-500';
    if (pct >= 40) return 'text-amber-500';
    return 'text-yellow-500';
  };

  const gaugeBar = (pct: number) => {
    if (pct >= 90) return 'bg-gradient-to-r from-orange-500 to-red-500';
    if (pct >= 60) return 'bg-gradient-to-r from-amber-500 to-orange-500';
    if (pct >= 40) return 'bg-gradient-to-r from-yellow-500 to-amber-500';
    return 'bg-yellow-500';
  };

  return (
    <div className="flex flex-col layer-2 border border-amber-900/30 rounded mb-2 animate-fade-in overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-amber-900/30 bg-amber-950/20 shrink-0">
        <h2 className="text-sm font-bold text-amber-400 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${probPct >= 60 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}></span>
          {scenario.name}
        </h2>
      </div>

      {/* Compact live gauge */}
      <div className="px-3 pt-3 shrink-0">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] text-gray-500 uppercase tracking-wider">위험도 (신뢰도)</span>
        </div>
        <div className="flex items-end gap-2">
          <span className={`text-3xl font-bold leading-none ${gaugeText(probPct)}`}>
            {probPct}
            <span className="text-base">%</span>
          </span>
          <div className="flex-1 mb-1">
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${gaugeBar(probPct)}`}
                style={{ width: `${probPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Vertical stage timeline */}
      <div className="px-3 py-3">
        <div className="flex flex-col">
          {stages.map((s: any, i: number) => {
            const style = s.reached ? riskFor(s.prob, s.isLaunch && s.reached) : FUTURE;
            const isLast = i === stages.length - 1;
            const hasEvents = s.inWindow.length > 0;
            return (
              <div key={s.phase.id} className="flex gap-2.5" ref={s.active ? activeRowRef : undefined}>
                {/* Rail */}
                <div className="flex flex-col items-center w-3 shrink-0">
                  <div
                    className={`mt-0.5 rounded-full border-2 transition-all ${style.dot} ${
                      s.active ? `w-3.5 h-3.5 ${style.ring} animate-pulse` : 'w-2.5 h-2.5'
                    }`}
                  />
                  {!isLast && (
                    <div className={`w-0.5 flex-1 my-1 rounded-full ${s.completed ? style.line : 'bg-gray-800'}`} />
                  )}
                </div>

                {/* Content */}
                <div className="text-left flex-1 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-bold leading-tight ${style.name} ${s.active ? 'tracking-wide' : ''}`}>
                      {s.phase.name}
                      {s.active && <span className="ml-1.5 text-[9px] font-normal text-amber-400/80">◀ 현재</span>}
                      {s.isLaunch && s.reached && (
                        <span className="ml-1 text-red-400 text-[10px] font-mono font-bold">[L]</span>
                      )}
                    </span>
                    {s.dday && (
                      <span className={`shrink-0 text-[10px] font-mono px-1 py-0.5 rounded border ${style.badge}`}>
                        {s.dday}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    {s.prob != null && (
                      <span className={`font-mono font-bold ${style.prob}`} title="과거 유사사례 기준 발사확률">
                        {s.prob}%
                      </span>
                    )}
                    {hasEvents && (
                      <span className={s.reached ? 'text-gray-500' : 'text-gray-600'}>
                        {s.collected.length > 0
                          ? `첩보 ${s.collected.length}건`
                          : `예정 ${s.inWindow.length}건`}
                      </span>
                    )}
                  </div>

                  {/* Expanded intel items (항상 노출) */}
                  {hasEvents && (
                    <div className="mt-1.5 space-y-1 border-l border-gray-700/50 pl-2">
                      {s.inWindow.map((e: any) => {
                        const seen = e.timestamp <= currentTime;
                        return (
                          <div key={e.id} className={`flex items-start gap-1.5 ${seen ? '' : 'opacity-40'}`}>
                            <div className="min-w-0">
                              <p className={`text-xs leading-tight ${seen ? 'text-gray-300' : 'text-gray-500'}`}>
                                {e.title}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {launchReached && (
          <div className="mt-1 px-2 py-1.5 rounded bg-red-950/40 border border-red-800/50 text-center animate-fade-in">
            <p className="text-[10px] font-bold text-red-300">[L] 발사 확인 · CUSTODY 추적</p>
          </div>
        )}
      </div>
    </div>
  );
}

function gaugeText(pct: number) {
  if (pct >= 75) return 'text-red-400';
  if (pct >= 50) return 'text-orange-400';
  if (pct >= 25) return 'text-yellow-400';
  return 'text-gray-300';
}
function gaugeBar(pct: number) {
  if (pct >= 75) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
  if (pct >= 50) return 'bg-orange-500';
  if (pct >= 25) return 'bg-yellow-500';
  return 'bg-gray-500';
}

// 이벤트 타임라인 뷰(viewMode === 'timeline')용 시각 포맷.
function formatEventTs(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 세로 이벤트 타임라인. 과거(currentTime 이전) 징후는 강조, 미래는 흐림.
// 발사/타격 이벤트는 레일 점을 붉게 강조한다.
function EventTimeline({ events, currentTime }: { events: TimelineEvent[]; currentTime: number }) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-[11px] text-gray-600 text-center">관측 이벤트 없음 — 재생을 시작하면 징후가 표시됩니다.</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="flex flex-col">
        {sorted.map((e, i) => {
          const seen = e.timestamp <= currentTime;
          const isLaunch = e.type === 'launch' || e.type === 'strike';
          const isLast = i === sorted.length - 1;
          const dotCls = isLaunch && seen
            ? 'bg-red-500 border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.6)]'
            : seen
              ? 'bg-cyan-400 border-cyan-300'
              : 'bg-transparent border-gray-600';
          const lineCls = seen ? (isLaunch ? 'bg-red-500/40' : 'bg-cyan-500/30') : 'bg-gray-800';
          return (
            <div key={e.id} className="flex gap-2.5">
              <div className="flex flex-col items-center w-3 shrink-0">
                <div className={`mt-1 rounded-full border-2 w-2.5 h-2.5 ${dotCls} ${seen && !isLaunch ? 'animate-pulse' : ''}`} />
                {!isLast && <div className={`w-0.5 flex-1 my-1 rounded-full ${lineCls}`} />}
              </div>
              <div className="flex-1 pb-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[12px] font-medium leading-tight truncate ${seen ? 'text-gray-200' : 'text-gray-500'}`}>
                    {e.title}
                  </span>
                  <span className="text-[9px] font-mono text-gray-500 shrink-0 tabular-nums">{formatEventTs(e.timestamp)}</span>
                </div>
                {e.description && (
                  <p className={`text-[10px] leading-snug mt-0.5 break-keep ${seen ? 'text-gray-400' : 'text-gray-600'}`}>
                    {e.description}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-0.5">
                  {e.actionClass && (
                    <span className="text-[9px] px-1 rounded bg-cyan-950/40 text-cyan-300/80 border border-cyan-900/40">{e.actionClass}</span>
                  )}
                  {isLaunch && seen && (
                    <span className="text-[9px] px-1 rounded bg-red-950/50 text-red-300 border border-red-900/50 font-bold">LAUNCH</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

