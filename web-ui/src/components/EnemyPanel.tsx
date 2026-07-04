'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TimelineEvent, ScenarioPhase, InferenceResult } from '@/types';

interface EnemyPanelProps {
  events: TimelineEvent[];
  currentTime: number;
  inferenceResult: InferenceResult | null;
  scenarios?: { id: string; name: string; phases: ScenarioPhase[] }[];
}

export default function EnemyPanel({ events, currentTime, inferenceResult, scenarios = [] }: EnemyPanelProps) {
  const visibleEvents = events.filter((e) => e.timestamp <= currentTime).slice().reverse();

  // 30% 이상인 시나리오들 필터링
  const confirmedHypotheses = (inferenceResult?.hypotheses || []).filter(h => h.posterior >= 0.3);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] border-r border-gray-800/50">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 bg-gray-900/40 shrink-0">
        <h2 className="text-sm font-bold text-gray-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          특이 동향 감시
        </h2>
      </div>

      {/* Feed Area (항상 표시) */}
      <div className="flex-1 px-3 py-3 overflow-y-auto">
        {visibleEvents.length === 0 ? (
          <p className="text-xs text-gray-600 text-center mt-4">새로운 특이동향 없음</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleEvents.map((e) => (
              <div key={e.id} className="flex items-start gap-2 p-2 rounded bg-gray-800/30 border border-gray-700/50 animate-fade-in">
                <SourceBadge actionClass={e.actionClass} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-gray-300 leading-tight">
                    {e.title}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1 leading-snug break-keep">
                    {e.description}
                  </p>
                  <p className="text-[9px] text-gray-600 font-mono mt-1">{e.time}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 임계점을 넘은 시나리오들 (추가 표시) */}
      {confirmedHypotheses.length > 0 && (
        <div className="shrink-0 flex flex-col border-t border-gray-800 bg-gray-900/80 max-h-[50%] overflow-y-auto">
          <div className="p-2 border-b border-gray-800 bg-black/40 sticky top-0 z-10 shadow-md">
             <span className="text-[10px] text-gray-400 font-bold tracking-wider">식별된 위협 시나리오 (신뢰도 30% 이상)</span>
          </div>
          <div className="p-2 flex flex-col gap-2">
            {confirmedHypotheses.map(h => {
              const scenario = scenarios.find(s => s.id === h.hypothesis);
              return (
                <ScenarioBlock 
                  key={h.hypothesis} 
                  hypothesisId={h.hypothesis} 
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
    </div>
  );
}

function ScenarioBlock({ hypothesisId, posterior, scenario, events, currentTime }: any) {
  const [isExpanded, setIsExpanded] = useState(true);
  const probPct = Math.round(posterior * 100);

  if (!scenario) {
    return (
      <div className="rounded border border-gray-700 bg-gray-800/30 overflow-hidden">
        <div className="p-2 flex items-center justify-between cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
           <span className="text-[12px] font-bold text-gray-400">{hypothesisId}</span>
           <span className="text-[10px] text-gray-500 font-mono">{probPct}%</span>
        </div>
      </div>
    );
  }

  const stages = scenario.phases.map((phase: any) => {
    const inWindow = events.filter((e: any) => e.timestamp >= phase.startTime && e.timestamp < phase.endTime);
    const isLaunch = inWindow.some((e: any) => e.type === 'launch' || e.type === 'strike');
    const reached = currentTime >= phase.startTime;
    const active = reached && currentTime < phase.endTime;
    const completed = currentTime >= phase.endTime;
    return {
      phase,
      isLaunch,
      reached,
      active,
      completed,
      dday: phaseDday(phase.description),
      prob: phaseProb(phase.description)
    };
  });

  return (
    <div className="rounded border border-gray-700 bg-gray-800/50 overflow-hidden shadow-lg">
      <div className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-gray-700/50 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
         <div className="flex items-center gap-2 min-w-0">
           <span className={`w-2 h-2 rounded-full ${probPct >= 60 ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-amber-500'}`}></span>
           <span className="text-[12px] font-bold text-gray-200 truncate">{scenario.name}</span>
         </div>
         <div className="flex items-center gap-2 shrink-0 ml-2">
           <span className={`text-[11px] font-mono font-bold ${probPct >= 60 ? 'text-red-400' : 'text-amber-400'}`}>{probPct}%</span>
           <svg className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
           </svg>
         </div>
      </div>
      
      {isExpanded && (
        <div className="p-3 pt-1 border-t border-gray-700/50 bg-gray-900/30">
          <div className="flex flex-col mt-2">
            {stages.map((s: any, i: number) => {
              const style = s.reached ? riskFor(s.prob, s.isLaunch && s.reached) : FUTURE;
              const isLast = i === stages.length - 1;
              return (
                <div key={s.phase.id} className="flex gap-2">
                  <div className="flex flex-col items-center w-3 shrink-0">
                    <div className={`mt-1 rounded-full border-2 transition-all ${style.dot} ${s.active ? `w-2.5 h-2.5 ${style.ring} animate-pulse` : 'w-2 h-2'}`} />
                    {!isLast && <div className={`w-0.5 flex-1 my-0.5 rounded-full ${s.completed ? style.line : 'bg-gray-800'}`} />}
                  </div>
                  <div className="flex-1 pb-2.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-[11px] font-bold leading-tight ${style.name} ${s.active ? 'tracking-wide' : ''}`}>
                        {s.phase.name}
                        {s.isLaunch && s.reached && <span className="ml-1">🚀</span>}
                      </span>
                      {s.dday && <span className={`shrink-0 text-[8px] font-mono px-1 py-0.5 rounded border ${style.badge}`}>{s.dday}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
    IMINT: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    SIGINT: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    MASINT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    UAV: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    OSINT: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    HUMINT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };
  return (
    <span
      className={`shrink-0 text-[8px] px-1 py-0.5 rounded border font-mono ${
        styles[actionClass] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
      }`}
    >
      {actionClass}
    </span>
  );
}
