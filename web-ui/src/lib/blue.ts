import fs from 'fs';
import path from 'path';
import { FriendlyUnit, BlueContext, BlueResponseAsset, FriendlyAssetType } from '@/types';

// ============================================================
// 아군(Blue) 전투서열/작전 자산 연동 (Session 2 — 공수 양면)
// 지휘관은 "적이 쏠 것 같냐"뿐 아니라 "그럼 우리 아군 자산은 뭘 할 수 있나?"를 함께 묻는다.
// 본 모듈: (1) 징후 텍스트에서 아군 자산 정규 엔티티 해석(resolve)
//          (2) 현재 킬체인 단계에서 가용한 탐지/요격/타격 전력 구성(buildBlueContext)
//
// 데이터 원천: src/data/friendly-units.json (export_friendly_mirror.py 가
// 원격 Supabase 에서 내보냄, gitignore). 서버 런타임 fs 읽기, 키 불필요.
// fresh clone 시 파일이 없으면 빈 폴백(아군 컨텍스트 미제공, 기존 동작 유지).
//
// ⚠️ 제원(사거리/탐지거리)은 공개보도 수치(illustrative)이며 실 운용 수치·체계연동이 아님.
// ============================================================

// --- asset_type → 교리 축(pillar) 정규화 ---
function pillarOf(assetType: FriendlyAssetType, doctrineOption?: string | null): BlueResponseAsset['pillar'] {
  // 교리 옵션(option_id prefix)이 있으면 그 축을 우선
  if (doctrineOption) {
    if (doctrineOption.startsWith('kamd')) return 'kamd';
    if (doctrineOption.startsWith('lamd')) return 'lamd';
    if (doctrineOption.startsWith('kmpr')) return 'kmpr';
  }
  switch (assetType) {
    case 'KAMD_DETECT': return 'kamd';
    case 'KAMD_INTERCEPT': return 'lamd';
    case 'KMPR_STRIKE': return 'kmpr';
    case 'ISR': return 'isr';
    case 'AIR': return 'kmpr';      // 공군 타격 전력은 KMPR 축
    case 'NAVAL': return 'kamd';    // 이지함 탐지 중심(잠수함 SLBM은 doctrine_option=kmpr-slbm이 우선)
    case 'C2':
    case 'GROUND':
    default: return 'other';
  }
}

// --- 킬체인 단계별 활성 축 (detect → act 로 갈수록 확장) ---
function activePillarsForPhase(phase?: string | null): Set<BlueResponseAsset['pillar']> {
  switch (phase) {
    case 'detect': return new Set<BlueResponseAsset['pillar']>(['kamd', 'isr']);                       // 탐지/감시
    case 'assess': return new Set<BlueResponseAsset['pillar']>(['kamd', 'isr']);                       // 탐지/감시 유지
    case 'decide': return new Set<BlueResponseAsset['pillar']>(['kamd', 'isr', 'lamd']);               // 요격체계 대기 추가
    case 'act': return new Set<BlueResponseAsset['pillar']>(['kamd', 'isr', 'lamd', 'kmpr', 'other']); // 전 축 가동
    default: return new Set<BlueResponseAsset['pillar']>(['kamd', 'isr', 'lamd', 'kmpr', 'other']);    // 미지정 시 전체
  }
}

function loadMirror(): FriendlyUnit[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'friendly-units.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FriendlyUnit[];
  } catch {
    return [];
  }
}

// 텍스트 안에서 가장 길게 매칭되는 alias 로 정규 아군 자산 해석. (긴 alias = 더 구체적)
export function resolveFriendly(text: string): FriendlyUnit[] {
  const pool = loadMirror();
  if (!pool.length) return [];
  const low = text.toLowerCase();
  const hits: FriendlyUnit[] = [];
  for (const unit of pool) {
    const aliases = unit.aliases ?? [];
    let best: string | null = null;
    for (const alias of aliases) {
      const a = alias.toLowerCase();
      if (a.length >= 2 && low.includes(a) && (!best || a.length > best.length)) {
        best = a;
      }
    }
    if (best) hits.push({ ...unit, matchedAlias: best });
  }
  return hits.sort((a, b) => (b.matchedAlias?.length ?? 0) - (a.matchedAlias?.length ?? 0));
}

export interface BlueInput {
  /** 현재 KAMD 킬체인 단계 (detect/assess/decide/act). 미지정 시 전체. */
  killchainPhase?: string | null;
  /** ready 자산만 노출할지 여부 (기본 true) */
  readyOnly?: boolean;
}

const ILLUSTRATIVE_NOTE =
  '아군 자산 제원(사거리/탐지거리)은 공개보도 수치(illustrative)이며, ' +
  '킬체인 단계 매핑은 공개 교리 개념을 사용한 데모용 휴리스틱. 실 운용 체계연동이 아님.';

