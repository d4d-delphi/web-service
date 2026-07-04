import { NextRequest, NextResponse } from 'next/server';
import { resolveFacility, resolveMissile } from '@/lib/ontology';
import { searchSimilarCases } from '@/lib/rag';
import { mapDoctrineContext, formatDoctrineForPrompt } from '@/lib/doctrine';
import { generateBriefing } from '@/lib/claude';
import {
  UseCase,
  UseCaseCategory,
  CopilotContextResponse,
  HistoricalCase,
} from '@/types';
import useCasesData from '@/data/use-cases.json';

// ============================================================
// 지휘관 AI 코파일럿 Use Case API (Session 3)
// GET  : 유스케이스 목록(필터: category/difficulty/scenario)
// POST : { id } → 해당 유스케이스의 "지휘관 질의 → AI 답변" 컨텍스트 조립.
//        온톨로지 정규엔티티 해석 + RAG 과거사례 + 교리 매핑 + 아군 가용자산 +
//        프롬프트 템플릿. Claude API 키 불필요(폴백: 컨텍스트/템플릿만 반환).
// ============================================================

const ALL_USE_CASES = useCasesData as unknown as UseCase[];
const ILLUSTRATIVE_NOTE =
  '코파일럿 컨텍스트는 공개 교리 개념·온톨로지·RAG 사례를 결합한 데모용. ' +
  '임계값/수치는 illustrative stub이며 실 운용 체계연동이 아님.';

// 시나리오별 대표 사후확률(데모용) — mapDoctrineContext 에 주입해 watchcon/킬체인/ROE 산출.
// 실運用에서는 /api/infer 의 베이지안 사후확률을 넘겨받아 동적 산출한다.
const REPRESENTATIVE_POSTERIOR: Record<UseCase['scenario'], number> = {
  A: 0.6,    // 동창리 SLV: 발사임박(decide 임계 0.65 직전) 상황 가정
  B: 0.55,   // 고체 SRBM 알섬: 비상(0.5) 통과 상황 가정
  general: 0.4, // 일반 질의: 경계(0.25)~비상(0.5) 사이
};

// GET /api/copilot — 유스케이스 목록
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const category = searchParams.get('category') as UseCaseCategory | null;
  const difficulty = searchParams.get('difficulty');
  const scenario = searchParams.get('scenario');

  let list = ALL_USE_CASES;
  if (category) list = list.filter((u) => u.category === category);
  if (difficulty) list = list.filter((u) => String(u.difficulty) === difficulty);
  if (scenario) list = list.filter((u) => u.scenario === scenario);

  // 메타 요약(카테고리 분포 등)
  const byCategory = ALL_USE_CASES.reduce<Record<string, number>>((acc, u) => {
    acc[u.category] = (acc[u.category] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    count: list.length,
    total: ALL_USE_CASES.length,
    byCategory,
    useCases: list,
  });
}

// POST /api/copilot { id } — 컨텍스트 조립
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id: string | undefined = body?.id;
    if (!id) {
      return NextResponse.json(
        { error: 'id required (e.g. { "id": "UC-IND-01" })' },
        { status: 400 }
      );
    }

    const useCase = ALL_USE_CASES.find((u) => u.id === id);
    if (!useCase) {
      return NextResponse.json(
        { error: `use case not found: ${id}`, availableIds: ALL_USE_CASES.map((u) => u.id) },
        { status: 404 }
      );
    }

    // === 1. 온톨로지 정규 엔티티 해석 ===
    // 질의 + requiredData(정규명/indicators/사례)를 합쳐 최대한 엔티티를 잡아낸다.
    const rd = useCase.requiredData ?? {};
    const resolutionText = [
      useCase.question,
      useCase.expectedReasoning,
      ...(rd.facilities ?? []),
      ...(rd.missiles ?? []),
      ...(rd.ragIndicators ?? []),
      ...(rd.historicalCases ?? []),
      rd.ruleRef ?? '',
    ].join('\n');

    const facilities = resolveFacility(resolutionText).map((f) => ({
      canonicalName: f.canonicalName,
      matchedAlias: f.matchedAlias,
      facilityType: f.facilityType ?? null,
      lat: f.lat ?? null,
      lng: f.lng ?? null,
    }));
    const missiles = resolveMissile(resolutionText).map((m) => ({
      canonicalName: m.canonicalName,
      matchedAlias: m.matchedAlias,
      kn: m.kn ?? null,
      weaponClass: m.weaponClass ?? null,
      rangeKm: m.rangeKm ?? null,
    }));

    // === 2. RAG 과거사례 검색 ===
    const indicators = rd.ragIndicators ?? extractKeywords(useCase);
    const similarCases = await searchSimilarCases(indicators);

    // === 3. 교리 매핑 (대표 사후확률 기반) ===
    const posterior = REPRESENTATIVE_POSTERIOR[useCase.scenario] ?? 0.4;
    const doctrineContext = mapDoctrineContext({
      topPosterior: posterior,
      topCategory: 'missile_launch',
      uncertainty: 0.25,
      evidenceCount: Math.max(indicators.length, 2),
      launchDetected: false,
      scenarioId: useCase.scenario === 'general' ? undefined : useCase.scenario === 'A' ? 'scenario-a' : 'scenario-b',
    });
    const doctrineText = doctrineContext ? formatDoctrineForPrompt(doctrineContext) : '';

    // === 4. 프롬프트 조립 ===
    const prompt = buildPrompt(useCase, {
      facilities: facilities.map((f) => f.canonicalName),
      missiles: missiles.map((m) => `${m.canonicalName}${m.kn ? `(${m.kn})` : ''}`),
      similarCases,
      doctrineText,
      posterior,
    });

    // === 5. LLM 호출(키 불필요 폴백) ===
    let llmAnswer: string | null = null;
    try {
      // generateBriefing 은 ANTHROPIC_API_KEY 환경이 없으면 예외 → 폴백.
      const historicalContext = similarCases
        .slice(0, 5)
        .map(
          (c) =>
            `- ${c.title} (${c.date}, ${c.missileType}): ${c.indicators?.join(', ') ?? ''} → ${c.outcome}`
        )
        .join('\n');
      llmAnswer = await generateBriefing(prompt, historicalContext);
    } catch {
      llmAnswer = null; // Claude API 미설정 — 컨텍스트/템플릿만 반환
    }

    // NOTE: 엄격 타입 단언을 피해 brief/route.ts 패턴대로 객체를 조립해 반환한다.
    // (lib/doctrine 가 재선언한 DoctrineResponseOption.pillar:string 과 @/types 의
    //  리터럴 union 이 구조적으로 충돌하므로, CopilotContextResponse 는 API 소비
    //  문서용으로만 노출하고 런타임 객체는 추론에 맡긴다.)
    const response = {
      useCase,
      query: useCase.question,
      resolvedEntities: { facilities, missiles },
      similarCases: (similarCases as HistoricalCase[]).slice(0, 8),
      readyAssets: doctrineContext?.readyAssets ?? [],
      doctrineContext,
      prompt,
      answerSketch: useCase.idealAnswerSketch,
      llmAnswer,
      note: ILLUSTRATIVE_NOTE,
    };

    return NextResponse.json(response as CopilotContextResponse);
  } catch (error) {
    console.error('Copilot API error:', error);
    return NextResponse.json({ error: 'Failed to build copilot context' }, { status: 500 });
  }
}

