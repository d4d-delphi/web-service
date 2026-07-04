'use client';

import { TimelineEvent } from '@/types';

interface EventModalProps {
  event: TimelineEvent | null;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  intel: '정보',
  movement: '이동',
  launch: '발사',
  strike: '타격',
  bda: 'BDA',
  alert: '경보',
};

// Popped on top of the page the moment playback reaches an event; the caller
// clears `event` after 3s (a draining bar visualizes that countdown). Rendered
// with `pointer-events-none` on the overlay so it never blocks the map/timeline —
// only the card itself (close button) is interactive.
export default function EventModal({ event, onClose }: EventModalProps) {
  if (!event) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 pointer-events-none">
      {/* Scrim: 시각적 집중 유도, 인터랙션 차단하지 않음 */}
      <div className="absolute inset-0 bg-black/25" />
      {/* 모달 카드 */}
      <div
        // key via parent remount drives the entrance animation per event
        className="relative animate-modal-in pointer-events-auto w-[min(92vw,420px)] rounded-xl border border-amber-500/40 layer-modal backdrop-blur-sm overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-amber-900/30">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-[11px] uppercase tracking-widest text-amber-500/80 font-bold">
            신규 첩보 수신
          </span>
          <span className="ml-auto text-[10px] font-mono text-gray-500">{event.time}</span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors leading-none text-base"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            {event.actionClass && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-mono">
                {event.actionClass}
              </span>
            )}
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300">
              {TYPE_LABEL[event.type] ?? event.type}
            </span>
            {event.mgrs && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                {event.mgrs}
              </span>
            )}
          </div>
          <p className="text-base font-bold text-gray-100 leading-snug">{event.title}</p>
          <p className="mt-1 text-xs text-gray-400 leading-relaxed line-clamp-4">
            {event.description}
          </p>
        </div>

        {/* 3s auto-dismiss countdown */}
        <div className="h-0.5 bg-gray-800">
          <div className="h-full bg-amber-400 animate-modal-countdown" />
        </div>
      </div>
    </div>
  );
}
