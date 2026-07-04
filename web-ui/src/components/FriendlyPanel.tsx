'use client';

import { useMemo } from 'react';
import type {
  FriendlyAsset,
  TimelineEvent,
  InferenceResult,
} from '@/types';
// 교리 온톨로지(공개 교리 개념만, illustrative) — 서버 fs 없이 클라이언트에서 직접 읽는다.
import doctrineMirror from '@/data/doctrine-ontology.json';
// 아군(Blue) 전투서열 자산 — /api/blue 의 평면 미러. 우측 패널 자산 표시의 source of truth.
import blueUnits from '@/data/friendly-units.json';

// ============================================================
// 우측 패널 SitRep (타이틀 라인 제거됨)
// 4개 섹션: 위협 게이지 / 가용 자산 / 최근 탐지 징후 / 대응 옵션
//
// "안 뜨던 UI" 원인: 과거 우측 패널은 FriendlyPanel(가용자산만) + ChatPanel 이
// 50:50 로 분할되고 FriendlyPanel 래퍼가 overflow-hidden 이었음. 관측 피드·대응옵션
// 섹션이 컴포넌트에 추가되어도 (a) 컴포넌트 자체에 해당 섹션이 렌더되지 않았고,
// (b) 추가되더라도 h-1/2 overflow-hidden 컨테이너에 의해 잘려 보이지 않음.
// 본 재설계: 패널 내부를 단일 스크롤 컨테이너로 구성해 4섹션이 모두 노출되도록 함.
// ============================================================

interface FriendlyPanelProps {
  friendlies: FriendlyAsset[];
  events?: TimelineEvent[];
  currentTime?: number;
  inferenceResult?: InferenceResult | null;
}

// --- doctrine 미러 타입 (lib/doctrine.ts 의 서버 타입과 동일 형상) ---
type Pillar = 'kamd' | 'kmpr' | 'lamd';
interface ResponseOptionMirror {
  optionId: string;
  pillar: Pillar;
  pillarName: string;
  asset: string;
  triggerPhase: string | null;
  authorityThreshold: string | null;
  priority: number | null;
  description: string | null;
}
interface KillchainMirror {
  phase: string;
  koreanName: string;
  ordinal: number;
}
interface DoctrineMirrorShape {
  watchconLevels: {
    level: number;
    name: string;
    englishName: string | null;
    meaning: string;
    recommendedPosture: string | null;
  }[];
  killchainPhases: KillchainMirror[];
  responseOptions: ResponseOptionMirror[];
  c2Authority: {
    tier: number;
    authority: string;
    role: string | null;
    decisionThreshold: string | null;
    reportingChain: string | null;
  }[];
  roeCategories: {
    categoryId: string;
    name: string;
    allowedActions: string | null;
    activationWatchcon: number | null;
    description: string | null;
  }[];
}

const DOCTRINE = doctrineMirror as unknown as DoctrineMirrorShape;

// --- 데모용 휴리스틱 임계값 (lib/doctrine.ts 와 동일, 공개 교리 개념만) ---
const WC_SEVERE = 0.7;
const WC_EMERGENCY = 0.5;
const WC_WATCH = 0.25;
const KC_DECIDE_PROB = 0.65;
const KC_ASSESS_EVIDENCE = 2;

// 발사 탐지 여부: 타임라인에 launch/strike 이벤트가 보이거나 극단적 고확률.
function isLaunchDetected(
  events: TimelineEvent[] | undefined,
  topH: { category?: string; posterior: number } | null | undefined,
): boolean {
  if (events?.some((e) => e.type === 'launch' || e.type === 'strike')) return true;
  if (topH && topH.category === 'missile_launch' && topH.posterior >= 0.9) return true;
  return false;
}

interface DerivedDoctrine {
  watchconLevel: number;
  watchconName: string;
  watchconEnglish: string | null;
  killchainPhase: string;
  killchainKorean: string;
  killchainOrdinal: number;
  launchProbPct: number;
}

