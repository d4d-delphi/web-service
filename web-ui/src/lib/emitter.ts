import fs from 'fs';
import path from 'path';

// ============================================================
// 방출원(EMitter) 온톨로지 — SIGINT gap 해소 (Session 3, D3)
// 근거: SIGINT observation 은 "방공 감시레이더 계열"/"텔레메트리 송신 계열"/"미상" 같은
//       generic emitter_guess 를 가지며, 이를 정규 엔티티(레이더/통신/텔레메트리)로 해석할
//       온톨로지가 없었다. 본 모듈이 그 다리 역할을 한다.
//
// (1) resolveEmitter(text)   — 자유텍스트(질의/보고)에서 alias 기반 정규 emitter 해석
// (2) interpretSigintEmitter — SIGINT observation 의 asset_detail(band+신호파라미터+
//                              emitter_guess) → 정규 emitter 해석(신호특성 휴리스틱)
// (3) formatEmittersForPrompt — LLM 프롬프트용 직렬화
//
// 데이터 원천: src/data/emitter-ontology.json (export_emitter_mirror.py 가 원격 Supabase
// 에서 내보냄, gitignore). 서버 런타임 fs 읽기, 키 불필요.
// fresh clone 시 파일이 없으면 빈 폴백(emitter 컨텍스트 미제공, 기존 동작 유지).
//
// ⚠️ 제원(대역/PRI/PW)은 공개 OSINT 범위의 illustrative stub. 실 운용 수치·체계연동이 아님.
// ============================================================

export type EmitterType =
  | 'SEARCH' | 'FIRE_CONTROL' | 'SEARCH_FIRE' | 'EARLY_WARNING'
  | 'COMMS' | 'TELEMETRY' | 'DATALINK' | 'NAVIGATION' | 'UNKNOWN';

export type ThreatRelevance =
  | 'launch_indicator' | 'air_defense' | 'background' | 'comms' | 'neutral' | 'unknown';

export interface EmitterEntity {
  canonicalName: string;
  slug: string;
  designation: string;
  emitterType: EmitterType;
  band: string | null;
  natoName: string | null;
  associatedSystem: string | null;
  platform: string | null;
  role: string | null;
  frequencyParams: Record<string, unknown> | null;
  threatRelevance: ThreatRelevance | null;
  description: string | null;
  aliases: string[];
  matchedAlias: string;
}

interface EmitterMirror {
  canonicalName: string; slug: string; designation: string; emitterType: EmitterType;
  band: string | null; natoName: string | null; associatedSystem: string | null;
  platform: string | null; role: string | null;
  frequencyParams: Record<string, unknown> | null;
  threatRelevance: ThreatRelevance | null; description: string | null; aliases: string[];
}

function loadMirror(): EmitterMirror[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'emitter-ontology.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as EmitterMirror[];
  } catch {
    return [];
  }
}

// 텍스트 안에서 가장 길게 매칭되는 alias 로 정규 방출원 해석 (긴 alias = 더 구체적).
export function resolveEmitter(text: string): EmitterEntity[] {
  const pool = loadMirror();
  if (!pool.length) return [];
  const low = text.toLowerCase();
  const hits: EmitterEntity[] = [];
  for (const entity of pool) {
    let best: string | null = null;
    for (const alias of entity.aliases) {
      const a = alias.toLowerCase();
      if (a.length >= 2 && low.includes(a) && (!best || a.length > best.length)) {
        best = a;
      }
    }
    if (best) {
      hits.push({
        canonicalName: entity.canonicalName, slug: entity.slug, designation: entity.designation,
        emitterType: entity.emitterType, band: entity.band, natoName: entity.natoName,
        associatedSystem: entity.associatedSystem, platform: entity.platform, role: entity.role,
        frequencyParams: entity.frequencyParams, threatRelevance: entity.threatRelevance,
        description: entity.description, aliases: entity.aliases, matchedAlias: best,
      });
    }
  }
  // launch_indicator/air_defense 우선, 그 후 매칭 alias 길이
  const relOrder: Record<string, number> = {
    launch_indicator: 0, air_defense: 1, comms: 2, background: 3, neutral: 4, unknown: 5,
  };
  return hits.sort((a, b) => {
    const ra = relOrder[a.threatRelevance ?? 'unknown'] ?? 9;
    const rb = relOrder[b.threatRelevance ?? 'unknown'] ?? 9;
    if (ra !== rb) return ra - rb;
    return b.matchedAlias.length - a.matchedAlias.length;
  });
}

