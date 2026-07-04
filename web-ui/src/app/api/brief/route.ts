import { NextRequest, NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/claude';
import { searchSimilarCases, formatCasesForPrompt } from '@/lib/rag';
import { resolveFacility, resolveMissile, formatEntitiesForPrompt } from '@/lib/ontology';
import { mapDoctrineContext, formatDoctrineForPrompt } from '@/lib/doctrine';
import { runInference } from '@/lib/bayesian';
import { structureReport } from '@/lib/spuq';
import { TimelineEvent, ThreatAsset, ActionClass, Hypothesis } from '@/types';
import hypothesesData from '@/data/hypotheses.json';
import briefingSnapshots from '@/data/mock/briefing-snapshots.json';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scenarioId, currentTime, threats, events, phaseId } = body;

    // Get current indicators from events
    const visibleEvents: TimelineEvent[] = events || [];
    const indicators = visibleEvents.map((e: TimelineEvent) => e.title);

    // === 정형화 계층: 이벤트를 액션 클래스로 변환 ===
    const actions: ActionClass[] = visibleEvents.map((event, i) => {
      return structureReport(
        `${event.title}: ${event.description}`,
        event.actionId || `event-${i}`,
        event.actionClass || 'IMINT',
        0.8, // 시나리오 데이터의 기본 확신도
        event.time
      );
    });

    // === 추론 계층: 베이지안 추론 실행 ===
    const hypotheses = hypothesesData as unknown as Hypothesis[];
    const inferenceResult = runInference(actions, hypotheses);
    const topH = inferenceResult.topHypothesis;

    // === RAG: 과거 사례 검색 ===
    const similarCases = await searchSimilarCases(indicators);
    const historicalContext = formatCasesForPrompt(similarCases);

    // === 온톨로지: 징후 텍스트에서 정규 엔티티(시설·미사일 체계) 해석 ===
    const observationText = visibleEvents
      .map((e) => `${e.title}: ${e.description ?? ''}`)
      .join('\n');
    const resolvedFacilities = resolveFacility(observationText);
    const resolvedMissiles = resolveMissile(observationText);
    const entityContext = formatEntitiesForPrompt({
      facilities: resolvedFacilities,
      missiles: resolvedMissiles,
    });

    // === 교리 연동 (Track B): 추론 결과 → WATCHCON/킬체인/대응옵션/C2/ROE 매핑 ===
    // 발사 탐지 여부: 타임라인에 launch/strike 이벤트가 보이거나 극단적 고확률이면 true.
    const launchDetected =
      visibleEvents.some((e) => e.type === 'launch' || e.type === 'strike') ||
      (topH != null && topH.category === 'missile_launch' && topH.posterior >= 0.9);
    const doctrineContext = mapDoctrineContext({
      topPosterior: topH?.posterior ?? 0,
      topCategory: topH?.category,
      uncertainty: topH?.uncertainty,
      evidenceCount: inferenceResult.evidenceCount,
      launchDetected,
      scenarioId,
      phaseId,
    });
    const doctrineContextText = doctrineContext ? formatDoctrineForPrompt(doctrineContext) : '';

    // === 보고 계층: 대형 LLM으로 종합 보고서 생성 ===
    const currentSituation = `
시나리오: ${scenarioId === 'scenario-a' ? '우주발사체(정찰위성) 발사 징후 — 동창리 [Rule#1]' : '고체연료 단거리(SRBM) 발사 징후 — 알섬 표적 [Rule#4]'}
경과 시간: ${Math.floor(currentTime / 60)}분
확인된 위협: ${(threats as ThreatAsset[]).map((t) => `${t.name}(${t.status})`).join(', ')}
탐지된 징후: ${indicators.join(' → ')}

[베이지안 추론 결과]
최고 가설: ${inferenceResult.topHypothesis?.name || 'N/A'} (확률: ${((inferenceResult.topHypothesis?.posterior || 0) * 100).toFixed(1)}%)
불확실성: ${((inferenceResult.topHypothesis?.uncertainty || 0) * 100).toFixed(1)}%
상위 가설:
${inferenceResult.hypotheses.slice(0, 3).map((h) => `- ${h.name}: ${(h.posterior * 100).toFixed(1)}%`).join('\n')}
증거 수: ${inferenceResult.evidenceCount}

[온톨로지 정규 엔티티 해석]
${entityContext || '(탐지된 정규 시설/미사일 체계 없음)'}

${doctrineContextText}
`;

    // Try Claude API, then phase snapshot fallback, then inference-based fallback
    let parsed = null;
    try {
      const aiResponse = await generateBriefing(currentSituation, historicalContext);
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      // Claude API 미설정 시 스냅샷 폴백
    }

    // Phase-based snapshot fallback when Claude API unavailable
    const snapshotKey = phaseId != null ? `${scenarioId}-phase-${phaseId}` : null;
    const snapshot = snapshotKey ? (briefingSnapshots as Record<string, unknown>)[snapshotKey] as typeof parsed : null;

    const fallback = snapshot || null;
    const result = {
      summary: parsed?.summary || fallback?.summary || `베이지안 추론 결과: ${topH?.name || '분석 중'} 가설이 ${((topH?.posterior || 0) * 100).toFixed(0)}% 확률로 가장 유력합니다.`,
      threatAssessment: parsed?.threatAssessment || fallback?.threatAssessment || `상위 가설: ${inferenceResult.hypotheses.slice(0, 3).map((h) => `${h.name}(${(h.posterior * 100).toFixed(0)}%)`).join(', ')}`,
      confidence: parsed?.confidence || fallback?.confidence || Math.round((1 - (topH?.uncertainty || 0.5)) * 100),
      launchProbability: parsed?.launchProbability || fallback?.launchProbability || (topH?.category === 'missile_launch' ? Math.round((topH?.posterior || 0) * 100) : undefined),
      recommendations: parsed?.recommendations || fallback?.recommendations || ['추론 엔진 결과 기반 자동 생성'],
      historicalCases: similarCases,
      inferenceResult,
      resolvedEntities: {
        facilities: resolvedFacilities.map((f) => ({ canonicalName: f.canonicalName, facilityType: f.facilityType, matchedAlias: f.matchedAlias, lat: f.lat, lng: f.lng })),
        missiles: resolvedMissiles.map((m) => ({ canonicalName: m.canonicalName, kn: m.kn, weaponClass: m.weaponClass, matchedAlias: m.matchedAlias, rangeKm: m.rangeKm })),
      },
      doctrineContext,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Briefing API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate briefing' },
      { status: 500 }
    );
  }
}