/**
 * 현재 킬체인 단계에서 가용한 아군 대응 전력(공수 양면) 구성.
 * 미러가 없으면(fresh clone) null 반환 — 기존 brief 동작 유지.
 */
export function buildBlueContext(input: BlueInput): BlueContext | null {
  const pool = loadMirror();
  if (!pool.length) return null;

  const { killchainPhase, readyOnly = true } = input;
  const activePillars = activePillarsForPhase(killchainPhase);

  // ready 필터(기본) + 축 정규화
  const candidates = pool
    .filter((u) => (readyOnly ? u.readiness === 'ready' : true))
    .map((u) => {
      const pillar = pillarOf(u.assetType, u.doctrineOption);
      return {
        canonicalName: u.canonicalName,
        assetType: u.assetType,
        branch: u.branch,
        role: u.role ?? null,
        capability: u.capability ?? null,
        rangeKm: u.rangeKm ?? null,
        detectionRangeKm: u.detectionRangeKm ?? null,
        readiness: u.readiness ?? null,
        baseName: u.baseName ?? null,
        doctrineOption: u.doctrineOption ?? null,
        pillar,
      } as BlueResponseAsset;
    });

  // 활성 축 우선 정렬 후, 같은 축 내에서 탐지거리/사거리 내림차순
  const byPillarCount = { kamd: 0, lamd: 0, kmpr: 0, isr: 0, other: 0 };
  for (const c of candidates) byPillarCount[c.pillar]++;

  const availableAssets = candidates
    .filter((c) => activePillars.has(c.pillar))
    .sort((a, b) => {
      const ai = activePillars.has(a.pillar) ? 0 : 1;
      const bi = activePillars.has(b.pillar) ? 0 : 1;
      if (ai !== bi) return ai - bi;
      // 축 순서: kamd(탐지) → isr → lamd(요격) → kmpr(타격) → other
      const order: Record<string, number> = { kamd: 0, isr: 1, lamd: 2, kmpr: 3, other: 4 };
      const po = (order[a.pillar] ?? 9) - (order[b.pillar] ?? 9);
      if (po !== 0) return po;
      const ra = Number(a.rangeKm ?? a.detectionRangeKm ?? 0);
      const rb = Number(b.rangeKm ?? b.detectionRangeKm ?? 0);
      return rb - ra;
    })
    .slice(0, 12);

  return {
    availableAssets,
    byPillar: byPillarCount,
    resolvedUnits: [], // brief 라우트에서 resolveFriendly 결과를 주입
    note: ILLUSTRATIVE_NOTE,
  };
}

// blueContext 를 LLM 프롬프트용 텍스트로 직렬화 (공수 양면 — 아군이 할 수 있는 것)
export function formatBlueForPrompt(ctx: BlueContext): string {
  const lines: string[] = [];
  lines.push(`[아군 가용 대응 전력 — illustrative, 공개 제원 기반]`);
  const groups: Record<string, BlueResponseAsset[]> = { kamd: [], isr: [], lamd: [], kmpr: [], other: [] };
  for (const a of ctx.availableAssets) groups[a.pillar].push(a);

  if (groups.kamd.length || groups.isr.length) {
    lines.push('탐지/감시(KAMD/ISR):');
    for (const a of [...groups.kamd, ...groups.isr]) {
      const det = a.detectionRangeKm ? ` 탐지~${a.detectionRangeKm}km` : '';
      lines.push(`  - ${a.canonicalName} [${a.assetType}]${det}${a.baseName ? ` (기지:${a.baseName})` : ''} — ${a.role ?? ''}`);
    }
  }
  if (groups.lamd.length) {
    lines.push('요격(LAMD):');
    for (const a of groups.lamd) {
      const rng = a.rangeKm ? ` 요격~${a.rangeKm}km` : '';
      lines.push(`  - ${a.canonicalName} [${a.assetType}]${rng} — ${a.role ?? ''}`);
    }
  }
  if (groups.kmpr.length) {
    lines.push('타격(KMPR/공해상):');
    for (const a of groups.kmpr) {
      const rng = a.rangeKm ? ` 사거리~${a.rangeKm}km` : '';
      lines.push(`  - ${a.canonicalName} [${a.assetType}]${rng}${a.baseName ? ` (기지:${a.baseName})` : ''} — ${a.role ?? ''}`);
    }
  }
  lines.push(`(축별 가용: KAMD탐지 ${ctx.byPillar.kamd}, ISR ${ctx.byPillar.isr}, LAMD요격 ${ctx.byPillar.lamd}, KMPR타격 ${ctx.byPillar.kmpr})`);
  lines.push(`(${ctx.note})`);
  return lines.join('\n');
}
