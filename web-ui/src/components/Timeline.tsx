'use client';

import { ScenarioPhase, ScenarioId } from '@/types';

interface TimelineProps {
  phases: ScenarioPhase[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onPhaseClick: (phase: ScenarioPhase) => void;
  onScenarioChange: (id: ScenarioId) => void;
  activeScenario: ScenarioId;
  // 전체 화면 PNG 캡처 핸들러 (page.tsx 에서 Cesium+DOM 합성 처리).
  onCapture: () => void;
}

// Phase description 에 포함된 D-day 구간 라벨을 추출한다.
// 예: "Pre-Phase (D-90~D-30): ..." → "D-90~D-30"
//     "Phase 4 (H-6~H-1) 95%: ..." → "H-6~H-1"
//     "H-0/Phase 5: ..."            → "H-0"
// (EnemyPanel.phaseDday 와 동일 정규식 — 단일 진실 원칙.)
function phaseDday(description: string): string | null {
  const m = description.match(/([DH][+\-]\d+(?:\s*~\s*[DH]?[+\-]?\d+)?)/);
  return m ? m[1].replace(/\s+/g, '') : null;
}

export default function Timeline({
  phases,
  currentTime,
  duration,
  isPlaying,
  speed,
  onPlay,
  onPause,
  onSpeedChange,
  onPhaseClick,
  onCapture,
}: TimelineProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const currentPhase = phases.find(
    (p) => currentTime >= p.startTime && currentTime < p.endTime
  );

  // 현재 단계의 D-day 라벨 — 지휘관은 초 단위 재생시각이 아닌 D-day 를 읽는다.
  const currentDday = currentPhase ? phaseDday(currentPhase.description) : null;

  return (
    <div className="bg-[#0d1117] border-t border-gray-800 px-4 py-2 select-none">
      <div className="flex items-center gap-3">

        {/* Play/Pause */}
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded bg-gray-800 border border-gray-700 hover:border-gray-500 transition-all"
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* 재생 배속 선택: 1× / 3× / 5× / 10× */}
        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          title={`재생 배속 (현재 ${speed}×)`}
          className="h-7 shrink-0 px-1.5 flex items-center rounded border bg-gray-800 border-gray-700 text-gray-300 font-mono text-[11px] font-bold hover:border-gray-500 transition-all"
        >
          <option value={1}>1×</option>
          <option value={3}>3×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
        </select>

        {/* 전체 화면 캡처 (Cesium 지도 + 패널 + 타임라인 합성 PNG) */}
        <button
          onClick={onCapture}
          title="전체 화면 캡처 (PNG)"
          className="w-9 h-7 shrink-0 flex items-center justify-center rounded border bg-gray-800 border-gray-700 hover:border-amber-500/60 hover:text-amber-400 text-gray-300 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>

        {/* Phase-step bar — 각 Phase를 라벨드 칩으로 표시, 클릭 시 해당 단계로 점프 */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {phases.map((phase, i) => {
            const isCurrent = currentPhase?.id === phase.id;
            const isCompleted = currentTime >= phase.endTime;
            const dday = phaseDday(phase.description);
            return (
              <button
                key={phase.id}
                onClick={() => onPhaseClick(phase)}
                title={`${phase.name}${dday ? ` (${dday})` : ''}`}
                className={`flex flex-col items-center px-2.5 py-1 rounded text-[11px] font-mono border whitespace-nowrap transition-all ${
                  isCurrent
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.25)]'
                    : isCompleted
                      ? 'bg-amber-900/15 border-amber-800/30 text-amber-200/35'
                      : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                }`}
              >
                {/* 단계 번호 + 이름 */}
                <span className="flex items-center gap-1 leading-tight">
                  <span className={`text-[9px] ${isCurrent ? 'text-amber-500' : 'opacity-60'}`}>{i + 1}</span>
                  <span className="font-bold">{phase.name}</span>
                </span>
                {/* D-day 구간 */}
                {dday && (
                  <span className={`text-[9px] mt-0.5 ${isCurrent ? 'text-amber-400/80' : 'opacity-60'}`}>
                    {dday}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 현재 단계 D-day 표시 (시나리오 시간점) — SimClock 관측일자와 상호보완 */}
        <div className="shrink-0 flex flex-col items-end gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[9px] text-gray-600 font-mono uppercase tracking-wider">D-Day</span>
            <span className="text-sm font-mono font-bold text-amber-400 min-w-[50px] text-right">
              {currentDday ?? '—'}
            </span>
          </div>
          {currentPhase && (
            <div className="text-[11px] text-gray-500 font-mono max-w-[160px] truncate text-right">
              {currentPhase.name}
            </div>
          )}
        </div>
      </div>

      {/* 얇은 진행률 필 라인 (칩 아래) */}
      <div className="mt-2 h-0.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500/50 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
