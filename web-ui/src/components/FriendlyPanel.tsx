'use client';

import { FriendlyAsset } from '@/types';

interface FriendlyPanelProps {
  friendlies: FriendlyAsset[];
}

function AssetStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ready: 'bg-green-500/20 text-green-400 border-green-500/30',
    engaged: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    returning: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    standby: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const labels: Record<string, string> = {
    ready: '준비완료',
    engaged: '교전중',
    returning: '복귀중',
    standby: '대기',
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[status] || colors.standby}`}>
      {labels[status] || status}
    </span>
  );
}

function AssetIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    MISSILE: '🚀',
    FIGHTER: '✈️',
    ISR: '👁️',
    SHIP: '🚢',
    COMMAND: '📡',
  };
  return <span className="text-sm">{icons[type] || '•'}</span>;
}

export default function FriendlyPanel({ friendlies }: FriendlyPanelProps) {
  return (
    <div className="h-full flex flex-col bg-[#0d1117] border-l border-blue-900/30">
      {/* Header */}
      <div className="p-3 border-b border-blue-900/30 bg-blue-950/20">
        <h2 className="text-sm font-bold text-blue-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          아군 정보 (FRIENDLY)
        </h2>
      </div>

      {/* Asset List */}
      <div className="px-3 py-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">가용 자산</h3>
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
          {friendlies.map((asset) => (
            <div
              key={asset.id}
              className="p-2 rounded bg-blue-950/20 border border-blue-900/20 hover:border-blue-700/40 text-xs transition-all"
            >
              <div className="flex justify-between items-center">
                <span className="font-medium text-blue-300 flex items-center gap-1.5">
                  <AssetIcon type={asset.type} />
                  {asset.name}
                </span>
                <AssetStatusBadge status={asset.status} />
              </div>
              {asset.capability && (
                <p className="text-blue-400/60 text-[10px] mt-0.5 ml-6">{asset.capability}</p>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