// --- SIGINT observation asset_detail 해석용 느슨한 타입 (원천 jsonb) ---
export interface SigintAssetDetail {
  emitter_guess?: string | null;
  frequency_band?: string | null;
  signal_strength?: string | null;
  ew_status?: string | null;
  is_raw?: boolean | null;
  signal_params?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SigintEmitterInterpretation {
  /** 해석된 정규 emitter 들(관련성 순). 비어있으면 미식별. */
  emitters: EmitterEntity[];
  /** 해석에 사용한 힌트 요약(밴드/변조/scan/emitter_guess). */
  signalHint: string;
  /** SIGINT 신호 특성이 시사하는 운용적 의미(발사징후/방공/배경). */
  implication: 'launch_indicator' | 'air_defense' | 'comms' | 'background' | 'unknown';
  /** emitter_guess 가 "미상" 이거나 해석이 안 된 경우 true — 교차검증 권고 근거. */
  unidentified: boolean;
}

/**
 * SIGINT observation 의 asset_detail(band + signal_params + emitter_guess) 를
 * 정규 emitter 로 해석하는 휴리스틱.
 *  - 신호 파라미터(변조/scan/밴드) 로 emitter_type 을 좁히고, 그 안에서 alias 매칭.
 *  - alias 매칭이 없으면 emitter_type+밴드 기반 후보를 올리고 unidentified=true.
 * 공개 OSINT 범위의 illustrative 휴리스틱(데모용).
 */
export function interpretSigintEmitter(detail: SigintAssetDetail): SigintEmitterInterpretation {
  const pool = loadMirror();
  const guess = (detail.emitter_guess ?? '').toString();
  const band = (detail.frequency_band ?? '').toString().toUpperCase();
  const params = detail.signal_params ?? {};
  const modulation = (params.modulation as string | undefined)?.toString().toUpperCase() ?? '';
  const scan = (params.Scan as string | undefined)?.toString() ?? '';
  const traffic = (params.traffic_level as string | undefined)?.toString().toLowerCase() ??
    (params.traffic_pattern as string | undefined)?.toString().toLowerCase() ?? '';

  // (1) emitter_guess + signal 묘사를 합쳐 alias 매칭 (가장 구체적 경로)
  const probeText = [guess, band, modulation, scan, traffic].filter(Boolean).join(' ');
  const matched = resolveEmitter(probeText);

  // (2) 신호 특성 기반 emitter_type 좁히기 (매칭이 부족할 때 보강)
  let implication: SigintEmitterInterpretation['implication'] = 'unknown';
  if (modulation.includes('PCM/FM') || modulation.includes('PCM') && band.includes('S')) {
    implication = 'launch_indicator'; // 텔레메트리
  } else if (band.includes('S') || band.includes('VHF') || band.includes('E') || band.includes('G') || band.includes('H')) {
    if (scan || 'PRI' in params || 'PW' in params) implication = 'air_defense'; // 레이더 계열
  }
  if (modulation.includes('FM') && (band.includes('VHF') || band.includes('UHF'))) {
    implication = traffic.includes('surge') || traffic.includes('multi-node') ? 'comms' : 'background';
  }
  if (guess.includes('텔레메트리') || guess.includes('telemetry')) implication = 'launch_indicator';
  if (guess.includes('방공') || guess.includes('레이더') || guess.includes('감시')) implication = 'air_defense';
  if (guess.includes('무전') || guess.includes('교신')) implication = 'comms';

  // (3) implication 에 맞는 후보 보강: 매칭이 비었으면 같은 threat_relevance/emitter_type 후보 올림
  let emitters = matched;
  if (!emitters.length && implication !== 'unknown') {
    emitters = pool
      .filter((e) => e.threatRelevance === implication || e.threatRelevance === 'unknown')
      .slice(0, 3)
      .map((e) => ({
        canonicalName: e.canonicalName, slug: e.slug, designation: e.designation,
        emitterType: e.emitterType, band: e.band, natoName: e.natoName,
        associatedSystem: e.associatedSystem, platform: e.platform, role: e.role,
        frequencyParams: e.frequencyParams, threatRelevance: e.threatRelevance,
        description: e.description, aliases: e.aliases, matchedAlias: guess || band || '(신호특성)',
      }));
  }

  const unidentified = guess.includes('미상') || guess.toLowerCase().includes('unidentified') ||
    (!matched.length && implication === 'unknown');

  const hintParts = [
    band && `밴드:${band}`,
    modulation && `변조:${modulation}`,
    scan && `scan:${scan}`,
    'PRI' in params && `PRI:${params.PRI}`,
    'PW' in params && `PW:${params.PW}`,
    traffic && `traffic:${traffic}`,
    guess && `guess:"${guess}"`,
  ].filter(Boolean);
  const signalHint = hintParts.join(' ');

  return { emitters, signalHint, implication, unidentified };
}

// emitter 해석 결과를 LLM 프롬프트용 텍스트로 직렬화
export function formatEmittersForPrompt(params: {
  emitters: EmitterEntity[];
  interpretation?: SigintEmitterInterpretation | null;
}): string {
  const { emitters, interpretation } = params;
  if (!emitters.length && !interpretation) return '';
  const lines: string[] = [];
  if (emitters.length) {
    lines.push('정규 방출원(온톨로지 해석):');
    for (const e of emitters.slice(0, 6)) {
      const rel = e.threatRelevance ? ` [${e.threatRelevance}]` : '';
      const band = e.band ? ` ${e.band}` : '';
      const sys = e.associatedSystem ? ` (${e.associatedSystem})` : '';
      lines.push(`  - ${e.canonicalName}${band}${sys}${rel} — 매칭: "${e.matchedAlias}"`);
    }
  }
  if (interpretation) {
    lines.push(`SIGINT 신호특성: ${interpretation.signalHint}`);
    lines.push(`운용 의미: ${interpretation.implication}${interpretation.unidentified ? ' (방출원 미식별 — 교차검증 권고)' : ''}`);
  }
  return lines.join('\n');
}
