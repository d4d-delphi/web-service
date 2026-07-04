'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import EnemyPanel from '@/components/EnemyPanel';
import FriendlyPanel from '@/components/FriendlyPanel';
import Timeline from '@/components/Timeline';
import BriefingModal from '@/components/BriefingModal';
import { Scenario, ScenarioId, ScenarioPhase, BriefingResult, InferenceResult } from '@/types';
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
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [isLoadingBriefing, setIsLoadingBriefing] = useState(false);
  const [showBriefingModal, setShowBriefingModal] = useState(false);
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

  // Handle scenario B destruction events
  useEffect(() => {
    if (activeScenario === 'scenario-b') {
      const destroyed: string[] = [];
      if (currentTime >= 900) destroyed.push('t-radar-b');
      if (currentTime >= 1200) destroyed.push('t-cmd-1');
      if (currentTime >= 1800) destroyed.push('t-sam-a');
      if (currentTime >= 2100) destroyed.push('t-sam-c');
      setDestroyedAssets(destroyed);
    } else {
      setDestroyedAssets([]);
    }
  }, [currentTime, activeScenario]);

  // Get current threat level
  const getCurrentThreatLevel = useCallback(() => {
    const visibleEvents = scenario.timeline.filter((e) => e.timestamp <= currentTime);
    if (visibleEvents.length === 0) return 1;
    return Math.max(...visibleEvents.map((e) => e.threatLevel || 1));
  }, [scenario.timeline, currentTime]);

  const handleScenarioChange = (id: ScenarioId) => {
    setActiveScenario(id);
    setCurrentTime(0);
    setIsPlaying(false);
    setBriefing(null);
    setDestroyedAssets([]);
    setInferenceResult(null);
  };

  const handlePhaseClick = (phase: ScenarioPhase) => {
    setCurrentTime(phase.startTime);
  };

  const handleRequestBriefing = async () => {
    setIsLoadingBriefing(true);
    try {
      const response = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: activeScenario,
          currentTime,
          threats: scenario.threats,
          friendlies: scenario.friendlies,
          events: scenario.timeline.filter((e) => e.timestamp <= currentTime),
        }),
      });
      const data = await response.json();
      setBriefing(data);
      setShowBriefingModal(true);
    } catch {
      // Fallback mock briefing
      setBriefing({
        summary: activeScenario === 'scenario-a'
          ? '무수단리 기지에서 화성-17형 ICBM 발사 준비 징후가 확인됩니다. TEL 직립 및 연료주입이 진행 중이며, 과거 유사 패턴 분석 결과 30분 내 발사 가능성이 높습니다.'
          : '적 IADS 서부 방공망 분석 완료. SA-5 2개 대대와 P-14 감시레이더가 핵심 위협입니다. SEAD 작전을 통한 순차적 무력화를 권고합니다.',
        threatAssessment: activeScenario === 'scenario-a'
          ? '화성-17형 ICBM 발사 준비 단계 진입. 액체연료 주입 완료 시 2시간 내 발사 창 개방.'
          : '서부 방공망 SA-5의 유효사거리 250km로 아군 항공자산 진입 불가. 레이더-지휘소-발사대 순 제거 필요.',
        confidence: 85,
        launchProbability: activeScenario === 'scenario-a' ? 78 : undefined,
        recommendations: activeScenario === 'scenario-a'
          ? ['정찰자산 추가 투입 (백두 긴급 출격)', '현무-4 타격 준비태세 격상', '한미 정보공유 체계 활성화']
          : ['KF-16 HARM 선제투사로 레이더 무력화', '현무-2A로 지휘소 동시 타격', 'F-15K 후속 타격으로 SA-5 진지 파괴'],
        historicalCases: [
          {
            id: 'case-4',
            date: '2022-03-24',
            title: '화성-17형 ICBM 발사',
            missileType: 'ICBM (화성-17)',
            indicators: ['11축 TEL 이동', '대형 발사대 직립', '연료주입'],
            outcome: '발사 성공, 비행시간 71분, 고도 6,248km',
            description: '',
            similarity: 0.87,
          },
          {
            id: 'case-3',
            date: '2017-11-29',
            title: '화성-15형 ICBM 발사',
            missileType: 'ICBM (화성-15)',
            indicators: ['대형 TEL 이동', '연료주입', '발사대 직립'],
            outcome: '발사 성공, 비행거리 960km, 고도 4,475km',
            description: '',
            similarity: 0.72,
          },
        ],
      });
      setShowBriefingModal(true);
    } finally {
      setIsLoadingBriefing(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col">
      {/* Top Bar */}
      <header className="h-10 bg-[#0d1117] border-b border-gray-800 flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-gray-200 tracking-wide">
            <span className="text-amber-400">NL</span>-COP
          </h1>
          <span className="text-[10px] text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">
            다중출처 융합 지휘통제
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            SYSTEM ONLINE
          </span>
          <span>{new Date().toLocaleTimeString('ko-KR')}</span>
        </div>
      </header>

      {/* Main Content: 3 panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Enemy Info */}
        <div className="w-[20%] min-w-[240px]">
          <EnemyPanel
            threats={scenario.threats}
            events={scenario.timeline}
            currentTime={currentTime}
            threatLevel={getCurrentThreatLevel()}
            destroyedAssets={destroyedAssets}
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
          <FriendlyPanel
            friendlies={scenario.friendlies}
            briefing={briefing}
            onRequestBriefing={handleRequestBriefing}
            isLoadingBriefing={isLoadingBriefing}
            inferenceResult={inferenceResult}
          />
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

      {/* Briefing Modal */}
      {showBriefingModal && briefing && (
        <BriefingModal
          briefing={briefing}
          onClose={() => setShowBriefingModal(false)}
        />
      )}
    </div>
  );
}
