'use client';

import { LaunchConfig } from '@/types';
import { trackAt, machOf, formatMET } from '@/lib/custody';

// 발사(H-0) 이후 타임라인을 대체하는 실시간 추적(Custody) 텔레메트리 HUD.
// 재생 진행도(progress)에 맞춰 합성된 고도/속도/다운레인지/MET를 표시한다.
export default function CustodyHUD({
  launch,
  progress,
  speed,
  isPlaying,
}: {
  launch: LaunchConfig;
  progress: number;
  speed: number;
  isPlaying: boolean;
}) {
  const t = trackAt(launch, progress);
  const fast = isPlaying && speed > 1;
  const pct = Math.round(t.progress * 100);

  return (
    <div className="relative bg-[#160b06] border-t border-amber-900/50 px-4 py-2 overflow-hidden">
      {/* 배경 스캔라인 글로우 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-red-950/20 via-transparent to-amber-950/20" />
      <div className="relative flex items-center gap-4">
        {/* 상태 + 표적 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <div className="leading-tight">
            <div className="text-[10px] font-bold tracking-widest text-red-400">CUSTODY · 실시간 추적</div>
            <div className="text-[10px] text-amber-200/60 font-mono">{launch.target.name}</div>
          </div>
        </div>

        {/* MET */}
        <Readout label="MET" value={formatMET(t.metSec)} mono wide />

        {/* 텔레메트리 타일 */}
        <Readout label="고도 ALT" value={`${Math.round(t.altKm)}`} unit="km" />
        <Readout label="속도 VEL" value={t.velKms.toFixed(2)} unit={`km/s · M${Math.round(machOf(t.velKms))}`} />
        <Readout label="다운레인지" value={`${Math.round(t.downrangeKm)}`} unit="km" />

        {/* 궤적 진행 바 */}
        <div className="flex-1 min-w-[80px]">
          <div className="flex justify-between text-[9px] font-mono text-amber-300/50 mb-1">
            <span>{launch.site.name}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 bg-amber-950/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-amber-300 rounded-full transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {fast && (
          <span className="shrink-0 font-mono text-[10px] text-amber-300 border border-amber-700/60 rounded px-1.5 py-0.5">
            ▶▶ {speed}x
          </span>
        )}
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  unit,
  mono,
  wide,
}: {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`shrink-0 ${wide ? 'min-w-[76px]' : 'min-w-[64px]'}`}>
      <div className="text-[9px] tracking-wider text-amber-300/50">{label}</div>
      <div className="flex items-baseline gap-1">
        <span
          className={`text-amber-200 font-bold tabular-nums ${mono ? 'font-mono text-sm' : 'text-base'} [text-shadow:0_0_8px_rgba(251,191,36,0.35)]`}
        >
          {value}
        </span>
        {unit && <span className="text-[9px] text-amber-300/50 font-mono">{unit}</span>}
      </div>
    </div>
  );
}
