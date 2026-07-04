import { ActionClass, Hypothesis, HypothesisNode, InferenceResult, EvidenceContribution } from '@/types';

/**
 * 베이지안 추론 엔진
 *
 * P(H|E₁,E₂,...,Eₙ) ∝ P(H) × ∏ P(Eᵢ|H) × w(cᵢ)
 *
 * - P(H): 가설의 사전확률
 * - P(Eᵢ|H): 가설 H 하에서 징후 Eᵢ의 우도
 * - w(cᵢ): SPUQ 확신도 기반 가중치
 */

// 확신도를 가중치로 변환 (낮은 확신도 = 약한 증거)
function confidenceWeight(confidence: number): number {
  // confidence가 낮으면 증거의 영향력을 줄임
  // w(c) = c^α where α controls sensitivity
  const alpha = 0.5;
  return Math.pow(Math.max(confidence, 0.01), alpha);
}

// 단일 증거에 대한 우도 계산
function getLikelihood(
  action: ActionClass,
  hypothesis: Hypothesis
): number {
  // 액션의 패턴 키 생성 (클래스타입 + 주요 필드값 조합)
  const patternKeys = generatePatternKeys(action);

  let maxLikelihood = 0.1; // 기본 우도 (매칭 없을 때)

  for (const key of patternKeys) {
    if (hypothesis.likelihoodMap[key] !== undefined) {
      maxLikelihood = Math.max(maxLikelihood, hypothesis.likelihoodMap[key]);
    }
  }

  return maxLikelihood;
}

// 액션에서 패턴 키 생성
function generatePatternKeys(action: ActionClass): string[] {
  const keys: string[] = [];

  // 기본: 클래스 타입
  keys.push(action.classType);

  // 클래스타입 + 주요 필드 조합
  if (action.fields) {
    for (const [fieldName, fieldValue] of Object.entries(action.fields)) {
      if (fieldValue && typeof fieldValue === 'string') {
        keys.push(`${action.classType}:${fieldName}:${fieldValue}`);
      }
    }
    // 특정 필드값만으로도 매칭
    if (action.fields.objectType) {
      keys.push(`object:${action.fields.objectType}`);
    }
    if (action.fields.activity) {
      keys.push(`activity:${action.fields.activity}`);
    }
    if (action.fields.signalType) {
      keys.push(`signal:${action.fields.signalType}`);
    }
  }

  return keys;
}

// 베이지안 추론 실행
export function runInference(
  actions: ActionClass[],
  hypotheses: Hypothesis[]
): InferenceResult {
  if (actions.length === 0 || hypotheses.length === 0) {
    return {
      hypotheses: [],
      topHypothesis: null,
      overallConfidence: 0,
      updatedAt: new Date().toISOString(),
      evidenceCount: 0,
      evidenceContributions: [],
    };
  }

  // 각 가설에 대해 사후확률 계산
  const posteriors: HypothesisNode[] = hypotheses.map((h) => {
    let logPosterior = Math.log(h.priorProbability);
    const evidenceChain: string[] = [];

    for (const action of actions) {
      const likelihood = getLikelihood(action, h);
      const weight = confidenceWeight(action.confidence);

      // 가중된 로그 우도 누적
      // weighted likelihood: L_weighted = L^w (w=1이면 full evidence, w→0이면 no evidence)
      const weightedLogLikelihood = weight * Math.log(likelihood);
      logPosterior += weightedLogLikelihood;

      // 유의미한 증거만 체인에 추가
      if (likelihood > 0.3) {
        evidenceChain.push(action.id);
      }
    }

    const rawPosterior = Math.exp(logPosterior);

    return {
      id: h.id,
      name: h.name,
      category: h.category,
      prior: h.priorProbability,
      posterior: rawPosterior,
      uncertainty: calculateUncertainty(actions, h),
      evidenceChain,
    };
  });

  // 정규화
  const totalPosterior = posteriors.reduce((sum, p) => sum + p.posterior, 0);
  if (totalPosterior > 0) {
    posteriors.forEach((p) => {
      p.posterior = p.posterior / totalPosterior;
    });
  }

  // 정렬 (높은 확률 순)
  posteriors.sort((a, b) => b.posterior - a.posterior);

  const topHypothesis = posteriors.length > 0 ? posteriors[0] : null;
  const overallConfidence = topHypothesis
    ? topHypothesis.posterior * (1 - topHypothesis.uncertainty)
    : 0;

  // 최유력 가설에 대한 각 증거의 기여도 계산
  // logOdds_i = w_i × ( log L_i(H*) − log(전체 가설 평균 우도) )
  // → 양수면 해당 증거가 H*를 다른 가설 대비 지지함
  const evidenceContributions = computeContributions(actions, hypotheses, topHypothesis);

  return {
    hypotheses: posteriors,
    topHypothesis,
    overallConfidence,
    updatedAt: new Date().toISOString(),
    evidenceCount: actions.length,
    evidenceContributions,
  };
}

