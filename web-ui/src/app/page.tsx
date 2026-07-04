'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import EnemyPanel from '@/components/EnemyPanel';
import FriendlyPanel from '@/components/FriendlyPanel';
import Timeline from '@/components/Timeline';
import { Scenario, ScenarioId, ScenarioPhase, InferenceResult } from '@/types';
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
  const [destroyedAssets, setDestroyedAssets] = useState<string[]>([]);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const scenario: Scenario = (activeScenario === 'scenario-a' ? scenarioAData : scenarioBData) as Scenario;

  // Playback logic
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + 10; // 10x speed
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
  }, [isPlaying, scenario.duration]);

  // Run Bayesian inference as events appear
  useEffect(() => {
    const visibleEvents = scenario.timeline.filter((e) => e.timestamp <= currentTime);
    if (visibleEvents.length === 0) {
      setInferenceResult(null);
      return;
    }

    // 이벤트를 액션 클래스로 정형화
    const actions = visibleEvents.map((event, i) =>
      structureReport(
        `${event.title}: ${event.description}`,
        event.id || `event-${i}`,
        event.actionClass || 'IMINT',
        0.8,
        event.time
      )
    );

    // 베이지안 추론 실행
    const result = runInference(actions, hypothesesData as any);
    setInferenceResult(result);
  }, [currentTime, scenario.timeline]);

  // Both scenarios are launch-indicator timelines (no strike/destruction phase)
  useEffect(() => {
    setDestroyedAssets([]);
  }, [activeScenario]);

  const handleScenarioChange = (id: ScenarioId) => {
    setActiveScenario(id);
    setCurrentTime(0);
    setIsPlaying(false);
    setDestroyedAssets([]);
    setInferenceResult(null);
  };

  const handlePhaseClick = (phase: ScenarioPhase) => {
    setCurrentTime(phase.startTime);
  };

  return (
    <div className="h-screen w-screen flex flex-col">
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

        {/* Center - Live Clock */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <LiveClock />
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
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onPhaseClick={handlePhaseClick}
        onScenarioChange={handleScenarioChange}
        activeScenario={activeScenario}
      />
    </div>
  );
}

// 실시간 시계 — 상단 중앙, 시간이 흐르고 있음을 강조
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 rounded-md bg-amber-950/30 border border-amber-900/40">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
      <span className="font-mono text-[11px] text-amber-400/70 tracking-wide tabular-nums">
        {now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}
      </span>
      <span className="font-mono text-base font-bold tracking-widest tabular-nums text-amber-300 [text-shadow:0_0_8px_rgba(251,191,36,0.4)]">
        {now.toLocaleTimeString('ko-KR', { hour12: false })}
      </span>
    </div>
  );
}