// 추론 결과 → WATCHCON / 킬체인 단계 도출 (lib/doctrine.ts 의 순수 로직을 클라이언트에서 재현).
function deriveDoctrine(
  inference: InferenceResult | null | undefined,
  events: TimelineEvent[] | undefined,
): DerivedDoctrine {
  const topH = inference?.topHypothesis ?? null;
  const launchProb = inference?.overallConfidence ?? topH?.posterior ?? 0;
  const evidenceCount = inference?.evidenceCount ?? 0;
  const launchDetected = isLaunchDetected(events, topH);

  let level = 5;
  if (launchDetected) {
    level = 2;
  } else if (topH && topH.category && topH.category !== 'missile_launch' && launchProb < WC_EMERGENCY) {
    level = 5;
  } else if (launchProb >= WC_SEVERE) {
    level = 2;
  } else if (launchProb >= WC_EMERGENCY) {
    level = 3;
  } else if (launchProb >= WC_WATCH) {
    level = 4;
  }

  let phase = 'detect';
  if (launchDetected) phase = 'act';
  else if (launchProb >= KC_DECIDE_PROB) phase = 'decide';
  else if (evidenceCount >= KC_ASSESS_EVIDENCE) phase = 'assess';

  const wcRow = DOCTRINE.watchconLevels.find((w) => w.level === level) ?? DOCTRINE.watchconLevels[DOCTRINE.watchconLevels.length - 1];
  const kcRow = DOCTRINE.killchainPhases.find((k) => k.phase === phase) ?? DOCTRINE.killchainPhases[0];

  return {
    watchconLevel: wcRow.level,
    watchconName: wcRow.name,
    watchconEnglish: wcRow.englishName,
    killchainPhase: kcRow.phase,
    killchainKorean: kcRow.koreanName,
    killchainOrdinal: kcRow.ordinal,
    launchProbPct: Math.round(launchProb * 100),
  };
}

// WATCHCON 등급별 색상 (게이지/배지)
function watchconColor(level: number): { bar: string; text: string; ring: string } {
  if (level <= 1) return { bar: 'bg-red-600', text: 'text-red-400', ring: 'ring-red-500/40' };
  if (level === 2) return { bar: 'bg-red-500', text: 'text-red-400', ring: 'ring-red-500/40' };
  if (level === 3) return { bar: 'bg-amber-500', text: 'text-amber-400', ring: 'ring-amber-500/40' };
  if (level === 4) return { bar: 'bg-yellow-500', text: 'text-yellow-400', ring: 'ring-yellow-500/40' };
  return { bar: 'bg-green-500', text: 'text-green-400', ring: 'ring-green-500/40' };
}

// 재생 시각(currentTime, 초) → 미션 클럭 표기 (MM:SS)
function missionClock(currentTime: number | undefined): string {
  const t = currentTime ?? 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- 아군 자산 (blue-units.json) 을 축별로 그룹화 ---
type BlueUnit = (typeof blueUnits)[number];

interface PillarGroup {
  key: 'isr' | 'kamd' | 'lamd' | 'kmpr';
  label: string;
  units: BlueUnit[];
}

function groupByPillar(): PillarGroup[] {
  const groups: PillarGroup[] = [
    { key: 'isr', label: 'ISR 정찰', units: [] },
    { key: 'kamd', label: 'KAMD 탐지', units: [] },
    { key: 'lamd', label: 'LAMD 요격', units: [] },
    { key: 'kmpr', label: 'KMPR 타격', units: [] },
  ];
  for (const u of blueUnits) {
    const t = u.assetType;
    if (t === 'ISR') groups[0].units.push(u);
    else if (t === 'KAMD_DETECT') groups[1].units.push(u);
    else if (t === 'KAMD_INTERCEPT') groups[2].units.push(u);
    else if (t === 'KMPR_STRIKE' || t === 'AIR') groups[3].units.push(u);
    else if (t === 'NAVAL') {
      // 이지스함은 탐지(KAMD) + 해상 요격 양면 → 탐지 축에 배치
      if (u.canonicalName.includes('이지') || u.canonicalName.includes('Aegis')) groups[1].units.push(u);
      else groups[3].units.push(u);
    }
  }
  return groups.filter((g) => g.units.length > 0);
}

// 자산의 현재 임무상태(체공중/대기중/출격가능/전개완료) + 임시편성 시각을
// 재생 시각·킬체인 단계·readiness 로부터 유도. (데이터 정합성은 추후 보정, 표시 우선)
function assetMissionStatus(
  unit: BlueUnit,
  currentTime: number | undefined,
  killchainOrdinal: number,
  watchconLevel: number,
): { label: string; tone: 'live' | 'warn' | 'idle'; time: string } {
  const t = currentTime ?? 0;
  const airborne = t > 0 && unit.readiness === 'ready';
  const isIsr = unit.assetType === 'ISR';
  const isInterceptor = unit.assetType === 'KAMD_INTERCEPT';
  const isStrike = unit.assetType === 'KMPR_STRIKE' || unit.assetType === 'AIR';

  if (isIsr) {
    if (airborne) {
      // 체공 잔여(잔여 비행시간) — illustrative
      const endurance = 60 * 8; // 8시간 가정
      const remaining = Math.max(0, endurance - t);
      const mm = Math.floor(remaining / 60);
      return { label: '체공중', tone: 'live', time: `잔여 ${mm}분` };
    }
    return { label: '대기중', tone: 'idle', time: '출격대기' };
  }
  if (isInterceptor) {
    if (watchconLevel <= 3) return { label: '전개완료', tone: 'warn', time: '요격대기' };
    return { label: '대기', tone: 'idle', time: '기지대기' };
  }
  if (isStrike) {
    if (killchainOrdinal >= 3) return { label: '스크램블', tone: 'warn', time: '출격준비' };
    return { label: '기지대기', tone: 'idle', time: '정상경계' };
  }
  // KAMD_DETECT / NAVAL 등 감시자산
  if (airborne || unit.readiness === 'ready') return { label: '감시중', tone: 'live', time: '정상가동' };
  return { label: '대기', tone: 'idle', time: '대기' };
}

// --- 최근 탐지 징후 (observation feed) ---
function recentObservations(events: TimelineEvent[], currentTime: number | undefined): TimelineEvent[] {
  const t = currentTime ?? 0;
  return events
    .filter((e) => e.timestamp <= t)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);
}

