import { ActionClass, ActionClassType, SPUQResult } from '@/types';

/**
 * SPUQ (Sampling-based Predictive Uncertainty Quantification)
 *
 * 소형 LLM의 환각과 불확실성을 정량화하기 위한 샘플링 기반 추론.
 * 동일 입력에 대해 N회 샘플링 → 응답 분포로 불확실성 추정.
 *
 * 데모에서는 시뮬레이션으로 구현, 실제로는 로컬 LLM 다중 샘플링 사용.
 */

const ACTION_CLASS_TYPES: ActionClassType[] = [
  'IMINT', 'HUMINT', 'SIGINT', 'GEOINT', 'OSINT', 'MASINT', 'CYBINT', 'WXINT', 'UAV'
];

// 키워드 기반 클래스 분류 규칙 (데모용 - 실제로는 소형 LLM)
const CLASS_KEYWORDS: Record<ActionClassType, string[]> = {
  IMINT: ['위성', '영상', '사진', '촬영', '관측', '포착', 'SAR', 'EO', '해상도', '식별', '판독', 'TEL', '발사대', '바지선', '트레일러', '전용열차'],
  HUMINT: ['정보원', '첩보', '보고', '접선', '내부자', '증언', '탈북'],
  SIGINT: ['통신', '신호', '전파', '주파수', 'ELINT', '감청', '암호', '교신', '무전', '레이더', '텔레메트리', '방사', '소실', '트래픽', 'Ping'],
  GEOINT: ['지형', '시설', '건물', '도로', '좌표', '면적', '구조물', 'MGRS'],
  OSINT: ['통보', '뉴스', '기념일', '열병식', '보도', 'SNS', '성명', '담화', '훈련일정', '노동신문', 'KCNA', '조선중앙'],
  MASINT: ['적외선', '열원', '진동', '음향', '화학', '방사능', '연료', '배기', '산화제', '추진제', '분출', '연소', 'IR'],
  CYBINT: ['사이버', '네트워크', 'IP', '해킹', '트래픽', '서버'],
  WXINT: ['기상', '풍속', '시정', '기온', '구름', '날씨'],
  UAV: ['UAV', '무인기', '헤론', 'MQ-9', 'FLIR', '체공', 'Lock-on', '추적', '드론', 'BDA'],
};

// 키워드 기반 분류 (N회 변형 시뮬레이션)
function classifyWithVariation(
  rawText: string,
  variationSeed: number
): ActionClassType {
  const scores: Record<ActionClassType, number> = {} as any;

  for (const classType of ACTION_CLASS_TYPES) {
    let score = 0;
    for (const keyword of CLASS_KEYWORDS[classType]) {
      if (rawText.includes(keyword)) {
        // 약간의 랜덤 변동 추가 (LLM 샘플링 시뮬레이션)
        score += 1 + (Math.sin(variationSeed * 7 + score) * 0.3);
      }
    }
    scores[classType] = score;
  }

  // 최고 점수 클래스 반환
  let maxScore = -1;
  let maxClass: ActionClassType = 'IMINT';
  for (const [cls, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxClass = cls as ActionClassType;
    }
  }

  return maxClass;
}

// SPUQ: N회 샘플링으로 불확실성 추정
export function runSPUQ(
  rawReport: string,
  numSamples: number = 10
): SPUQResult {
  const classVotes: Record<ActionClassType, number> = {} as any;
  for (const cls of ACTION_CLASS_TYPES) classVotes[cls] = 0;

  // N회 샘플링
  for (let i = 0; i < numSamples; i++) {
    const result = classifyWithVariation(rawReport, i);
    classVotes[result]++;
  }

  // 클래스 분포 계산
  const classDistribution: Record<ActionClassType, number> = {} as any;
  for (const cls of ACTION_CLASS_TYPES) {
    classDistribution[cls] = classVotes[cls] / numSamples;
  }

  // 최다 투표 클래스 선택
  let selectedClass: ActionClassType = 'IMINT';
  let maxVotes = 0;
  for (const [cls, votes] of Object.entries(classVotes)) {
    if (votes > maxVotes) {
      maxVotes = votes;
      selectedClass = cls as ActionClassType;
    }
  }

  // 분류 확신도 = 최다 클래스 비율 (1에 가까울수록 확실)
  const classConfidence = maxVotes / numSamples;

  return {
    classDistribution,
    selectedClass,
    classConfidence,
    fieldResults: {}, // 실제로는 필드별 다중 샘플링 결과
    numSamples,
  };
}

// Raw 보고서를 액션 클래스로 정형화
export function structureReport(
  rawReport: string,
  reportId: string,
  source: string,
  analystConfidence: number, // 판독관 원래 확신도 (0-1)
  timestamp?: string
): ActionClass {
  // SPUQ 실행
  const spuq = runSPUQ(rawReport);

  // 필드 추출 (데모: 키워드 기반)
  const fields = extractFields(rawReport, spuq.selectedClass);

  // 필드별 불확실성 (데모: 고정값, 실제로는 SPUQ 필드 샘플링)
  const fieldUncertainty: Record<string, number> = {};
  for (const key of Object.keys(fields)) {
    fieldUncertainty[key] = 0.2 + Math.random() * 0.3; // 0.2~0.5
  }

  return {
    id: reportId,
    classType: spuq.selectedClass,
    timestamp: timestamp || new Date().toISOString(),
    source,
    rawReport,
    confidence: spuq.classConfidence * analystConfidence, // 결합 확신도
    fieldUncertainty,
    analystConfidence,
    fields,
  };
}

// 클래스별 필드 추출 (데모)
function extractFields(
  rawText: string,
  classType: ActionClassType
): Record<string, any> {
  const fields: Record<string, any> = {};

  switch (classType) {
    case 'IMINT':
      fields.objectType = extractKeywordMatch(rawText, ['바지선', 'TEL', '발사대', '차량', '건물', '미사일']);
      fields.changeDetected = rawText.includes('이동') || rawText.includes('변화') || rawText.includes('신규');
      fields.activity = extractKeywordMatch(rawText, ['이동', '직립', '전개', '은폐', '위장']);
      break;
    case 'SIGINT':
      fields.signalType = extractKeywordMatch(rawText, ['통신', '레이더', '전파', '암호']);
      fields.pattern = extractKeywordMatch(rawText, ['증가', '감소', '변화', '이상', '비정상']);
      fields.activity = extractKeywordMatch(rawText, ['교신', '암호변경', '전파발사', '감청']);
      break;
    case 'MASINT':
      fields.sensorType = extractKeywordMatch(rawText, ['적외선', '열원', '음향', '화학']);
      fields.measurement = extractKeywordMatch(rawText, ['고온', '저온', '증가', '감지']);
      fields.activity = extractKeywordMatch(rawText, ['연료주입', '엔진가동', '산화제', '배기']);
      break;
    case 'HUMINT':
      fields.sourceReliability = rawText.includes('확인') ? 'confirmed' : 'unconfirmed';
      fields.activity = extractKeywordMatch(rawText, ['이동', '준비', '명령', '지시', '현지지도']);
      break;
    case 'OSINT':
      fields.sourceType = extractKeywordMatch(rawText, ['통보', '위성', '뉴스', 'SNS', '성명', '담화', '기념일']);
      fields.relevance = rawText.includes('미사일') || rawText.includes('핵') ? 'high' : 'medium';
      break;
    default:
      fields.content = rawText.substring(0, 100);
  }

  return fields;
}

function extractKeywordMatch(text: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    if (text.includes(kw)) return kw;
  }
  return null;
}
