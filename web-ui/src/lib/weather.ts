import fs from 'fs';
import path from 'path';
import type { AircraftSpec, Airbase, WeatherObservation, GoNoGoResult } from '@/types';

// ============================================================
// WXINT (Weather INTelligence) — AMWS(Air Mission Weather System) 편입
//
// 기상 관측값 × 기종별 작전 한계치(OSINT) → 기종별 Go/No-Go 판정.
// Mission Briefing "기상" 섹션의 정형 산출을 담당한다.
//
// 핵심 도메인 로직(AMWS app.py 이식):
//   (1) 측풍 계산 — abs(wind_spd × sin(radians(wind_dir - runway_heading)))
//   (2) 판정     — 측풍 초과 / 시정 미달 / 운고 부족 / 강수 제한
//   (3) MARGINAL — DELPHI 확장. 한계치의 90~100% 영역은 GO/NO-GO 경계(MARGINAL)
//                  로 분류하여, 지휘관에게 회색구간 판단 여지를 제공.
//
// 데이터 원천:
//   - 기종 제원: src/data/aircraft-specs.json (공개 OSINT illustrative stub)
//   - 비행장  : 본 파일 내 AIRBASES 정적 레지스트리 (정적 OSINT)
// ⚠️ 실제 운용 제한치·활주로 자방위가 아님. 폐쇄막 연동 시 별도.
// ============================================================

// ------------------------------------------------------------
// 1. 비행장 레지스트리 (정적 OSINT)
//    AMWS README 기지(K-2 대구, K-57 광주, K-13 수원) + 주요 비행단.
//    활주로 자방위(runway_heading)는 측풍 계산의 핵심 입력.
// ------------------------------------------------------------
export const AIRBASES: Airbase[] = [
  { base_id: 'K-2',  base_name: '대구',   lat: 35.893, lon: 128.659, runway_heading: 140 },
  { base_id: 'K-3',  base_name: '청주',   lat: 36.716, lon: 127.499, runway_heading: 230 },
  { base_id: 'K-13', base_name: '수원',   lat: 37.238, lon: 127.006, runway_heading: 150 },
  { base_id: 'K-15', base_name: '강릉',   lat: 37.755, lon: 128.947, runway_heading: 80 },
  { base_id: 'K-16', base_name: '서산',   lat: 36.772, lon: 126.450, runway_heading: 90 },
  { base_id: 'K-57', base_name: '광주',   lat: 35.112, lon: 126.819, runway_heading: 40 },
];

// ------------------------------------------------------------
// 2. 기종 제원 로더 (aircraft-specs.json → AircraftSpec[])
//    서버 런타임 fs 읽기. 파일 부재 시 빈 배열 폴백(기존 동작 유지).
// ------------------------------------------------------------
let _aircraftCache: AircraftSpec[] | null = null;

export function loadAircraftSpecs(): AircraftSpec[] {
  if (_aircraftCache) return _aircraftCache;
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'aircraft-specs.json');
    if (!fs.existsSync(file)) {
      _aircraftCache = [];
      return _aircraftCache;
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { aircraft?: AircraftSpec[] };
    _aircraftCache = raw.aircraft ?? [];
    return _aircraftCache;
  } catch {
    _aircraftCache = [];
    return _aircraftCache;
  }
}

export function getAircraftSpec(aircraftId: string): AircraftSpec | undefined {
  return loadAircraftSpecs().find((a) => a.aircraft_id === aircraftId);
}

export function getAirbase(baseId: string): Airbase | undefined {
  return AIRBASES.find((b) => b.base_id === baseId);
}

// ------------------------------------------------------------
// 3. 측풍 계산 (AMWS calculate_crosswind 이식)
//    abs(wind_spd × sin(radians(wind_dir - runway_heading)))
// ------------------------------------------------------------
export function calculateCrosswind(windSpdKts: number, windDir: number, runwayHeading: number): number {
  if (windSpdKts == null || windDir == null || Number.isNaN(windSpdKts) || Number.isNaN(windDir)) {
    return 0;
  }
  const diff = (windDir - runwayHeading) * (Math.PI / 180); // 라디안
  const crosswind = Math.abs(windSpdKts * Math.sin(diff));
  return Math.round(crosswind * 10) / 10; // 소수 첫째 자리
}

// ------------------------------------------------------------
// 4. 강수 제한 판정 (METAR weather_desc 토큰 기반)
//    precip_restricted 기종은 RA(비)/SN(눈)/DZ(이슬비)/SG(싸락눈)/IC(얼음결정)
//    /FZRA(어는비)/GR(우박)/TS(뇌우) 감지 시 제한.
// ------------------------------------------------------------
const PRECIP_TOKENS = ['RA', 'SN', 'DZ', 'SG', 'IC', 'FZRA', 'GR', 'TS', 'PL'];

