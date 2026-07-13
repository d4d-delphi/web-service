'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import EnemyPanel from '@/components/EnemyPanel';
import FriendlyPanel from '@/components/FriendlyPanel';
import ChatPanel from '@/components/ChatPanel';
import Timeline from '@/components/Timeline';
import EventModal from '@/components/EventModal';
import LaunchSpecModal from '@/components/LaunchSpecModal';
import { Scenario, ScenarioId, ScenarioPhase, InferenceResult, TimelineEvent } from '@/types';
import { runInference } from '@/lib/bayesian';
import { runBackendInference, scenarioToCampaign, latestObservationAt, backendEnabled } from '@/lib/inference_client';
import { custodyState } from '@/lib/custody';
import { structureReport } from '@/lib/spuq';
import hypothesesData from '@/data/hypotheses.json';
import scenarioAData from '@/data/scenario-a.json';
import scenarioBData from '@/data/scenario-b.json';
import phasesSolidLong from '@/data/phases-solid-long.json';
import phasesLiquidLong from '@/data/phases-liquid-long.json';
import phasesLiquidShort from '@/data/phases-liquid-short.json';

// Client-only + code-split: Cesium (and all of CesiumMap's entity/drawing code)
// leaves the initial page bundle and is fetched as a separate chunk after
// hydration. The `loading` fallback paints the map shell immediately instead of
// a blank gap while that chunk + the Cesium engine stream in.
const CesiumMap = dynamic(() => import('@/components/CesiumMap'), {
  ssr: false,
  loading: () => (
    <div className="relative w-full h-full flex items-center justify-center bg-[#0a0e1a]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2" />
        <p className="text-gray-400 text-sm">지도 로딩 중...</p>
      </div>
    </div>
  ),
});

// 징후 기반 페이싱: 각 Phase의 핵심 징후(대표 이벤트)에 도달하면 관측자가
// 충분히 인지할 때까지 해당 시점을 유지한다. "재생 속도"가 아니라
// "핵심 징후 도달 + 최소 체류"가 다음 Phase 진행 조건.
//  - SIGNATURE_DWELL_MS: 일반 징후 관측 체류(모달 3s + 여유)
//  - LAUNCH_DWELL_MS   : 발사/타격 징후 강조 체류
// 페이싱이 너무 빠르다는 피드백 반영 — 체류 시간 대폭 확대, 틱당 진행 보폭 축소.
const SIGNATURE_DWELL_MS = 9000;
const LAUNCH_DWELL_MS = 14000;
// 재생 틱당 관측 시각 진행 보폭(기본 배속 기준). 작을수록 전반적 재생이 느려짐.
const PLAYBACK_STEP_BASE = 7;
// H-0 발사 확인 배너/제원 모달을 띄우기 위한 발사 임박도(p_launch) 하한.
// H-0 시각(발사 관측)에 도달했더라도 추론이 실제 발사를 확증(≥90%)해야 배너를
// 띄운다 — 시점과 게이지가 항상 정합하도록 보장(35%인데 H-0 뜨는 모순 방지).
const LAUNCH_CONFIRM_PLAUNCH = 0.9;

