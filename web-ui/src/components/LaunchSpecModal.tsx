'use client';

import { LaunchConfig } from '@/types';
import { machOf, formatMET } from '@/lib/custody';

// 발사(H-0) 확인 순간, 지도 영역 위에 발사체 '제원'을 카드 모달로 띄운다.
// 하단바(타임라인/커스터디 HUD)는 건드리지 않고, 지도 컨테이너 안에 절대배치되어
// 지도만 덮는다. 닫기 버튼으로 해제할 수 있다.
export default function LaunchSpecModal({
  launch,
  onClose,
}: {
  launch: LaunchConfig;
  onClose: () => void;
}) {
  const profileLabel =
    launch.profile === 'orbital' ? '궤도투입 · SLV' : '탄도 · BM';
  const mach = Math.round(machOf(launch.maxVelKms));

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-end justify-center pb-8">
      <div className="animate-modal-in pointer-events-auto w-[min(88%,380px)] rounded-xl border border-amber-500/40 bg-[#0d1117]/95 backdrop-blur-sm shadow-[0_0_36px_rgba(245,158,11,0.28)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-amber-900/30">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[10px] uppercase tracking-widest text-amber-500/80 font-bold">
            발사체 제원
          </span>
          <span className="ml-auto text-[9px] font-mono text-amber-300/60 border border-amber-800/50 rounded px-1.5 py-0.5">
            {profileLabel}
          </span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors leading-none text-base"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 발사 → 종단 경로 */}
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-gray-200 font-bold">{launch.site.name}</span>
            <span className="flex-1 border-t border-dashed border-amber-700/50" />
            <span className="text-amber-300 font-bold">{launch.target.name}</span>
          </div>
        </div>

        {/* 제원 그리드 */}
        <div className="grid grid-cols-2 gap-px bg-amber-900/20 mt-2">
          <Spec label="정점고도 APOGEE" value={`${launch.apogeeKm.toLocaleString()}`} unit="km" />
          <Spec label="최대속도 MAX VEL" value={launch.maxVelKms.toFixed(1)} unit={`km/s · M${mach}`} />
          <Spec label="사거리 RANGE" value={`${launch.rangeKm.toLocaleString()}`} unit="km" />
          <Spec label="비행시간 FLIGHT" value={formatMET(launch.flightSec)} unit="MET" mono />
        </div>
      </div>
    </div>
  );
}

function Spec({
  label,
  value,
  unit,
  mono,
}: {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-[#0d1117] px-4 py-2.5">
      <div className="text-[9px] tracking-wider text-amber-300/50">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span
          className={`text-amber-200 font-bold tabular-nums ${mono ? 'font-mono text-sm' : 'text-lg'} [text-shadow:0_0_8px_rgba(251,191,36,0.35)]`}
        >
          {value}
        </span>
        {unit && <span className="text-[9px] text-amber-300/50 font-mono">{unit}</span>}
      </div>
    </div>
  );
}