// --- 헬퍼: requiredData 에서 RAG indicator 가 없을 때 질의 키워드 추출 ---
function extractKeywords(useCase: UseCase): string[] {
  const rd = useCase.requiredData ?? {};
  const pool = [
    ...(rd.missiles ?? []),
    ...(rd.facilities ?? []),
    ...(rd.friendlyAssets ?? []),
    ...(rd.orbatUnits ?? []),
  ];
  if (pool.length === 0) {
    // 카테고리 기반 기본 indicator
    const fallback: Record<UseCaseCategory, string[]> = {
      '징후해석': ['발사 징후', 'TEL 전개', 'NOTAM'],
      '전례매칭': ['발사 사례', '과거 패턴'],
      '발사임박성': ['발사 확률', '사후확률'],
      '대응권고': ['요격 자산', '타격 자산'],
      'ROE': ['교전규칙', '자위권'],
      '아군가용성': ['방공 자산', '요격'],
      '교차검증': ['SIGINT', 'IMINT', '교차 검증'],
    };
    return fallback[useCase.category];
  }
  return pool;
}

// --- 헬퍼: "지휘관 질의 → AI 답변" 프롬프트 빌더 ---
function buildPrompt(
  useCase: UseCase,
  ctx: {
    facilities: string[];
    missiles: string[];
    similarCases: HistoricalCase[];
    doctrineText: string;
    posterior: number;
  }
): string {
  const caseLines = ctx.similarCases
    .slice(0, 5)
    .map(
      (c) =>
        `- ${c.title} (${c.date}, ${c.missileType}): ${(c.indicators ?? []).join(', ')} → ${c.outcome}`
    )
    .join('\n');

  return `당신은 대한민국 합동참모본부 지휘관 AI 코파일럿입니다. 아래 지휘관 질의에 대해
추론 경로를 명시하고, 가용 데이터(온톨로지·교리·과거사례·아군 자산)를 근거로 답변하라.

## 지휘관 질의 [카테고리: ${useCase.category} / 난이도: ${useCase.difficulty} / 시나리오: ${useCase.scenario}]
${useCase.question}

## 기대 추론 경로(참고용, 그대로 답하지 말 것)
${useCase.expectedReasoning}

## 정규 엔티티(온톨로지 매핑 결과)
- 시설: ${ctx.facilities.join(', ') || '(탐지 안 됨)'}
- 미사일 체계: ${ctx.missiles.join(', ') || '(탐지 안 됨)'}

## 과거 유사 사례(RAG)
${caseLines || '(매칭 사례 없음)'}

## 아군 교리 매핑(대표 사후확률 ${(ctx.posterior * 100).toFixed(0)}%)
${ctx.doctrineText || '(교리 미러 부재)'}

## 출력 형식
1. 핵심 답변 (2~3문장)
2. 추론 근거 (끌어온 데이터/교리/사례 명시)
3. 불확실성·negative evidence
4. 즉시 권고 조치 (3개 이내)
JSON: { "answer": "...", "reasoning": "...", "uncertainties": "...", "recommendations": ["..."] }`;
}