// 관측 이벤트 → 짧은 행 요약용 메타
function eventMeta(e: TimelineEvent): { kind: string; loc: string; cls: string } {
  const cls = e.actionClass ?? 'IMINT';
  let loc = e.mgrs ?? '';
  if (!loc && e.position) loc = `${e.position.lat.toFixed(2)},${e.position.lng.toFixed(2)}`;
  if (!loc && e.relatedAssets?.length) loc = e.relatedAssets[0];
  const kindMap: Record<string, string> = {
    IMINT: '영상',
    SIGINT: '신호',
    OSINT: '공개',
    HUMINT: '첩보',
    GEOINT: '지리',
    MASINT: '계측',
    UAV: '추적',
    CYBINT: '사이버',
    WXINT: '기상',
  };
  return { kind: kindMap[cls] ?? cls, loc: loc || '—', cls };
}

// 관측 시각(collectedAt) → HH:MM (없으면 time 필드/타임스탬프)
function obsTime(e: TimelineEvent, currentTime: number | undefined): string {
  if (e.collectedAt) {
    const d = new Date(e.collectedAt);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  if (e.time) return e.time;
  return missionClock(currentTime);
}

// --- 대응 옵션(교리) — 현재 킬체인 단계 이하에서 발동 가능한 옵션 ---
function availableResponseOptions(killchainOrdinal: number): ResponseOptionMirror[] {
  const ordinalOf = (phase: string | null) =>
    phase ? DOCTRINE.killchainPhases.find((k) => k.phase === phase)?.ordinal ?? 99 : 99;
  return DOCTRINE.responseOptions
    .filter((o) => ordinalOf(o.triggerPhase) <= killchainOrdinal)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

// 현재 WATCHCON 에 대응하는 ROE
function currentRoe(level: number) {
  return (
    DOCTRINE.roeCategories.find((r) => r.activationWatchcon === level) ??
    DOCTRINE.roeCategories
      .filter((r) => r.activationWatchcon != null && (r.activationWatchcon as number) >= level)
      .sort((a, b) => (b.activationWatchcon as number) - (a.activationWatchcon as number))[0] ??
    null
  );
}

// 결재권한 C2 tier (lib/doctrine.ts 와 동일 휴리스틱)
function activeC2Tier(level: number): number {
  if (level <= 2) return 2;
  if (level <= 4) return 3;
  return 4;
}

// ============================================================
// 하위 컴포넌트
// ============================================================

function SectionTitle({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className={`w-1 h-3 rounded-sm ${accent}`} />
      <h3 className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">{children}</h3>
    </div>
  );
}

function ThreatGauge({ doctrine }: { doctrine: DerivedDoctrine }) {
  const wc = watchconColor(doctrine.watchconLevel);
  return (
    <div className="rounded-md border border-gray-700/50 bg-black/30 px-2.5 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <SectionTitle accent={wc.bar}>위협 지표</SectionTitle>
        <span className={`text-[10px] font-mono ${wc.text} tabular-nums`}>
          WATCHCON {doctrine.watchconLevel}
        </span>
      </div>

      {/* WATCHCON + 킬체인 */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className={`rounded px-1.5 py-1 bg-gray-900/60 ring-1 ${wc.ring}`}>
          <div className="text-[9px] text-gray-500 uppercase">경계태세</div>
          <div className={`text-[12px] font-bold ${wc.text} leading-tight`}>
            {doctrine.watchconName}
          </div>
          <div className="text-[9px] text-gray-500 font-mono">{doctrine.watchconEnglish ?? '—'}</div>
        </div>
        <div className="rounded px-1.5 py-1 bg-gray-900/60 ring-1 ring-blue-500/20">
          <div className="text-[9px] text-gray-500 uppercase">킬체인</div>
          <div className="text-[12px] font-bold text-blue-300 leading-tight">
            {doctrine.killchainKorean}
          </div>
          <div className="text-[9px] text-gray-500 font-mono uppercase">{doctrine.killchainPhase}</div>
        </div>
      </div>
    </div>
  );
}

function AssetRow({
  unit,
  currentTime,
  killchainOrdinal,
  watchconLevel,
}: {
  unit: BlueUnit;
  currentTime: number | undefined;
  killchainOrdinal: number;
  watchconLevel: number;
}) {
  const ms = assetMissionStatus(unit, currentTime, killchainOrdinal, watchconLevel);
  const toneCls =
    ms.tone === 'live'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : ms.tone === 'warn'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-gray-600/15 text-gray-400 border-gray-500/30';
  const dotCls = ms.tone === 'live' ? 'bg-green-400 animate-pulse' : ms.tone === 'warn' ? 'bg-amber-400' : 'bg-gray-500';

  // 제간 요약 (사거리/탐지거리)
  const spec: string[] = [];
  if (unit.rangeKm) spec.push(`사거리 ${unit.rangeKm}km`);
  if (unit.detectionRangeKm) spec.push(`탐지 ${unit.detectionRangeKm}km`);

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-950/20 border border-blue-900/20 hover:border-blue-700/40 transition-colors">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[12px] font-medium text-blue-200 truncate">{unit.canonicalName}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${toneCls}`}>{ms.label}</span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-[10px] text-gray-500 truncate">
            {unit.baseName ?? '—'}
            {spec.length > 0 && <span className="text-gray-600"> · {spec.join(' / ')}</span>}
          </span>
          <span className="text-[10px] text-gray-400 font-mono shrink-0">{ms.time}</span>
        </div>
      </div>
    </div>
  );
}

function AvailableAssets({
  currentTime,
  killchainOrdinal,
  watchconLevel,
}: {
  currentTime: number | undefined;
  killchainOrdinal: number;
  watchconLevel: number;
}) {
  const groups = useMemo(() => groupByPillar(), []);
  const total = useMemo(() => groups.reduce((n, g) => n + g.units.length, 0), [groups]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <SectionTitle accent="bg-blue-500">가용 자산</SectionTitle>
        <span className="text-[10px] text-gray-500 font-mono">{total}건 전개</span>
      </div>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <span className="text-blue-500/70">{g.label}</span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-600">{g.units.length}</span>
            </div>
            <div className="space-y-1">
              {g.units.map((u) => (
                <AssetRow
                  key={u.slug}
                  unit={u}
                  currentTime={currentTime}
                  killchainOrdinal={killchainOrdinal}
                  watchconLevel={watchconLevel}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ObservationFeed({
  events,
  currentTime,
}: {
  events: TimelineEvent[];
  currentTime: number | undefined;
}) {
  const recent = useMemo(() => recentObservations(events, currentTime), [events, currentTime]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <SectionTitle accent="bg-cyan-500">최근 탐지 징후</SectionTitle>
        <span className="text-[10px] text-cyan-500/80 font-mono flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          LIVE
        </span>
      </div>
      {recent.length === 0 ? (
        <div className="text-[11px] text-gray-600 px-2 py-1.5 rounded bg-black/20 border border-gray-800/50">
          아직 탐지된 징후 없음 — 타임라인 재생 필요.
        </div>
      ) : (
        <div className="space-y-1">
          {recent.map((e) => {
            const m = eventMeta(e);
            return (
              <div
                key={e.id}
                className="px-2 py-1 rounded bg-black/30 border border-gray-800/50 hover:border-cyan-700/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-mono text-cyan-400/80 tabular-nums">{obsTime(e, currentTime)}</span>
                  <span className="text-[9px] px-1 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-900/40">
                    {m.kind}
                  </span>
                </div>
                <div className="text-[11px] text-gray-200 leading-snug mt-0.5 truncate">{e.title}</div>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <span className="text-[10px] text-gray-500 font-mono truncate">{m.loc}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResponseOptions({ doctrine }: { doctrine: DerivedDoctrine }) {
  const options = useMemo(() => availableResponseOptions(doctrine.killchainOrdinal), [doctrine.killchainOrdinal]);
  const roe = useMemo(() => currentRoe(doctrine.watchconLevel), [doctrine.watchconLevel]);
  const activeTier = useMemo(() => activeC2Tier(doctrine.watchconLevel), [doctrine.watchconLevel]);
  const activeC2 = DOCTRINE.c2Authority.find((c) => c.tier === activeTier) ?? null;

  const pillarLabel: Record<Pillar, string> = { kamd: 'KAMD', lamd: 'LAMD', kmpr: 'KMPR' };
  const pillarAccent: Record<Pillar, string> = {
    kamd: 'text-blue-300 border-blue-700/40',
    lamd: 'text-teal-300 border-teal-700/40',
    kmpr: 'text-orange-300 border-orange-700/40',
  };

  return (
    <div>
      <SectionTitle accent="bg-amber-500">대응 옵션</SectionTitle>

      {/* 가용 대응옵션 (3축) */}
      <div className="space-y-1 mb-2">
        {options.length === 0 ? (
          <div className="text-[11px] text-gray-600 px-2 py-1 rounded bg-black/20 border border-gray-800/50">
            현재 단계({doctrine.killchainKorean})에서 발동 가능한 옵션 없음.
          </div>
        ) : (
          options.map((o) => (
            <div
              key={o.optionId}
              className={`px-2 py-1 rounded bg-black/30 border ${pillarAccent[o.pillar]}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono opacity-80">{pillarLabel[o.pillar]}</span>
                <span className="text-[9px] text-gray-500 truncate">
                  {o.authorityThreshold ?? '—'}
                </span>
              </div>
              <div className="text-[12px] font-medium leading-tight mt-0.5">{o.asset}</div>
            </div>
          ))
        )}
      </div>

      {/* ROE + 결재권한 */}
      <div className="grid grid-cols-1 gap-1">
        {roe && (
          <div className="px-2 py-1 rounded bg-amber-950/20 border border-amber-900/40">
            <div className="text-[9px] text-gray-500 uppercase">교전규칙 (ROE)</div>
            <div className="text-[11px] text-amber-300 font-medium leading-tight">{roe.name}</div>
            <div className="text-[10px] text-gray-500 leading-snug mt-0.5">{roe.allowedActions ?? '—'}</div>
          </div>
        )}
        {activeC2 && (
          <div className="px-2 py-1 rounded bg-gray-900/40 border border-gray-700/50">
            <div className="text-[9px] text-gray-500 uppercase">결재권한 (C2)</div>
            <div className="text-[11px] text-gray-200 font-medium leading-tight">
              {activeC2.authority}
            </div>
            <div className="text-[10px] text-gray-500 leading-snug mt-0.5">
              {activeC2.decisionThreshold ?? '—'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 메인 패널
// ============================================================

export default function FriendlyPanel({
  friendlies,
  events = [],
  currentTime = 0,
  inferenceResult = null,
}: FriendlyPanelProps) {
  const doctrine = useMemo(
    () => deriveDoctrine(inferenceResult, events),
    [inferenceResult, events],
  );

  // friendlies(map mock 자산) 수 — 지도 전개 아군 자산 요약용. 자산 상세는 blue-units.json 사용.
  const deployedMapCount = friendlies.length;

  return (
    <div className="h-full flex flex-col layer-1 border-l border-blue-900/30">
      {/* Header — 미션 클럭 (타이틀 라인 제거됨) */}
      <div className="shrink-0 p-2.5 border-b border-blue-900/30 bg-blue-950/20">
        <div className="flex items-center justify-end">
          <span className="text-[11px] font-mono text-amber-400/80 tabular-nums">
            {missionClock(currentTime)}
          </span>
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">
          SITREP · 지도 전개 자산 {deployedMapCount}
        </div>
      </div>

      {/* 본문 — 단일 스크롤 컨테이너. 4개 섹션이 모두 노출/스크롤 가능. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 space-y-3">
        <ThreatGauge doctrine={doctrine} />
        <AvailableAssets
          currentTime={currentTime}
          killchainOrdinal={doctrine.killchainOrdinal}
          watchconLevel={doctrine.watchconLevel}
        />
        <ObservationFeed events={events} currentTime={currentTime} />
        <ResponseOptions doctrine={doctrine} />
        <div className="text-[9px] text-gray-600 leading-snug pt-1 border-t border-gray-800/50">
          교리 매핑은 공개 교리 개념(WATCHCON·KAMD 킬체인·3축 대응) 기반 데모용 휴리스틱.
          수치·체계연동은 illustrative stub.
        </div>
      </div>
    </div>
  );
}
