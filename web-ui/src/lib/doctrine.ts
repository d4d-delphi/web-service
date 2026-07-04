import fs from 'fs';
import path from 'path';

// ============================================================
// 아군 교리 연동 (Track B)
// 추론 결과(사후확률·위협 카테고리·증거 수) → 교리 컨텍스트 매핑.
//
// 데이터 원천: src/data/doctrine-ontology.json (export_doctrine_mirror.py 가
// 원격 Supabase 에서 내보냄, gitignore). 서버 런타임 fs 읽기, 키 불필요.
// fresh clone 시 파일이 없으면 빈 폴백(교리 컨텍스트 미제공, 기존 동작 유지).
//
// ⚠️ 본 모듈의 임계값/휴리스틱은 데모용 명시적 상수.
//    공개 교리 개념(WATCHCON/킬체인/3축 대응)만 사용하며, 실 운용 수치·체계연동은 아님.
// ============================================================

// --- 데모용 휴리스틱 임계값 (illustrative, 공개 교리 개념만) ---
const WATCHCON_SEVERE_PROB = 0.7;   // >= 심각(watchcon 2)
const WATCHCON_EMERGENCY_PROB = 0.5; // >= 비상(watchcon 3)
const WATCHCON_WATCH_PROB = 0.25;    // >= 경계(watchcon 4), 미만은 단순경계(5)
const KILLCHAIN_DECIDE_PROB = 0.65;  // 결심 단계 진입 사후확률
const KILLCHAIN_ASSESS_EVIDENCE = 2; // 판단 단계 진입 최소 증거 수

// --- Doctrine 미러 타입 (Supabase 교리 테이블 평면화) ---
interface WatchconLevelMirror {
  level: number; name: string; englishName: string | null;
  meaning: string; activationCondition: string | null; recommendedPosture: string | null;
}
interface KillchainPhaseMirror {
  phase: string; koreanName: string; ordinal: number;
  entryCondition: string | null; exitCondition: string | null; description: string | null;
}
interface ResponseOptionMirror {
  optionId: string; pillar: 'kamd' | 'kmpr' | 'lamd'; pillarName: string; asset: string;
  triggerPhase: string | null; authorityThreshold: string | null; priority: number | null;
  description: string | null;
}
interface C2AuthorityMirror {
  tier: number; authority: string; role: string | null;
  decisionThreshold: string | null; reportingChain: string | null;
}
interface RoeCategoryMirror {
  categoryId: string; name: string; allowedActions: string | null;
  activationWatchcon: number | null; description: string | null;
}
interface FriendlyAssetMirror {
  canonicalName: string; slug: string | null; pillar: string | null; assetType: string | null;
  rangeKm: number | null; detectionRangeKm: number | null; readiness: string | null;
  currentWatchcon: number | null; description: string | null;
}
interface DoctrineMirror {
  watchconLevels: WatchconLevelMirror[];
  killchainPhases: KillchainPhaseMirror[];
  responseOptions: ResponseOptionMirror[];
  c2Authority: C2AuthorityMirror[];
  roeCategories: RoeCategoryMirror[];
  friendlyAssets: FriendlyAssetMirror[];
}

// --- 노출 타입 (api/brief 응답 doctrineContext) ---
export interface DoctrineWatchcon {
  level: number; name: string; englishName: string | null;
  meaning: string; recommendedPosture: string | null; reason: string;
}
export interface DoctrineKillchainPhase {
  phase: string; koreanName: string; ordinal: number;
  entryCondition: string | null; description: string | null; reason: string;
}
export interface DoctrineResponseOption {
  optionId: string; pillar: string; pillarName: string; asset: string;
  triggerPhase: string | null; authorityThreshold: string | null;
  priority: number | null; description: string | null;
}
export interface DoctrineC2Authority {
  tier: number; authority: string; role: string | null;
  decisionThreshold: string | null; reportingChain: string | null; isActive: boolean;
}
export interface DoctrineRoeCategory {
  categoryId: string; name: string; allowedActions: string | null;
  activationWatchcon: number | null; description: string | null;
}
export interface DoctrineFriendlyAsset {
  canonicalName: string; pillar: string | null; assetType: string | null;
  rangeKm: number | null; detectionRangeKm: number | null; readiness: string | null;
  description: string | null;
}
export interface DoctrineContext {
  watchcon: DoctrineWatchcon;
  killchainPhase: DoctrineKillchainPhase;
  responseOptions: DoctrineResponseOption[];
  c2Authority: DoctrineC2Authority[];
  roeCategory: DoctrineRoeCategory | null;
  readyAssets: DoctrineFriendlyAsset[];
  note: string; // illustrative disclaimer
}

function loadMirror(): DoctrineMirror | null {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'doctrine-ontology.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DoctrineMirror;
  } catch {
    return null;
  }
}

