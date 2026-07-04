import { NextRequest, NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/claude';
import { searchSimilarCases, formatCasesForPrompt } from '@/lib/rag';
import { runInference } from '@/lib/bayesian';
import { structureReport } from '@/lib/spuq';
import { TimelineEvent, ThreatAsset, ActionClass, Hypothesis } from '@/types';
import hypothesesData from '@/data/hypotheses.json';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scenarioId, currentTime, threats, events } = body;

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

    // === RAG: 과거 사례 검색 ===
    const similarCases = await searchSimilarCases(indicators);
    const historicalContext = formatCasesForPrompt(similarCases);

    // === 보고 계층: 대형 LLM으로 종합 보고서 생성 ===
    const currentSituation = `
시나리오: ${scenarioId === 'scenario-a' ? '탄도미사일 발사 징후' : 'SEAD/방공망 제압'}
경과 시간: ${Math.floor(currentTime / 60)}분
확인된 위협: ${(threats as ThreatAsset[]).map((t) => `${t.name}(${t.status})`).join(', ')}
탐지된 징후: ${indicators.join(' → ')}

[베이지안 추론 결과]
최고 가설: ${inferenceResult.topHypothesis?.name || 'N/A'} (확률: ${((inferenceResult.topHypothesis?.posterior || 0) * 100).toFixed(1)}%)
불확실성: ${((inferenceResult.topHypothesis?.uncertainty || 0) * 100).toFixed(1)}%
상위 가설:
${inferenceResult.hypotheses.slice(0, 3).map((h) => `- ${h.name}: ${(h.posterior * 100).toFixed(1)}%`).join('\n')}
증거 수: ${inferenceResult.evidenceCount}
`;

    // Try Claude API, fallback to structured result
    let parsed = null;
    try {
      const aiResponse = await generateBriefing(currentSituation, historicalContext);
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      // Claude API 미설정 시 추론 엔진 결과로 폴백
    }

    const topH = inferenceResult.topHypothesis;
    const result = {
      summary: parsed?.summary || `베이지안 추론 결과: ${topH?.name || '분석 중'} 가설이 ${((topH?.posterior || 0) * 100).toFixed(0)}% 확률로 가장 유력합니다.`,
      threatAssessment: parsed?.threatAssessment || `상위 가설: ${inferenceResult.hypotheses.slice(0, 3).map((h) => `${h.name}(${(h.posterior * 100).toFixed(0)}%)`).join(', ')}`,
      confidence: parsed?.confidence || Math.round((1 - (topH?.uncertainty || 0.5)) * 100),
      launchProbability: parsed?.launchProbability || (topH?.category === 'missile_launch' ? Math.round((topH?.posterior || 0) * 100) : undefined),
      recommendations: parsed?.recommendations || ['추론 엔진 결과 기반 자동 생성'],
      historicalCases: similarCases,
      inferenceResult,
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