// 최유력 가설(H*)에 대한 개별 증거의 판별 기여도 산출
function computeContributions(
  actions: ActionClass[],
  hypotheses: Hypothesis[],
  topHypothesis: HypothesisNode | null
): EvidenceContribution[] {
  if (!topHypothesis) return [];
  const topH = hypotheses.find((h) => h.id === topHypothesis.id);
  if (!topH) return [];

  const raw = actions.map((action) => {
    const likelihood = getLikelihood(action, topH);
    const weight = confidenceWeight(action.confidence);
    // 전체 가설에 대한 평균 우도 (baseline)
    const avgLikelihood =
      hypotheses.reduce((sum, h) => sum + getLikelihood(action, h), 0) / hypotheses.length;
    const logOdds = weight * (Math.log(likelihood) - Math.log(avgLikelihood));
    return { actionId: action.id, likelihood, weight, logOdds };
  });

  // 양의 기여분만 정규화하여 상대적 비중(%) 산출
  const totalPositive = raw.reduce((sum, r) => sum + Math.max(0, r.logOdds), 0);
  return raw.map((r) => ({
    ...r,
    contribution: totalPositive > 0 ? Math.max(0, r.logOdds) / totalPositive : 0,
  }));
}

// 불확실성 계산: 증거의 SPUQ 불확실성 종합
function calculateUncertainty(
  actions: ActionClass[],
  hypothesis: Hypothesis
): number {
  if (actions.length === 0) return 1.0;

  // 관련 증거의 평균 불확실성
  let totalUncertainty = 0;
  let relevantCount = 0;

  for (const action of actions) {
    const likelihood = getLikelihood(action, hypothesis);
    if (likelihood > 0.2) {
      // 필드 불확실성의 평균
      const fieldUncertainties = Object.values(action.fieldUncertainty);
      const avgFieldUncertainty = fieldUncertainties.length > 0
        ? fieldUncertainties.reduce((a, b) => a + b, 0) / fieldUncertainties.length
        : 0.5;

      // 분류 불확실성과 필드 불확실성 결합
      const actionUncertainty = 1 - action.confidence * (1 - avgFieldUncertainty);
      totalUncertainty += actionUncertainty;
      relevantCount++;
    }
  }

  if (relevantCount === 0) return 0.9; // 관련 증거 없으면 높은 불확실성

  // 증거가 많을수록 불확실성 감소 (but never zero)
  const avgUncertainty = totalUncertainty / relevantCount;
  const evidenceReduction = Math.min(0.3, relevantCount * 0.05);

  return Math.max(0.05, avgUncertainty - evidenceReduction);
}

// 점진적 업데이트: 새 증거 하나 추가 시 기존 결과 업데이트
export function updateInference(
  previousResult: InferenceResult,
  newAction: ActionClass,
  hypotheses: Hypothesis[]
): InferenceResult {
  // 기존 사후확률을 새로운 사전확률로 사용
  const updatedHypotheses = hypotheses.map((h) => {
    const prev = previousResult.hypotheses.find((p) => p.id === h.id);
    return {
      ...h,
      priorProbability: prev ? prev.posterior : h.priorProbability,
    };
  });

  // 새 증거만으로 업데이트 (점진적)
  return runInference([newAction], updatedHypotheses);
}
