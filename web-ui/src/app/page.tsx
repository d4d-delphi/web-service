'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import EnemyPanel from '@/components/EnemyPanel';
import FriendlyPanel from '@/components/FriendlyPanel';
import Timeline from '@/components/Timeline';
import EventModal from '@/components/EventModal';
import { Scenario, ScenarioId, ScenarioPhase, InferenceResult, TimelineEvent } from '@/types';
import { runInference } from '@/lib/bayesian';
import { structureReport } from '@/lib/spuq';
import hypothesesData from '@/data/hypotheses.json';
import scenarioAData from '@/data/scenario-a.json';
import scenarioBData from '@/data/scenario-b.json';

const CesiumMap = dynamic(() => import('@/components/CesiumMap'), { ssr: false });

export default function Home() {
  const [activeScenario, setActiveScenario] = useState<ScenarioId>('scenario-a');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // 재생 배속 (1x 기본 / 5x 빨리감기)
  const [destroyedAssets, setDestroyedAssets] = useState<string[]>([]);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 각 이벤트가 "발생"하는 순간(재생 시각이 timestamp를 넘을 때) 상단에 모달을 띄우고
  // 3초 후 자동으로 감춘다.
  const [modalEvent, setModalEvent] = useState<TimelineEvent | null>(null);
  const shownEventIdsRef = useRef<Set<string>>(new Set());
  const modalTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 원천 첩보(events)를 Supabase `observation`에서 Next.js API 경유로 로드.
  // 실패/미설정 시 정적 mock 타임라인으로 폴백한다.
  const [supabaseEvents, setSupabaseEvents] = useState<TimelineEvent[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/events')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled && Array.isArray(data.events) && data.events.length) {
          setSupabaseEvents(data.events as TimelineEvent[]);
        }
      })
      .catch((err) => console.warn('Falling back to mock events:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const scenarioBase: Scenario = (activeScenario === 'scenario-a' ? scenarioAData : scenarioBData) as Scenario;

  // Supabase 이벤트가 있으면 mock 타임라인을 대체한다. 관측 시간축(0..1)을
  // 활성 시나리오 재생 duration에 매핑해 timestamp를 부여한다.
  // 단계(사전개발·연료/동체생산·기동/국제통보·VIP/A2AD·발사임박·발사/추적·OSINT검증)는
  // 이름·구간은 유지하되, 카메라 목표점을 해당 구간 실제 관측(MGRS) 중심으로 재설정한다.
  const scenario: Scenario = useMemo(() => {
    if (!supabaseEvents || supabaseEvents.length === 0) return scenarioBase;
    const n = supabaseEvents.length;
    const span = Math.max(scenarioBase.duration - 300, 1);
    // 이벤트는 collected_at 순으로 정렬되어 온다. 절대 시간축은 소수의 과거
    // 관측(2014·2017)에 눌려 최근 발사국면이 한 단계에 뭉치므로, 순번 기준으로
    // 균등 배치해 7개 단계가 고르게 채워지도록 한다.
    const timeline: TimelineEvent[] = supabaseEvents.map((e, i) => ({
      ...e,
      timestamp: Math.round((n > 1 ? i / (n - 1) : 0) * span),
    }));

    // 각 단계 구간 [startTime, endTime) 에 속한 실제 이벤트 위치의 평균으로
    // cameraTarget 을 갱신. 구간에 관측이 없으면 기존(mock) 목표점을 유지한다.
    const phases: ScenarioPhase[] = scenarioBase.phases.map((phase) => {
      const inWindow = timeline.filter(
        (e) => e.position && e.timestamp >= phase.startTime && e.timestamp < phase.endTime,
      );
      if (inWindow.length === 0) return phase;
      const lat = inWindow.reduce((s, e) => s + e.position!.lat, 0) / inWindow.length;
      const lng = inWindow.reduce((s, e) => s + e.position!.lng, 0) / inWindow.length;
      return {
        ...phase,
        cameraTarget: { lat, lng, range: phase.cameraTarget?.range ?? 400000 },
      };
    });

    return { ...scenarioBase, timeline, phases };
  }, [supabaseEvents, scenarioBase]);

  // Playback logic
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + 10 * speed; // 기본 배속 × (빨리감기 시 5)
          if (next >= scenario.duration) {
            setIsPlaying(false);
            return scenario.duration;
          }
          return next;
        });
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, scenario.duration, speed]);

  // Run Bayesian inference as events appear (optimized)
  const lastVisibleEventIdsRef = useRef<string>('');
  const structuredActionsCacheRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    const visibleEvents = scenario.timeline.filter((e) => e.timestamp <= currentTime);
    if (visibleEvents.length === 0) {
      setInferenceResult(null);
      lastVisibleEventIdsRef.current = '';
      return;
    }

    const currentEventIds = visibleEvents.map((e) => e.id).join(',');
    if (currentEventIds === lastVisibleEventIdsRef.current) {
      return; // No new events, skip heavy SPUQ & Bayesian calculations
    }
    lastVisibleEventIdsRef.current = currentEventIds;

    // 이벤트를 액션 클래스로 정형화 (캐시 활용하여 연산량 최소화)
    const actions = visibleEvents.map((event, i) => {
      const cacheId = event.id || `event-${i}`;
      if (structuredActionsCacheRef.current.has(cacheId)) {
        return structuredActionsCacheRef.current.get(cacheId);
      }
      const action = structureReport(
        `${event.title}: ${event.description}`,
        cacheId,
        event.actionClass || 'IMINT',
        0.8,
        event.time
      );
      structuredActionsCacheRef.current.set(cacheId, action);
      return action;
    });

    // 베이지안 추론 실행
    const result = runInference(actions, hypothesesData as any);
    setInferenceResult(result);
  }, [currentTime, scenario.timeline]);

  // 재생 중, 새로 발생한(방금 timestamp를 넘긴) 이벤트를 모달로 알림.
  // 한 틱에 여러 개가 넘어가면 가장 최근 것을 보여주고 나머지도 '표시됨'으로 처리한다.
  useEffect(() => {
    if (!isPlaying) return;
    const newly = scenario.timeline.filter(
      (e) => e.timestamp <= currentTime && !shownEventIdsRef.current.has(e.id),
    );
    if (newly.length === 0) return;
    newly.forEach((e) => shownEventIdsRef.current.add(e.id));
    const latest = newly.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a));
    setModalEvent(latest);
    if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
    modalTimeoutRef.current = setTimeout(() => setModalEvent(null), 3000);
  }, [currentTime, isPlaying, scenario.timeline]);

  useEffect(() => () => {
    if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
  }, []);

  // Both scenarios are launch-indicator timelines (no strike/destruction phase)
  useEffect(() => {
    setDestroyedAssets([]);
  }, [activeScenario]);

  const handleScenarioChange = (id: ScenarioId) => {
    setActiveScenario(id);
    setCurrentTime(0);
    setIsPlaying(false);
    setSpeed(1);
    setDestroyedAssets([]);
    setInferenceResult(null);
    shownEventIdsRef.current.clear();
    setModalEvent(null);
    if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
  };

  const handlePhaseClick = (phase: ScenarioPhase) => {
    setCurrentTime(phase.startTime);
  };

  // 빨리감기: 1x ↔ 5x 토글. 켜면 곧바로 재생을 시작한다.
  const handleFastForward = () => {
    setSpeed((s) => (s === 5 ? 1 : 5));
    setIsPlaying(true);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0e1a]">
      {/* 이벤트 발생 알림 모달 (3초 후 자동 종료). key로 이벤트마다 재진입 애니메이션 */}
      <EventModal key={modalEvent?.id} event={modalEvent} onClose={() => setModalEvent(null)} />

      {/* Top Bar */}
      <header className="relative h-10 bg-[#0d1117] border-b border-gray-800 flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-gray-200 tracking-wide">
            <span className="text-amber-400">NL</span>-COP
          </h1>
          <span className="text-[10px] text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">
            다중출처 융합 지휘통제
          </span>
        </div>

        {/* Center - Simulation Clock (재생 시각에 동기화된 관측 일자) */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <SimClock timeline={scenario.timeline} currentTime={currentTime} speed={speed} isPlaying={isPlaying} />
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            SYSTEM ONLINE
          </span>
        </div>
      </header>

      {/* Main Content: 3 panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Enemy Info */}
        <div className="w-[20%] min-w-[240px]">
          <EnemyPanel
            events={scenario.timeline}
            currentTime={currentTime}
            inferenceResult={inferenceResult}
          />
        </div>

        {/* Center - Map */}
        <div className="flex-1">
          <CesiumMap
            scenario={scenario}
            currentTime={currentTime}
            destroyedAssets={destroyedAssets}
          />
        </div>

        {/* Right Panel - Friendly Info */}
        <div className="w-[20%] min-w-[240px]">
          <FriendlyPanel friendlies={scenario.friendlies} />
        </div>
      </div>

      {/* Timeline */}
      <Timeline
        phases={scenario.phases}
        currentTime={currentTime}
        duration={scenario.duration}
        isPlaying={isPlaying}
        speed={speed}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onFastForward={handleFastForward}
        onPhaseClick={handlePhaseClick}
        onScenarioChange={handleScenarioChange}
        activeScenario={activeScenario}
      />
    </div>
  );
}

