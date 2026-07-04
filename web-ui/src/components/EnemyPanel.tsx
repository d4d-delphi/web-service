'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TimelineEvent, ScenarioPhase, InferenceResult } from '@/types';

interface EnemyPanelProps {
  events: TimelineEvent[];
  currentTime: number;
  inferenceResult: InferenceResult | null;
  scenarios?: { id: string; name: string; phases: ScenarioPhase[] }[];
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

export default function EnemyPanel({ events, currentTime, inferenceResult, scenarios = [] }: EnemyPanelProps) {
  const visibleEvents = events.filter((e) => e.timestamp <= currentTime).slice().reverse();

  // 30% 이상인 시나리오들 필터링 및 확률 높은 순 정렬
  const confirmedHypotheses = (inferenceResult?.hypotheses || [])
    .filter(h => h.posterior >= 0.3)
    .sort((a, b) => b.posterior - a.posterior);

  return (
    <div className="h-full flex flex-col layer-1 border-r border-gray-800/50">
      
      {/* 상단: 식별된 위협 시나리오들 */}
      {confirmedHypotheses.length > 0 && (
        <div className="shrink-0 flex flex-col border-b border-gray-800 bg-gray-900/80 max-h-[60%] overflow-y-auto">
          <div className="p-2 flex flex-col gap-2">
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
      )}

      {/* 하단: 특이 동향 감시 피드 (항상 표시) */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-800 bg-gray-900/40 shrink-0">
          <h2 className="text-sm font-bold text-gray-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            특이 동향 감시
          </h2>
        </div>

        <div className="flex-1 px-3 py-3 overflow-y-auto">
          {visibleEvents.length === 0 ? (
            <p className="text-xs text-gray-600 text-center mt-4">새로운 특이동향 없음</p>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-2 p-2 rounded bg-gray-800/30 border border-gray-700/50 animate-fade-in">
                  <SourceBadge actionClass={e.actionClass} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-300 leading-tight">
                      {e.title}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1 leading-snug break-keep">
                      {e.description}
                    </p>
                    <p className="text-[10px] text-gray-600 font-mono mt-1">{e.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function ScenarioBlock({ hypothesisId, posterior, scenario, events, currentTime }: any) {
  const probPct = Math.round(posterior * 100);

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

  const stages = scenario.phases.map((phase: any) => {
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
              <div key={s.phase.id} className="flex gap-2.5">
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

function SourceBadge({ actionClass }: { actionClass?: string }) {
  if (!actionClass) {
    return <span className="shrink-0 w-1.5 h-1.5 mt-1 rounded-full bg-gray-600" />;
  }
  const styles: Record<string, string> = {
    IMINT: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    SIGINT: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    MASINT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    UAV: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    OSINT: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    HUMINT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };
  return (
    <span
      className={`shrink-0 text-[10px] px-1 py-0.5 rounded border font-mono ${
        styles[actionClass] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
      }`}
    >
      {actionClass}
    </span>
  );
}