function hasPrecipitation(weatherDesc: string): boolean {
  const desc = (weatherDesc ?? '').toUpperCase();
  return PRECIP_TOKENS.some((tok) => desc.includes(tok));
}

// ------------------------------------------------------------
// 5. Go/No-Go 판정 — AMWS 로직 + DELPHI MARGINAL 확장
//    한계치의 90% 영역(relevancyZone)은 회색구간으로 MARGINAL 분류.
// ------------------------------------------------------------
const MARGINAL_THRESHOLD = 0.9; // 한계치의 90% 이상 100% 미만 = MARGINAL

export function evaluateGoNoGo(
  weather: {
    windDir: number;
    windSpdKts: number;
    visibilityM: number;
    ceilingFt: number;
    precip?: string;
  },
  runwayHeading: number,
  aircraftSpec: AircraftSpec,
): { result: 'GO' | 'NO-GO' | 'MARGINAL'; reasons: string[]; crosswindKts: number } {
  const crosswind = calculateCrosswind(weather.windSpdKts, weather.windDir, runwayHeading);
  const reasons: string[] = [];
  const marginalReasons: string[] = [];

  // (a) 측풍 — 높을수록 위험
  if (crosswind > aircraftSpec.max_crosswind_kts) {
    reasons.push(`측풍 초과 (${crosswind.toFixed(1)} > ${aircraftSpec.max_crosswind_kts} kt)`);
  } else if (crosswind >= aircraftSpec.max_crosswind_kts * MARGINAL_THRESHOLD) {
    marginalReasons.push(
      `측풍 경계 (${crosswind.toFixed(1)} / ${aircraftSpec.max_crosswind_kts} kt)`,
    );
  }

  // (b) 시정 — 낮을수록 위험
  if (weather.visibilityM < aircraftSpec.min_visibility_m) {
    reasons.push(`시정 미달 (${weather.visibilityM} < ${aircraftSpec.min_visibility_m} m)`);
  } else if (weather.visibilityM < aircraftSpec.min_visibility_m / MARGINAL_THRESHOLD) {
    marginalReasons.push(
      `시정 경계 (${weather.visibilityM} / ${aircraftSpec.min_visibility_m} m)`,
    );
  }

  // (c) 운고 — 낮을수록 위험
  if (weather.ceilingFt < aircraftSpec.min_ceiling_ft) {
    reasons.push(`운고 부족 (${weather.ceilingFt} < ${aircraftSpec.min_ceiling_ft} ft)`);
  } else if (weather.ceilingFt < aircraftSpec.min_ceiling_ft / MARGINAL_THRESHOLD) {
    marginalReasons.push(
      `운고 경계 (${weather.ceilingFt} / ${aircraftSpec.min_ceiling_ft} ft)`,
    );
  }

  // (d) 강수 제한
  if (aircraftSpec.precip_restricted && hasPrecipitation(weather.precip ?? '')) {
    reasons.push(`강수 제한 (${weather.precip ?? '강수 감지'})`);
  }

  // 판정 집계: 하드 위반 → NO-GO, 경계만 → MARGINAL, 모두 양호 → GO
  let result: 'GO' | 'NO-GO' | 'MARGINAL';
  if (reasons.length > 0) {
    result = 'NO-GO';
  } else if (marginalReasons.length > 0) {
    result = 'MARGINAL';
    reasons.push(...marginalReasons);
  } else {
    result = 'GO';
  }

  return { result, reasons, crosswindKts: crosswind };
}

// ------------------------------------------------------------
// 6. 기지 전체 매트릭스 산출 (모든 기종 × 단일 기상 관측)
//    /api/weather 및 Mission Briefing "기상" 섹션에서 사용.
// ------------------------------------------------------------
export function evaluateBaseMatrix(
  weather: WeatherObservation,
  runwayHeading: number,
  specs: AircraftSpec[] = loadAircraftSpecs(),
): GoNoGoResult[] {
  return specs.map((spec) => {
    const verdict = evaluateGoNoGo(
      {
        windDir: weather.wind_dir,
        windSpdKts: weather.wind_spd_kts,
        visibilityM: weather.visibility_m,
        ceilingFt: weather.ceiling_ft,
        precip: weather.weather_desc,
      },
      runwayHeading,
      spec,
    );
    return {
      aircraft_id: spec.aircraft_id,
      result: verdict.result,
      crosswind_kts: verdict.crosswindKts,
      reasons: verdict.reasons,
    };
  });
}