// 재생 시각(currentTime)을 관측 타임라인의 실제 일자로 환산한다.
// 각 이벤트의 collectedAt(정본 시간축)을 재생 timestamp에 맞춰 선형 보간하므로,
// 재생/빨리감기 진행에 따라 날짜가 함께 흐른다. 이벤트 부재 시 null.
function simDateFromTimeline(timeline: TimelineEvent[], currentTime: number): Date | null {
  const evs = timeline
    .filter((e) => e.collectedAt)
    .map((e) => ({ t: e.timestamp, ms: new Date(e.collectedAt as string).getTime() }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((a, b) => a.t - b.t);
  if (evs.length === 0) return null;
  if (currentTime <= evs[0].t) return new Date(evs[0].ms);
  for (let i = 0; i < evs.length - 1; i++) {
    const a = evs[i];
    const b = evs[i + 1];
    if (currentTime >= a.t && currentTime <= b.t) {
      const f = (currentTime - a.t) / (b.t - a.t || 1);
      return new Date(a.ms + (b.ms - a.ms) * f);
    }
  }
  return new Date(evs[evs.length - 1].ms);
}

// 시뮬레이션 시계 — 상단 중앙, 재생 시각에 동기화된 관측 일자(날짜만)를 표시.
function SimClock({
  timeline,
  currentTime,
  speed,
  isPlaying,
}: {
  timeline: TimelineEvent[];
  currentTime: number;
  speed: number;
  isPlaying: boolean;
}) {
  const date = useMemo(() => simDateFromTimeline(timeline, currentTime), [timeline, currentTime]);
  const fast = isPlaying && speed > 1;
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 rounded-md bg-amber-950/30 border border-amber-900/40">
      <span className={`w-1.5 h-1.5 rounded-full bg-amber-400 ${isPlaying ? 'animate-pulse' : ''}`}></span>
      <span className="font-mono text-[11px] text-amber-400/70 tracking-wide tabular-nums">관측일자</span>
      <span className="font-mono text-base font-bold tracking-widest tabular-nums text-amber-300 [text-shadow:0_0_8px_rgba(251,191,36,0.4)]">
        {date
          ? date.toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              weekday: 'short',
            })
          : '—'}
      </span>
      {fast && (
        <span className="font-mono text-[10px] text-amber-400/80 border border-amber-800/50 rounded px-1">
          ▶▶ {speed}x
        </span>
      )}
    </div>
  );
}
