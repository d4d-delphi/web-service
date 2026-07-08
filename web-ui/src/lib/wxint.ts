import type { ActionClass, WeatherObservation, Airbase } from '@/types';
import {
  AIRBASES,
  evaluateBaseMatrix,
  loadAircraftSpecs,
  calculateCrosswind,
} from '@/lib/weather';

// ============================================================
// WXINT observation 생성 헬퍼
//
// DELPHI의 facts-only 원칙을 준수하여 기상 데이터를 액션클래스로 변환:
//   - facts (사실): "측풍 25.0kt, 시정 800m, 운고 200ft" (측정값)
//   - 추론 (판정): "출격 불가" ← 도메인 로직(weather.ts)이 산출, observation에는
//                 메타로 부착하되 rawReport는 facts-only를 유지.
//
// Mission Briefing "기상" 섹션은 facts + per-aircraft 판정을 직렬화하여 제공.
// ============================================================

// WXINT observation 에 추가할 기상 facts 필드
export interface WeatherFacts {
  wind_dir: number;
  wind_spd_kts: number;
  crosswind_kts: number;
  visibility_m: number;
  ceiling_ft: number;
  weather_desc: string;
  runway_heading: number;
}

// 단일 기지 기상 → facts-only WXINT ActionClass 생성
export function buildWeatherObservation(
  weather: WeatherObservation,
  airbase: Airbase,
): ActionClass {
  const xwind = calculateCrosswind(weather.wind_spd_kts, weather.wind_dir, airbase.runway_heading);

  // facts-only 원문 — 측정값만, 판단어 배제
  const rawReport =
    `기상 관측(${airbase.base_name}/${airbase.base_id}): ` +
    `풍향 ${weather.wind_dir}°, 풍속 ${weather.wind_spd_kts}kt, ` +
    `측풍 ${xwind.toFixed(1)}kt, ` +
    `시정 ${weather.visibility_m}m, 운고 ${weather.ceiling_ft}ft, ` +
    `현상 ${weather.weather_desc || '없음'}`;

  return {
    id: `wxint-${airbase.base_id}-${weather.obs_time}`,
    classType: 'WXINT',
    timestamp: weather.obs_time,
    source: 'AMWS 기상 서브시스템(시뮬레이션)',
    rawReport,
    confidence: 0.95, // 관측값 자체는 고신뢰; 판정은 별도 도메인 로직
    fieldUncertainty: {
      wind_spd_kts: 0.05,
      visibility_m: 0.1,
      ceiling_ft: 0.1,
    },
    analystConfidence: 0.95,
    fields: {
      base_id: airbase.base_id,
      base_name: airbase.base_name,
      runway_heading: airbase.runway_heading,
      wind_dir: weather.wind_dir,
      wind_spd_kts: weather.wind_spd_kts,
      crosswind_kts: Number(xwind.toFixed(1)),
      visibility_m: weather.visibility_m,
      ceiling_ft: weather.ceiling_ft,
      weather_desc: weather.weather_desc,
    },
  };
}

// ------------------------------------------------------------
// Mission Briefing "기상" 섹션용 직렬화
// facts + 기종별 판정을 한글 간결 문장으로 조합.
// ------------------------------------------------------------
export function formatWeatherForBriefing(
  weather: WeatherObservation,
  airbase: Airbase,
): string {
  const specs = loadAircraftSpecs();
  const matrix = evaluateBaseMatrix(weather, airbase.runway_heading, specs);
  const xwind = calculateCrosswind(weather.wind_spd_kts, weather.wind_dir, airbase.runway_heading);

  const goList = matrix.filter((m) => m.result === 'GO').map((m) => m.aircraft_id);
  const noGoList = matrix
    .filter((m) => m.result === 'NO-GO')
    .map((m) => `${m.aircraft_id}(${m.reasons.join('/')})`);
  const marginalList = matrix.filter((m) => m.result === 'MARGINAL').map((m) => m.aircraft_id);

  const lines: string[] = [
    `[${airbase.base_name} RWY ${airbase.runway_heading}°] 측풍 ${xwind.toFixed(1)}kt, 시정 ${weather.visibility_m}m, 운고 ${weather.ceiling_ft}ft, 현상 ${weather.weather_desc || '없음'}`,
  ];
  if (goList.length) lines.push(`- GO: ${goList.join(', ')}`);
  if (marginalList.length) lines.push(`- MARGINAL: ${marginalList.join(', ')}`);
  if (noGoList.length) lines.push(`- NO-GO: ${noGoList.join(', ')}`);
  return lines.join('\n');
}

// ------------------------------------------------------------
// 데모/시뮬레이션용 더미 기상 데이터 생성기
// 폐쇄막에서는 실제 기상 API 연동으로 대체(별도 작업).
// ------------------------------------------------------------
export function simulateWeather(baseId: string): WeatherObservation {
  const airbase = AIRBASES.find((b) => b.base_id === baseId) ?? AIRBASES[0];
  const now = new Date().toISOString();
  // 결정론적 시드(baseId 해시) → PR마다 값이 튀지 않는 안정적 데모 데이터
  const seed = baseId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const windDir = Math.round(rand(1) * 360);
  const windSpd = Math.round(rand(2) * 35); // 0~35kt
  const visibility = Math.round(400 + rand(3) * 8000); // 400~8400m
  const ceiling = Math.round(100 + rand(4) * 4000); // 100~4100ft
  const descPool = ['SKC', 'FEW', 'SCT', 'BKN', 'OVC', 'RA', 'SN', 'FG', 'TS'];
  const weather_desc = descPool[Math.floor(rand(5) * descPool.length)];

  return {
    base_id: airbase.base_id,
    obs_time: now,
    wind_dir: windDir,
    wind_spd_kts: windSpd,
    visibility_m: visibility,
    ceiling_ft: ceiling,
    weather_desc,
  };
}
