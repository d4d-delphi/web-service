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

  // Both scenarios are launch-indicator timelines (no strike/destruction phase)
  useEffect(() => {
    setDestroyedAssets([]);
  }, [activeScenario]);

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
          ? '동창리 서해위성발사장에서 액체연료 우주발사체(정찰위성) 발사 징후가 확인됩니다. 일본 JCG 낙탄구역 통보, 필리핀 방향 남향 궤적, 발사장 인근 바지선 밀착 정박(Rule#1)이 모두 충족되어 위성 발사로 판단됩니다.'
          : '전방 진지에서 고체연료 단거리 탄도미사일(KN-23) 발사 징후가 확인됩니다. TEL 단독 기동, 알섬 방향 궤적, 신포 차량 집결·국제 통보 부재(Rule#4)로 고체 SRBM 기습 발사로 판단됩니다.',
        threatAssessment: activeScenario === 'scenario-a'
          ? '함흥 UDMH·만포 산화제 생산 → 트레일러 기동 → 국제 통보 → 바지선 밀착 순으로 진행. VIP 전용열차 소실 및 A2/AD 가동 확인. H-0 발사 임박(100%).'
          : '함흥 17/11호 고체 생산 → TEL 단독 기동 → 전용열차 소실 순으로 진행. 고체연료 특성상 즉시 발사 가능하여 사전 경고 시간 극히 제한적.',
        confidence: 92,
        launchProbability: activeScenario === 'scenario-a' ? 100 : 95,
        recommendations: activeScenario === 'scenario-a'
          ? ['E-737 피스아이 상시 체공 및 발사 즉시 항적 Custody 유지', '777사령부 텔레메트리 수신 태세 격상', '한미일 정보공유(SIS) 및 낙탄구역 항행 경보 확인']
          : ['그린파인 레이더 KAMD 경계태세 격상', '헤론 UAV로 전방 TEL 상시 추적', '현무 대응타격 준비태세 유지 및 한미 공동 감시'],
        historicalCases: [
          {
            id: 'case-slv',
            date: '2023-11-21',
            title: '만리경-1 정찰위성 발사',
            missileType: '우주발사체 (천리마-1)',
            indicators: ['동창리 발사대', '일본 통보', '바지선 밀착', '남향 궤적'],
            outcome: '위성 궤도 진입 성공, 필리핀 동방 해상 낙탄',
            description: '',
            similarity: activeScenario === 'scenario-a' ? 0.91 : 0.32,
          },
          {
            id: 'case-kn23',
            date: '2022-01-14',
            title: 'KN-23 전술유도무기 발사',
            missileType: 'SRBM (KN-23)',
            indicators: ['TEL 단독 기동', '알섬 표적', '고체연료', '기습 발사'],
            outcome: '비행거리 430km, 저고도 풀업 기동',
            description: '',
            similarity: activeScenario === 'scenario-a' ? 0.28 : 0.88,
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
