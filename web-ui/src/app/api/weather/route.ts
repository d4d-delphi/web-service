import { NextRequest, NextResponse } from 'next/server';
import type { WeatherResult, WeatherMatrixEntry } from '@/types';
import {
  AIRBASES,
  loadAircraftSpecs,
  evaluateBaseMatrix,
  getAirbase,
} from '@/lib/weather';
import { simulateWeather, buildWeatherObservation, formatWeatherForBriefing } from '@/lib/wxint';

// ============================================================
// GET /api/weather — 기상 Go/No-Go 판정 매트릭스
//
// 쿼리 파라미터:
//   ?base=K-2         단일 기지 결과만 반환
//   ?briefing=true    Mission Briefing "기상" 섹션용 텍스트(briefing 필드)
//
// 기상 데이터는 현재 시뮬레이션(simulateWeather). 폐쇄막 실운용에서는
// 별도 기상 API 연동으로 대체(본 라우트는 도메인 로직 + 직렬화만 담당).
// ============================================================

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const baseFilter = sp.get('base'); // 예: K-2
  const briefing = sp.get('briefing') === 'true';

  const targets = baseFilter
    ? AIRBASES.filter((b) => b.base_id === baseFilter)
    : AIRBASES;

  if (baseFilter && targets.length === 0) {
    return NextResponse.json(
      { error: `알 수 없는 기지: ${baseFilter}`, available: AIRBASES.map((b) => b.base_id) },
      { status: 404 },
    );
  }

  const specs = loadAircraftSpecs();
  const entries: WeatherMatrixEntry[] = targets.map((airbase) => {
    const weather = simulateWeather(airbase.base_id);
    const perAircraft = evaluateBaseMatrix(weather, airbase.runway_heading, specs);
    return {
      base_id: airbase.base_id,
      base_name: airbase.base_name,
      runway_heading: airbase.runway_heading,
      obs_time: weather.obs_time,
      weather,
      per_aircraft: perAircraft,
    };
  });

  // briefing 모드: 기지별 WXINT observation + 한글 요약 텍스트
  if (briefing) {
    const sections = entries.map((e) => {
      const airbase = getAirbase(e.base_id)!;
      const obs = buildWeatherObservation(e.weather, airbase);
      const text = formatWeatherForBriefing(e.weather, airbase);
      return { base: e.base_name, observation: obs, briefing: text };
    });
    return NextResponse.json({ generated_at: new Date().toISOString(), sections });
  }

  const result: WeatherResult = {
    generated_at: new Date().toISOString(),
    bases: entries,
  };
  return NextResponse.json(result);
}
