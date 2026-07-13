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
}: TimelineProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const currentPhase = phases.find(
    (p) => currentTime >= p.startTime && currentTime < p.endTime
  );

  return (
    <div className="bg-[#0d1117] border-t border-gray-800 px-4 py-2">
      <div className="flex items-center gap-3">


        {/* Play/Pause */}
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="w-9 h-9 flex items-center justify-center rounded bg-gray-800 border border-gray-700 hover:border-gray-500 transition-all"
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

        {/* 재생 배속 선택: 1× / 3× / 5× / 10× (구 빨리감기 토글 1→5→20→1 대체). */}
        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          title={`재생 배속 (현재 ${speed}×)`}
          className="h-7 px-1.5 flex items-center rounded border bg-gray-800 border-gray-700 text-gray-300 font-mono text-[11px] font-bold hover:border-gray-500 transition-all"
        >
          <option value={1}>1×</option>
          <option value={3}>3×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
        </select>

        {/* Progress Bar */}
        <div className="flex-1 relative">
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Phase markers */}
          <div className="absolute top-0 left-0 right-0 h-1.5 flex">
            {phases.map((phase) => {
              const left = (phase.startTime / duration) * 100;
              return (
                <div
                  key={phase.id}
                  className="absolute top-0 w-px h-full bg-gray-600"
                  style={{ left: `${left}%` }}
                />
              );
            })}
          </div>
        </div>



        {/* Time Display + current phase breadcrumb */}
        <div className="flex flex-col items-end gap-0.5">
          <div className="text-sm font-mono text-gray-400 min-w-[60px] text-right">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          {currentPhase && (
            <div className="text-[11px] text-gray-500 font-mono max-w-[160px] truncate text-right">
              <span className="text-gray-700">▶</span> {currentPhase.name}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