export interface DoctrineInput {
  /** 최유력 가설 사후확률 (0-1) */
  topPosterior: number;
  /** 최유력 가설 카테고리 (missile_launch/exercise/provocation/normal) */
  topCategory?: string;
  /** 추론 불확실성 (0-1) */
  uncertainty?: number;
  /** 유효 증거 수 */
  evidenceCount: number;
  /** 발사가 탐지/개시되었는지 (부스트/커스터디 단계) */
  launchDetected: boolean;
  scenarioId?: string;
  phaseId?: number;
}

const ILLUSTRATIVE_NOTE =
  '교리 매핑은 공개 교리 개념(WATCHCON·KAMD 킬체인·3축 대응)을 사용한 데모용 휴리스틱. ' +
  '임계값/수치는 illustrative stub이며 실 운용 체계연동이 아님.';

// WATCHCON 결정 (1=전시 ~ 5=단순경계)
function decideWatchcon(input: DoctrineInput): { level: number; reason: string } {
  if (input.launchDetected) {
    return { level: 2, reason: `발사 탐지 → 심각(watchcon 2). 사후확률 ${(input.topPosterior * 100).toFixed(0)}%.` };
  }
  if (input.topCategory && input.topCategory !== 'missile_launch') {
    // 비미사일 가설이 우세하면 경계 완화
    if (input.topPosterior < WATCHCON_EMERGENCY_PROB) {
      return { level: 5, reason: `최유력 가설이 '${input.topCategory}'(비발사) → 단순경계(watchcon 5).` };
    }
  }
  if (input.topPosterior >= WATCHCON_SEVERE_PROB) {
    return { level: 2, reason: `발사 가설 사후확률 ${(input.topPosterior * 100).toFixed(0)}% >= ${WATCHCON_SEVERE_PROB * 100}% → 심각(watchcon 2).` };
  }
  if (input.topPosterior >= WATCHCON_EMERGENCY_PROB) {
    return { level: 3, reason: `발사 가설 사후확률 ${(input.topPosterior * 100).toFixed(0)}% >= ${WATCHCON_EMERGENCY_PROB * 100}% → 비상(watchcon 3).` };
  }
  if (input.topPosterior >= WATCHCON_WATCH_PROB) {
    return { level: 4, reason: `발사 가설 사후확률 ${(input.topPosterior * 100).toFixed(0)}% >= ${WATCHCON_WATCH_PROB * 100}% → 경계(watchcon 4).` };
  }
  return { level: 5, reason: `발사 가설 사후확률 ${(input.topPosterior * 100).toFixed(0)}% < ${WATCHCON_WATCH_PROB * 100}% → 단순경계(watchcon 5).` };
}

// 킬체인 단계 결정 (detect→assess→decide→act)
function decideKillchain(input: DoctrineInput): { phase: string; reason: string } {
  if (input.launchDetected) {
    return { phase: 'act', reason: '발사 탐지/개시 → 실행(act) 단계.' };
  }
  if (input.topPosterior >= KILLCHAIN_DECIDE_PROB) {
    return { phase: 'decide', reason: `사후확률 ${(input.topPosterior * 100).toFixed(0)}% >= 결심임계 ${KILLCHAIN_DECIDE_PROB * 100}% → 결심(decide) 단계.` };
  }
  if (input.evidenceCount >= KILLCHAIN_ASSESS_EVIDENCE) {
    return { phase: 'assess', reason: `증거 ${input.evidenceCount}개 누적 → 판단(assess) 단계.` };
  }
  return { phase: 'detect', reason: '초기 징후 탐지 → 탐지(detect) 단계.' };
}

// 현재 watchcon 에서 결재 권한인 C2 tier 표시
function activeC2TierFor(watchconLevel: number): number {
  // watchcon 1-2(심각/전시) → tier 1-2 / 3-4(비상/경계) → tier 2-3 / 5(평시) → tier 3-4
  if (watchconLevel <= 2) return 2; // 합참의장 결심
  if (watchconLevel <= 4) return 3; // 작전사령관 결심
  return 4; // 군사령관/기능사
}

/**
 * 추론 결과 → 교리 컨텍스트 매핑.
 * 미러가 없으면(fresh clone) null 반환 — 기존 brief 동작 유지.
 */