export default function Home() {
  // 페이지 진입 시에는 어떤 시나리오도 자동 로드하지 않는다(랜딩 상태). 사용자가 상단
  // 발사체 버튼을 눌러야만 'scenario-a' 가 활성화되어 지도/패널이 마운트된다.
  const [activeScenario, setActiveScenario] = useState<ScenarioId | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [enemyOpen, setEnemyOpen] = useState(true);
  const [friendlyOpen, setFriendlyOpen] = useState(true);
  // 채팅 활성 여부 — ChatPanel 이 메시지/로딩 시 상위로 알림. 활성 시 채팅 패널이 위로 확장.
  const [chatActive, setChatActive] = useState(false);
  const [speed, setSpeed] = useState(1); // 재생 배속 (1x 기본 / 5x 빨리감기)
  const [destroyedAssets, setDestroyedAssets] = useState<string[]>([]);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // 현재 Phase의 핵심 징후(gate) 도달 시점 추적. dwell 체류 판정에 사용.
  const holdRef = useRef<{ phaseId: number; reachedAt: number } | null>(null);
  // 전체 화면 캡처(📷): 앱 루트 요소 + Cesium 캡처 함수를 보관.
  const rootRef = useRef<HTMLDivElement>(null);
  const captureFnRef = useRef<(() => string | null) | null>(null);

  // 각 이벤트가 "발생"하는 순간(재생 시각이 timestamp를 넘을 때) 상단에 모달을 띄우고
  // 3초 후 자동으로 감춘다.
  const [modalEvent, setModalEvent] = useState<TimelineEvent | null>(null);
  const shownEventIdsRef = useRef<Set<string>>(new Set());
  const modalTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 발사(H-0) 확인 순간 짧게 띄우는 화면전환 배너.
  const [showLaunchBanner, setShowLaunchBanner] = useState(false);
  const launchFiredRef = useRef(false);
  const bannerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 발사(H-0) 확인 시 지도 위에 발사체 제원을 모달로 노출. 닫기 전까지 유지되며
  // H-0 이전으로 되감거나 시나리오를 바꾸면 해제된다.
  const [showSpecModal, setShowSpecModal] = useState(false);

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

  // null-safety: 구 ternary(activeScenario === 'scenario-a' ? A : B)는 null 일 때 else 로
  // 빠져 scenarioBData 가 잘못 선택되므로 가드한다. scenario-b 일 때만 scenarioBData,
  // 그 외(null·'scenario-a')는 scenarioAData. 파생 훅(scenario useMemo 등)이 항상 유효한
  // Scenario 를 받도록 보장 — 랜딩 상태에서는 이 데이터가 렌더링에 쓰이지 않는다.
  const scenarioBase: Scenario = (activeScenario === 'scenario-b' ? scenarioBData : scenarioAData) as Scenario;

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

    // 각 단계 구간 [startTime, endTime) 의 '첫' 실제 관측 위치로 cameraTarget 을
    // 갱신한다. (평균 중심점을 쓰면 여러 관측이 흩어진 구간에서 카메라가 어느
    // 노란 점에도 얹히지 않고 그 사이 허공을 비추므로, 구간 진입 시 활성화되는
    // 첫 관측 지점에 맞춘다.) 구간에 관측이 없으면 기존(mock) 목표점을 유지한다.
    const phases: ScenarioPhase[] = scenarioBase.phases.map((phase) => {
      const inWindow = timeline.filter(
        (e) => e.position && e.timestamp >= phase.startTime && e.timestamp < phase.endTime,
      );
      if (inWindow.length === 0) return phase;
      const first = inWindow[0].position!;
      return {
        ...phase,
        cameraTarget: { lat: first.lat, lng: first.lng, range: phase.cameraTarget?.range ?? 400000 },
      };
    });

    return { ...scenarioBase, timeline, phases };
  }, [supabaseEvents, scenarioBase]);

  // 징후 기반 페이싱을 위한 Phase별 핵심 징후(gate) 식별.
  // 각 Phase 구간 [startTime, endTime) 내에서 가장 의미있는 관측 1건을 대표 징후로
  // 삼는다. 우선순위: 발사/타격 > 위협등급(threatLevel) > 가장 늦은 시각.
  // 관측이 없는 Phase(예: Supabase 미연동 시 scenario-a)는 구간 종료 직전 시점을
  // gate로 삼아 최소 체류만 보장한다.
  const phaseGate = useMemo(() => {
    const map = new Map<number, { ts: number; eventId?: string; isLaunch: boolean }>();
    for (const phase of scenario.phases) {
      const inWindow = scenario.timeline.filter(
        (e) => e.timestamp >= phase.startTime && e.timestamp < phase.endTime,
      );
      const score = (e: TimelineEvent) =>
        e.type === 'launch' || e.type === 'strike' ? 1000 : e.threatLevel ?? 0;
      let sig: TimelineEvent | undefined;
      if (inWindow.length > 0) {
        sig = inWindow.reduce((best, e) => {
          if (score(e) !== score(best)) return score(e) > score(best) ? e : best;
          return e.timestamp >= best.timestamp ? e : best;
        });
      }
      const isLaunch = sig?.type === 'launch' || sig?.type === 'strike';
      const ts = sig ? sig.timestamp : Math.max(phase.endTime - 1, phase.startTime);
      map.set(phase.id, { ts, eventId: sig?.id, isLaunch });
    }
    return map;
  }, [scenario]);

  // Playback logic — 징후 기반 페이싱
  // 시간은 계속 흐르지만, 현재 Phase의 핵심 징후(gate) 시점에 도달하면
  // 관측자가 인지할 수 있도록 최소 체류(dwell) 시간 동안 해당 시점에 머문다.
  // 체류가 끝나야 다음 Phase로 넘어간다 = "단순 시간 경과가 아닌 징후 도달 기반 진행".
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          let next = prev + PLAYBACK_STEP_BASE * speed; // 기본 배속 × (빨리감기 시 5)
          const phase = scenario.phases.find((p) => prev >= p.startTime && prev < p.endTime);
          // 빨리감기(speed > 1)에서는 징후 게이트 체류를 건너뛴다 — 게이트마다
          // 멈추면 빨리감기의 목적(빠른 훑기)이 사라지므로, 1x 재생에서만 dwell 적용.
          if (phase && speed === 1) {
            const gate = phaseGate.get(phase.id);
            if (gate && next > gate.ts) {
              if (!holdRef.current || holdRef.current.phaseId !== phase.id) {
                holdRef.current = { phaseId: phase.id, reachedAt: Date.now() };
              }
              const dwell = gate.isLaunch ? LAUNCH_DWELL_MS : SIGNATURE_DWELL_MS;
              if (Date.now() - holdRef.current.reachedAt < dwell) {
                // 핵심 징후 관측 시점에서 대기. 다음 Phase 진행은 dwell 완료 후.
                next = gate.ts;
              }
            }
          }
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
  }, [isPlaying, scenario.duration, scenario.phases, phaseGate, speed]);

  // Run inference — DELPHI 백엔드 우선, fallback: 프론트 Bayesian
  const lastVisibleEventIdsRef = useRef<string>('');
  const structuredActionsCacheRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    // 랜딩 상태(activeScenario === null)에서는 추론을 실행하지 않는다.
    // 아래 scenarioToCampaign(activeScenario) 가 null 을 받지 않도록 가드.
    if (activeScenario === null) {
      setInferenceResult(null);
      lastVisibleEventIdsRef.current = '';
      return;
    }
    const visibleEvents = scenario.timeline.filter((e) => e.timestamp <= currentTime);
    if (visibleEvents.length === 0) {
      setInferenceResult(null);
      lastVisibleEventIdsRef.current = '';
      return;
    }

    const currentEventIds = visibleEvents.map((e) => e.id).join(',');
    if (currentEventIds === lastVisibleEventIdsRef.current) {
      return; // No new events, skip heavy calculations
    }
    lastVisibleEventIdsRef.current = currentEventIds;

    // 이벤트를 액션 클래스로 정형화 (캐시 활용하여 연산량 최소화)
    const actions = visibleEvents.map((event, i) => {
      const cacheId = event.id || `event-${i}`;
      if (structuredActionsCacheRef.current.has(cacheId))
        return structuredActionsCacheRef.current.get(cacheId);
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

    // 추론: 백엔드(deciban 엔진) 우선 → bayesian 데모 폴백
    (async () => {
      const campaignId = scenarioToCampaign(activeScenario);
      const atISO = latestObservationAt(scenario.timeline, currentTime);
      const backend = campaignId && atISO ? await runBackendInference(campaignId, atISO) : null;
      setInferenceResult(backend ?? runInference(actions, hypothesesData as any));
    })();
  }, [currentTime, scenario.timeline, activeScenario]);

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
    // 시나리오 전환 시 적 정보 패널 자동 표시.
    setEnemyOpen(true);
    // 페이싱 게이트 상태 초기화 (이전 시나리오의 dwell 잔류 방지).
    holdRef.current = null;
  };

  const handlePhaseClick = (phase: ScenarioPhase) => {
    setCurrentTime(phase.startTime);
    // 수동 Phase 이동 시 페이싱 게이트 재평가.
    holdRef.current = null;
  };

  // 재생 배속 선택 (1×/3×/5×/10×). 구 빨리감기 토글(1→5→20→1 순환)을 대체하며,
  // 배속만 변경하고 자동 재생은 시작하지 않는다.
  const handleSpeedChange = (s: number) => {
    setSpeed(s);
  };

  // Phase description 에서 D-day 구간 라벨 추출 (Timeline.phaseDday 와 동일 정규식).
  // 캡처 파일명에 단계별 D-day 를 포함하기 위해 사용.
  function capturePhaseDday(description: string): string | null {
    const m = description.match(/([DH][+\-]\d+(?:\s*~\s*[DH]?[+\-]?\d+)?)/);
    return m ? m[1].replace(/\s+/g, '') : null;
  }

  // 전체 화면 캡처(📷): Cesium WebGL 지도 + DOM(패널/타임라인/범례) 을 합성한 PNG 다운로드.
  //  (a) CesiumMap 이 노출한 캡처 함수로 WebGL → dataURL 획득
  //  (b) html2canvas 로 DOM 렌더 (지도 영역은 빈 캔버스)
  //  (c) 두 결과를 canvas 에 합성 — DOM 위에 지도를 map container 의 boundingRect 위치에 덮어쓰기
  //  (d) PNG 다운로드 (파일명: delphi-<phase>-<D-day>.png)
  // Fallback: html2canvas 실패 시 Cesium 캔버스만 + 캡션(단계/D-day/p_launch) 을 그려 저장.
  const handleCapture = async () => {
    if (!rootRef.current) return;
    const root = rootRef.current;

    const phase = scenario.phases.find(
      (p) => currentTime >= p.startTime && currentTime < p.endTime,
    );
    const phaseLabel = phase?.name ?? 'phase';
    const dday = capturePhaseDday(phase?.description ?? '');
    const pLaunch = Math.round((inferenceResult?.overallConfidence ?? 0) * 100);

    const safe = (s: string) => s.replace(/[·/\s~]/g, '-');
    const filename = `delphi-${safe(phaseLabel)}${dday ? '-' + dday : ''}.png`;

    // (a) Cesium WebGL 캔버스 → dataURL (preserveDrawingBuffer: true 필수)
    const mapDataUrl = captureFnRef.current?.() ?? null;

    let canvas: HTMLCanvasElement;

    try {
      const { default: html2canvas } = await import('html2canvas');

      // (b) DOM → canvas. WebGL 캔버스(Cesium)는 빈 영역으로 렌더링됨.
      const domCanvas = await html2canvas(root, {
        backgroundColor: '#0a0e1a',
        useCORS: true,
        scale: window.devicePixelRatio || 1,
      });

      // (c) 합성 캔버스 생성
      canvas = document.createElement('canvas');
      canvas.width = domCanvas.width;
      canvas.height = domCanvas.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(domCanvas, 0, 0);

      // 지도 컨테이너 위치에 Cesium 캔버스 픽셀을 덮어쓰기
      const mapContainer = root.querySelector('[data-capture-map]') as HTMLElement | null;
      if (mapDataUrl && mapContainer) {
        const mapImg = new Image();
        await new Promise<void>((resolve) => {
          mapImg.onload = () => resolve();
          mapImg.onerror = () => resolve();
          mapImg.src = mapDataUrl;
        });
        if (mapImg.width > 0 && mapImg.height > 0) {
          const rootRect = root.getBoundingClientRect();
          const mapRect = mapContainer.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          ctx.drawImage(
            mapImg,
            (mapRect.left - rootRect.left) * dpr,
            (mapRect.top - rootRect.top) * dpr,
            mapRect.width * dpr,
            mapRect.height * dpr,
          );
        }
      }
    } catch (err) {
      // Fallback: html2canvas 실패 시 Cesium 캔버스만 캡처 + 캡션.
      console.warn('Capture composite failed — falling back to map-only:', err);
      if (!mapDataUrl) return;
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = mapDataUrl;
      });
      canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height + 60;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(
        `DELPHI — ${phaseLabel} (${dday ?? '—'}) · p_launch ${pLaunch}%`,
        12,
        img.height + 36,
      );
    }

    // (d) PNG 다운로드
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  // AI Copilot에 넘길 현재 상황 요약. 추론 결과·시나리오·경과 시간을 압축한다.
  const chatContext = useMemo(() => {
    // 랜딩 상태(activeScenario === null) — 시나리오 컨텍스트 대신 중립 프롬프트.
    if (activeScenario === null) {
      return '재생할 시나리오를 선택하세요.';
    }
    const scenarioLabel =
      activeScenario === 'scenario-a'
        ? '우주발사체(정찰위성) 발사 징후 — 동창리'
        : '고체연료 단거리(SRBM) 발사 징후 — 알섬 표적';
    const lines = [
      `시나리오: ${scenarioLabel}`,
      `경과 시간: ${Math.floor(currentTime / 60)}분`,
    ];
    if (backendEnabled()) lines.push(`데이터 소스: DELPHI 백엔드 (캠페인: ${scenarioToCampaign(activeScenario) ?? 'N/A'})`);
    if (inferenceResult?.topHypothesis) {
      const t = inferenceResult.topHypothesis;
      lines.push(
        `최고 가설: ${t.name} (확률 ${(t.posterior * 100).toFixed(0)}%, 불확실성 ${((t.uncertainty ?? 0) * 100).toFixed(0)}%)`,
        `증거 수: ${inferenceResult.evidenceCount}`,
        `상위 가설: ${inferenceResult.hypotheses
          .slice(0, 3)
          .map((h) => `${h.name} ${(h.posterior * 100).toFixed(0)}%`)
          .join(', ')}`,
      );
      if (backendEnabled()) lines.push(`발사 임박도(p_launch): ${(inferenceResult.overallConfidence * 100).toFixed(0)}%`);
    } else {
      lines.push('아직 유효한 관측/추론 결과 없음 (타임라인 재생 전).');
    }
    return lines.join('\n');
  }, [activeScenario, currentTime, inferenceResult]);

  // 발사(H-0) 도달 여부. H-0 = 실제 발사 관측 시각. launch 없는 시나리오는 null.
  const custody = useMemo(() => custodyState(scenario, currentTime), [scenario, currentTime]);
  const inCustody = !!custody?.active;

  // 발사 확증: H-0 시각에 도달했고 + 발사 임박도(p_launch)가 하한을 넘겼을 때만.
  // 추론(비동기)이 게이지를 실제로 끌어올린 뒤 배너가 뜨므로, 배너와 p_launch가
  // 항상 정합한다.
  const pLaunch = inferenceResult?.overallConfidence ?? 0;
  const launchConfirmed = inCustody && pLaunch >= LAUNCH_CONFIRM_PLAUNCH;

  // 발사가 확증된 순간 발사 확인 배너를 2.6초간 띄운다. 되감아 H-0 이전으로
  // 돌아가면(=inCustody 해제) 리셋해 다시 발사할 때 또 발동하도록 한다.
  useEffect(() => {
    if (launchConfirmed && !launchFiredRef.current) {
      launchFiredRef.current = true;
      setShowLaunchBanner(true);
      setShowSpecModal(true);
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
      bannerTimeoutRef.current = setTimeout(() => setShowLaunchBanner(false), 2600);
    } else if (!inCustody && launchFiredRef.current) {
      launchFiredRef.current = false;
      setShowLaunchBanner(false);
      setShowSpecModal(false);
    }
  }, [launchConfirmed, inCustody]);

  // 시나리오 전환 시 커스터디/배너 상태 초기화.
  useEffect(() => {
    launchFiredRef.current = false;
    setShowLaunchBanner(false);
    setShowSpecModal(false);
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
  }, [activeScenario]);

  return (
    <div ref={rootRef} className="relative h-screen w-screen flex flex-col bg-[#0a0e1a]">
      {/* 이벤트 발생 알림 모달 (3초 후 자동 종료). key로 이벤트마다 재진입 애니메이션 */}
      <EventModal key={modalEvent?.id} event={modalEvent} onClose={() => setModalEvent(null)} />

      {/* 상단 시나리오 선택 바 — 랜딩/재생 상태 모두 항상 표시. 발사체만 구현(active). */}
      <ScenarioTopBar activeScenario={activeScenario} onSelect={handleScenarioChange} />

      {activeScenario === null ? (
        /* 랜딩 상태: 시나리오 미선택. NL-COP 워드마크 + 시나리오 선택 카드. */
        <div className="flex-1 flex flex-col items-center justify-center select-none relative overflow-hidden">
          {/* 미세 그리드 배경 (외부 이미지 없이 CSS) */}
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
          {/* 중앙 어닝 비네팅 */}
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(10,14,26,0.95)_80%)]" />

          {/* 콘텐츠 */}
          <div className="relative z-10 text-center px-6">
            {/* NL-COP 워드마크 */}
            <h1 className="text-6xl font-black tracking-[0.18em] text-gray-100 [text-shadow:0_0_32px_rgba(59,130,246,0.25)]">
              NL-COP
            </h1>
            <div className="mt-1 text-amber-400/50 text-[10px] font-mono tracking-[0.32em] uppercase">
              Natural Language Common Operating Picture
            </div>
            <p className="mt-4 text-gray-400 text-sm break-keep">
              다출처 첩보 융합 · 자연어 보고 · 실시간 발사 징후 분석
            </p>

            {/* 시나리오 선택 카드 */}
            <div className="mt-10 mx-auto max-w-lg">
              <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest mb-3 text-left px-1">
                시나리오 선택
              </p>
              <div className="rounded-lg border border-gray-700/50 bg-[#0d1117]/80 backdrop-blur-sm p-4 shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
                {/* 발사체 (동창리) — 유일하게 구현됨 */}
                <button
                  onClick={() => handleScenarioChange('scenario-a')}
                  className="w-full p-3.5 rounded-md border border-amber-600/40 bg-amber-950/20 hover:bg-amber-900/30 hover:border-amber-500/60 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2L8 8h3v6h2V8h3l-4-6zm-7 14v6h14v-6c0-2-1-4-3-5l-2 2c1 1 2 2 2 3H7c0-1 1-2 2-3l-2-2c-2 1-3 3-3 5z" />
                        </svg>
                        <span className="text-amber-300 font-bold text-sm">발사체 (동창리)</span>
                        <span className="text-[8px] text-amber-500/70 px-1 py-0.5 rounded border border-amber-700/40 font-mono">ACTIVE</span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500 break-keep">
                        천리마-1형 · 만리경-1호 정찰위성 발사 징후 — D-90 부터 D+1 까지
                      </p>
                    </div>
                    <span className="text-amber-500 text-xs font-mono group-hover:translate-x-0.5 transition-transform shrink-0 ml-2">▶</span>
                  </div>
                </button>

                {/* 미구현 placeholder 그리드 */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {['SRBM', '전시 SEAD/BDA', '해상', '공중', '사이버', '사이버(2)'].slice(0, 5).map((label) => (
                    <div
                      key={label}
                      className="p-2.5 rounded-md border border-gray-800/70 bg-gray-900/20 flex flex-col items-center gap-0.5"
                    >
                      <span className="text-[11px] text-gray-600 font-mono">{label}</span>
                      <span className="text-[8px] text-gray-700 px-1 rounded border border-gray-800 font-mono">미구현</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* Main Content: 3 panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Enemy Info */}
        <div className={`transition-all duration-300 ${enemyOpen ? 'w-[20%] min-w-[240px]' : 'w-10'} flex flex-col`}>
          {/* Collapse toggle */}
          <button
            onClick={() => setEnemyOpen((v) => !v)}
            className="shrink-0 h-8 flex items-center justify-center bg-gray-900 border-b border-r border-gray-800 text-gray-500 hover:text-gray-200 transition-colors z-10"
            aria-label={enemyOpen ? '적 정보 패널 닫기' : '적 정보 패널 열기'}
          >
            {enemyOpen ? '‹' : '›'}
          </button>
          {enemyOpen ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0">
                <EnemyPanel
                  events={scenario.timeline}
                  currentTime={currentTime}
                  inferenceResult={inferenceResult}
                  viewMode="enemy"
                  scenarios={[
                    { id: 'h-solid-short',  name: '고체 단거리 (SRBM)',       phases: scenarioBData.phases as any },
                    { id: 'h-solid-long',   name: '고체 장거리 (IRBM/ICBM)', phases: phasesSolidLong as any },
                    { id: 'h-liquid-long',  name: '액체 장거리 (ICBM/IRBM)', phases: phasesLiquidLong as any },
                    { id: 'h-liquid-short', name: '액체 단거리 (SCUD/노동)',  phases: phasesLiquidShort as any },
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[#0d1117] border-r border-gray-800/50">
              <span className="text-[10px] text-gray-600 font-mono [writing-mode:vertical-rl] tracking-widest">적 정보</span>
            </div>
          )}
        </div>

        {/* Center - Map */}
        <div className="flex-1 relative">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
            <SimClock timeline={scenario.timeline} currentTime={currentTime} speed={speed} isPlaying={isPlaying} />
          </div>
          <CesiumMap
            scenario={scenario}
            currentTime={currentTime}
            destroyedAssets={destroyedAssets}
            custody={null}
            onCaptureReady={(fn) => { captureFnRef.current = fn; }}
          />
          {/* 발사 확인 시 지도 위에 발사체 제원 모달 (하단바는 변경 없음) */}
          {showSpecModal && scenario.launch && (
            <LaunchSpecModal launch={scenario.launch} onClose={() => setShowSpecModal(false)} />
          )}
          {/* 지도 범례 */}
          <MapLegend />
        </div>

        {/* Right Panel - Friendly Info */}
        <div className={`transition-all duration-300 ${friendlyOpen ? 'w-[20%] min-w-[240px]' : 'w-10'} flex flex-col`}>
          {/* Collapse toggle */}
          <button
            onClick={() => setFriendlyOpen((v) => !v)}
            className="shrink-0 h-8 flex items-center justify-center bg-gray-900 border-b border-l border-gray-800 text-gray-500 hover:text-gray-200 transition-colors z-10"
            aria-label={friendlyOpen ? '아군 정보 패널 닫기' : '아군 정보 패널 열기'}
          >
            {friendlyOpen ? '›' : '‹'}
          </button>
          {friendlyOpen ? (
            <div className="flex-1 min-h-0 flex flex-col">
              {/* 상단: 우측 패널 SitRep — 위협게이지/가용자산/최근징후/대응옵션 스크롤 */}
              {/* 채팅 활성 시 FriendlyPanel 비중 축소 — ChatPanel 이 위로 확장 */}
              <div
                className="min-h-0 overflow-hidden transition-all duration-300"
                style={{ flex: chatActive ? 2 : 3 }}
              >
                <FriendlyPanel
                  friendlies={scenario.friendlies}
                  events={scenario.timeline}
                  currentTime={currentTime}
                  inferenceResult={inferenceResult}
                />
              </div>
              {/* 하단: AI Copilot 채팅 — 대화 시 위로 확장(flex 증가) */}
              <div
                className="min-h-0 transition-all duration-300"
                style={{ flex: chatActive ? 4 : 2 }}
              >
                <ChatPanel context={chatContext} onActiveChange={setChatActive} onCollapse={() => setChatActive(false)} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[#0d1117] border-l border-blue-900/30">
              <span className="text-[10px] text-gray-600 font-mono [writing-mode:vertical-rl] tracking-widest">아군 정보</span>
            </div>
          )}
        </div>
      </div>

      {/* 하단 스트립: 발사 여부와 무관하게 타임라인을 유지한다 (발사 시 하단바 변경 없음) */}
      <Timeline
        phases={scenario.phases}
        currentTime={currentTime}
        duration={scenario.duration}
        isPlaying={isPlaying}
        speed={speed}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onSpeedChange={handleSpeedChange}
        onPhaseClick={handlePhaseClick}
        onScenarioChange={handleScenarioChange}
        activeScenario={activeScenario}
        onCapture={handleCapture}
      />

      {/* 발사 확인 화면전환 배너 (2.6초) */}
      {showLaunchBanner && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-red-950/30 animate-pulse" />
          <div className="relative text-center animate-[custodyIn_0.5s_ease-out]">
            <div className="text-red-500 text-5xl font-black tracking-[0.3em] [text-shadow:0_0_24px_rgba(239,68,68,0.7)]">
              H-0
            </div>
            <div className="mt-2 text-amber-300 text-lg font-bold tracking-widest [text-shadow:0_0_12px_rgba(251,191,36,0.6)]">
              [ LAUNCH ] 미사일 발사 확인
            </div>
            <div className="mt-1 text-amber-200/60 text-xs font-mono">발사 순간 포착 — H-0 도달</div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

// 상단 시나리오 선택 바. 발사체(동창리)만 구현(active)되어 있고, 나머지 도메인은
// 미구현 placeholder — 클릭해도 상태가 변하지 않는다.
function ScenarioTopBar({
  activeScenario,
  onSelect,
}: {
  activeScenario: ScenarioId | null;
  onSelect: (id: ScenarioId) => void;
}) {
  // SRBM / 전시 SEAD·BDA / 해상 / 공중 / 사이버 — 향후 확장용 미구현 항목.
  const placeholders = ['SRBM', '전시 SEAD/BDA', '해상', '공중', '사이버'];
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-[#0d1117] border-b border-gray-800">
      {/* 발사체(동창리) — 현재 유일하게 구현된 시나리오. 활성 시 amber 액센트 +
          펄스 도트로 현재 선택됨을 명확히 표시. */}
      <button
        onClick={() => onSelect('scenario-a')}
        title="우주발사체(정찰위성) 발사 징후 — 동창리"
        className={`h-7 px-3 flex items-center gap-1.5 rounded border text-xs font-mono font-bold transition-all ${
          activeScenario === 'scenario-a'
            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.2)]'
            : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
        }`}
      >
        {activeScenario === 'scenario-a' && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
        )}
        발사체 (동창리)
      </button>
      {/* 미구현 시나리오 — 비활성 placeholder. "미구현" 배지로 disabled 상태 명시. */}
      {placeholders.map((label) => (
        <button
          key={label}
          disabled
          title="미구현"
          className="h-7 px-2.5 flex items-center gap-1 rounded border text-xs font-mono bg-gray-800/40 border-gray-800 text-gray-600 cursor-not-allowed"
        >
          {label}
          <span className="text-[7px] text-gray-700 px-0.5 py-px rounded border border-gray-800 font-mono leading-none">
            미구현
          </span>
        </button>
      ))}
    </div>
  );
}

function MapLegend() {
  return (
    <div className="absolute bottom-4 left-3 z-10 pointer-events-none">
      <div className="bg-[#0a0e1a]/85 backdrop-blur-sm border border-gray-700/60 rounded-md px-4 py-3.5 min-w-[185px]">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2.5">범례</p>

        {/* 마커 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
            <span className="text-xs text-gray-300">적 미사일 시설</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-orange-400 shrink-0" />
            <span className="text-xs text-gray-300">이동식 발사대 (TEL)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-400 shrink-0" />
            <span className="text-xs text-gray-300">방공망 (SAM)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
            <span className="text-xs text-gray-300">아군 감시자산</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-cyan-400 shrink-0" />
            <span className="text-xs text-gray-300">아군 지휘통제</span>
          </div>

          {/* 구분선 */}
          <div className="border-t border-gray-700/60 my-0.5" />

          {/* 선 범례 */}
          <div className="flex items-center gap-2">
            <svg width="20" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 2" />
            </svg>
            <span className="text-xs text-gray-300">발사 궤적</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2" />
            </svg>
            <span className="text-xs text-gray-300">의심 이동경로</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
            <span className="text-xs text-gray-300">아군 작전반경</span>
          </div>

          {/* 구분선 */}
          <div className="border-t border-gray-700/60 my-0.5" />

          <div className="flex items-center gap-2">
            <span className="text-red-400 text-xs leading-none shrink-0">▲</span>
            <span className="text-xs text-gray-300">경계/위험 징후</span>
          </div>
        </div>
      </div>
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
