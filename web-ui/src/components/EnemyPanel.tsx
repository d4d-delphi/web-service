'use client';

import { ThreatAsset, TimelineEvent } from '@/types';

interface EnemyPanelProps {
  threats: ThreatAsset[];
  events: TimelineEvent[];
  currentTime: number;
  threatLevel: number;
  destroyedAssets: string[];
}

function ThreatLevelGauge({ level }: { level: number }) {
  const segments = [1, 2, 3, 4, 5];
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-400">위협 수준</span>
        <span className={`text-xs font-bold ${level >= 4 ? 'text-red-400' : level >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
          LEVEL {level}
        </span>
      </div>
      <div className="flex gap-1">
        {segments.map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-sm transition-all duration-500 ${
              s <= level
                ? level >= 4
                  ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                  : level >= 3
                  ? 'bg-yellow-500'
                  : 'bg-green-500'
                : 'bg-gray-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function AssetStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-red-500/20 text-red-400 border-red-500/30',
    destroyed: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    relocating: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    unknown: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
  };
  const labels: Record<string, string> = {
    active: '활성',
    destroyed: '파괴',
    relocating: '이동중',
    unknown: '불명',
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[status] || colors.unknown}`}>
      {labels[status] || status}
    </span>
  );
}

export default function EnemyPanel({
  threats,
  events,
  currentTime,
  threatLevel,
  destroyedAssets,
}: EnemyPanelProps) {
  const visibleEvents = events.filter((e) => e.timestamp <= currentTime);
  const updatedThreats = threats.map((t) => ({
    ...t,
    status: destroyedAssets.includes(t.id) ? 'destroyed' as const : t.status,
  }));

  return (
    <div className="h-full flex flex-col bg-[#0d1117] border-r border-red-900/30">
      {/* Header */}
      <div className="p-3 border-b border-red-900/30 bg-red-950/20">
        <h2 className="text-sm font-bold text-red-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          적 정보 (THREAT)
        </h2>
      </div>

      {/* Threat Level */}
      <div className="px-3 pt-3">
        <ThreatLevelGauge level={threatLevel} />
      </div>

      {/* Asset List */}
      <div className="px-3 py-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">식별 자산</h3>
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {updatedThreats.map((threat) => (
            <div
              key={threat.id}
              className={`p-2 rounded text-xs border transition-all ${
                threat.status === 'destroyed'
                  ? 'bg-gray-900/50 border-gray-700/30 opacity-60'
                  : 'bg-red-950/30 border-red-900/20 hover:border-red-700/40'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className={`font-medium ${threat.status === 'destroyed' ? 'text-gray-500 line-through' : 'text-red-300'}`}>
                  {threat.name}
                </span>
                <AssetStatusBadge status={threat.status} />
              </div>
              <p className="text-gray-500 text-[10px] mt-0.5">{threat.details}</p>
              {threat.threatRadius ? (
                <p className="text-red-500/70 text-[10px]">위협반경: {threat.threatRadius}km</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Event Feed */}
      <div className="flex-1 px-3 py-2 overflow-hidden">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">징후 피드</h3>
        <div className="space-y-1.5 overflow-y-auto max-h-[calc(100%-24px)]">
          {visibleEvents.slice().reverse().map((event) => (
            <div
              key={event.id}
              className="p-2 rounded bg-gray-900/50 border border-gray-700/30 text-xs animate-fade-in"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-gray-500 font-mono text-[10px]">{event.time}</span>
                <EventTypeBadge type={event.type} />
                <SourceBadge actionClass={event.actionClass} />
              </div>
              <p className="text-gray-300 font-medium text-[11px]">{event.title}</p>
              <p className="text-gray-500 text-[10px]">{event.description}</p>
            </div>
          ))}
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