export function mapDoctrineContext(input: DoctrineInput): DoctrineContext | null {
  const mirror = loadMirror();
  if (!mirror || mirror.watchconLevels.length === 0) return null;

  const wc = decideWatchcon(input);
  const kc = decideKillchain(input);

  const watchconRow = mirror.watchconLevels.find((w) => w.level === wc.level) ?? mirror.watchconLevels[mirror.watchconLevels.length - 1];
  const kcRow = mirror.killchainPhases.find((k) => k.phase === kc.phase) ?? mirror.killchainPhases[0];
  const currentOrdinal = kcRow.ordinal;

  // 현재 킬체인 단계 이하에서 발동 가능한 대응 옵션 (triggerPhase.ordinal <= currentOrdinal)
  const ordinalOf = (phase: string | null) =>
    phase ? (mirror.killchainPhases.find((k) => k.phase === phase)?.ordinal ?? 99) : 99;
  const responseOptions: DoctrineResponseOption[] = mirror.responseOptions
    .filter((o) => ordinalOf(o.triggerPhase) <= currentOrdinal)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .slice(0, 8)
    .map((o) => ({
      optionId: o.optionId, pillar: o.pillar, pillarName: o.pillarName, asset: o.asset,
      triggerPhase: o.triggerPhase, authorityThreshold: o.authorityThreshold,
      priority: o.priority, description: o.description,
    }));

  const activeTier = activeC2TierFor(wc.level);
  const c2Authority: DoctrineC2Authority[] = mirror.c2Authority.map((a) => ({
    tier: a.tier, authority: a.authority, role: a.role, decisionThreshold: a.decisionThreshold,
    reportingChain: a.reportingChain, isActive: a.tier === activeTier,
  }));

  // 현재 watchcon 에 대응하는 ROE (activation_watchcon == level). 없으면 가장 가까운 상향 경계.
  const roeRow =
    mirror.roeCategories.find((r) => r.activationWatchcon === wc.level) ??
    mirror.roeCategories
      .filter((r) => r.activationWatchcon != null && (r.activationWatchcon as number) >= wc.level)
      .sort((a, b) => (b.activationWatchcon as number) - (a.activationWatchcon as number))[0] ??
    null;

  const roeCategory: DoctrineRoeCategory | null = roeRow
    ? {
        categoryId: roeRow.categoryId, name: roeRow.name, allowedActions: roeRow.allowedActions,
        activationWatchcon: roeRow.activationWatchcon, description: roeRow.description,
      }
    : null;

  // 가용(ready) 아군 자산 — 현재 단계 관련 축 우선 정렬
  const activePillars = new Set(responseOptions.map((o) => o.pillar));
  const readyAssets: DoctrineFriendlyAsset[] = mirror.friendlyAssets
    .filter((a) => a.readiness === 'ready')
    .map((a) => ({
      canonicalName: a.canonicalName, pillar: a.pillar, assetType: a.assetType,
      rangeKm: a.rangeKm, detectionRangeKm: a.detectionRangeKm, readiness: a.readiness,
      description: a.description,
    }))
    .sort((a, b) => {
      const ai = activePillars.has(a.pillar ?? '') ? 0 : 1;
      const bi = activePillars.has(b.pillar ?? '') ? 0 : 1;
      return ai - bi;
    })
    .slice(0, 8);

  return {
    watchcon: {
      level: watchconRow.level, name: watchconRow.name, englishName: watchconRow.englishName,
      meaning: watchconRow.meaning, recommendedPosture: watchconRow.recommendedPosture,
      reason: wc.reason,
    },
    killchainPhase: {
      phase: kcRow.phase, koreanName: kcRow.koreanName, ordinal: kcRow.ordinal,
      entryCondition: kcRow.entryCondition, description: kcRow.description, reason: kc.reason,
    },
    responseOptions,
    c2Authority,
    roeCategory,
    readyAssets,
    note: ILLUSTRATIVE_NOTE,
  };
}

// doctrineContext 를 LLM 프롬프트용 텍스트로 직렬화 (선택적 사용)
export function formatDoctrineForPrompt(ctx: DoctrineContext): string {
  const lines: string[] = [];
  lines.push(`[아군 교리 매핑 — illustrative]`);
  lines.push(`경계태세(WATCHCON): ${ctx.watchcon.level}단계 ${ctx.watchcon.name}(${ctx.watchcon.englishName ?? ''}) — ${ctx.watchcon.reason}`);
  lines.push(`권고 태세: ${ctx.watchcon.recommendedPosture ?? '-'}`);
  lines.push(`킬체인: ${ctx.killchainPhase.phase}(${ctx.killchainPhase.koreanName}) — ${ctx.killchainPhase.reason}`);
  if (ctx.responseOptions.length) {
    lines.push(`가용 대응옵션(3축):`);
    for (const o of ctx.responseOptions) {
      lines.push(`  - [${o.pillarName}] ${o.asset}${o.authorityThreshold ? ` (권한: ${o.authorityThreshold})` : ''}`);
    }
  }
  if (ctx.roeCategory) {
    lines.push(`적용 교전규칙(ROE): ${ctx.roeCategory.name} — ${ctx.roeCategory.allowedActions ?? ''}`);
  }
  const activeC2 = ctx.c2Authority.find((c) => c.isActive);
  if (activeC2) {
    lines.push(`결재권자: ${activeC2.authority} — ${activeC2.decisionThreshold ?? ''}`);
  }
  lines.push(`(${ctx.note})`);
  return lines.join('\n');
}
