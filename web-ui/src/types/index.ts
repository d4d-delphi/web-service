// ============================================
// 좌표 및 기본 타입
// ============================================

export interface Coordinates {
  lat: number;
  lng: number;
  alt?: number;
}

// ============================================
// 데이터셋 스키마: 영상자산 (IMINT)
// ============================================

export interface IMINTReport {
  timestamp_captured: string;
  timestamp_analyzed: string;
  sensor_type: 'EO' | 'SAR' | 'IR';
  source_platform: string;
  MGRS_coordinate: string;
  location_name: string;
  detected_objects: { type: string; count: number }[];
  unusual_activity_flag: boolean;
  semantic_analysis: string;
  confidence_level: number; // 1-5
  analyst_name: string;
  analyst_unit: string;
}

// ============================================
// 데이터셋 스키마: 신호자산 (SIGINT)
// ============================================

export interface SIGINTRaw {
  timestamp: string;
  receiving_system: string;
  estimated_MGRS: string;
  frequency_band: 'UHF' | 'HF' | 'VHF' | 'X-Band' | 'S-Band' | 'L-Band';
  signal_characteristics: {
    PRI?: number;
    PW?: number;
    Scan?: string;
  };
  raw_emitter_guess: string;
  signal_strength: 'Weak' | 'Moderate' | 'High';
}

export interface SIGINTProcessed {
  time_start: string;
  time_end: string;
  facility_name: string;
  emitter_identified: string;
  integrated_sources: string[];
  human_summary: string;
  ew_environment: 'Normal' | 'Jammed';
}

// ============================================
// 데이터셋 스키마: 과거사례 (Historical Cases)
// ============================================

export interface ProvocationCase {
  yearly_launch_seq: string;       // PK: "2026-04"
  launch_time: string;
  launch_count: number;
  weapon_class: 'SRBM' | 'MRBM' | 'IRBM' | 'ICBM' | 'SLBM' | 'CM' | 'HGV';
  kn_designation: string;
  visual_indicators: {
    date: string;
    time: string;
    location: string;
    activity: string;
  }[];
  signal_indicators: {
    date: string;
    time: string;
    location: string;
    activity: string;
  }[];
}

export interface FriendlyActionCase {
  related_launch_seq: string;      // FK
  targeting_process: string;
  response_action: string;
  bda_result: string;
}

// ============================================
// 데이터셋 스키마: 추적자산 (UAV/FLIR)
// ============================================

export interface UAVTelemetry {
  timestamp: string;
  task_id: string;
  asset_name: string;
  sensor_mode: 'FLIR_WhiteHot' | 'FLIR_BlackHot' | 'EO_DayTV' | 'IR_MidWave';
  platform_MGRS: string;
  crosshair_MGRS: string;
  slant_range_km: number;
  tracking_status: 'Searching' | 'Lock-on' | 'Lost';
  linked_target_id: string;
}

// ============================================
// 데이터셋 스키마: 공개첩보 (OSINT)
// ============================================

export interface OSINTReport {
  osint_id: string;
  published_time: string;
  processed_time: string;
  source_media: string;
  media_type: 'Text' | 'Photo' | 'Video';
  original_title: string;
  key_entities: string[];
  dia_analytical_summary: string;
  strategic_intent: string;
  related_launch_seq: string;      // FK
}

// ============================================
// 액션 클래스 (정형화 계층 - 베이지안 파이프라인)
// ============================================

export type ActionClassType =
  | 'IMINT'    // 영상자산
  | 'HUMINT'   // 첩보자산
  | 'SIGINT'   // 신호자산
  | 'GEOINT'   // 지리정보자산
  | 'OSINT'    // 공개출처
  | 'MASINT'   // 계측자산
  | 'CYBINT'   // 사이버자산
  | 'WXINT'    // 기상/환경
  | 'UAV';     // 추적자산

export interface ActionClass {
  id: string;
  classType: ActionClassType;
  timestamp: string;
  source: string;
  rawReport: string;
  confidence: number;           // 0-1, SPUQ 기반 분류 확신도
  fieldUncertainty: Record<string, number>;
  analystConfidence: number;    // 판독관 원래 확신도
  fields: Record<string, any>;
  // 원본 데이터 참조
  sourceData?: IMINTReport | SIGINTRaw | SIGINTProcessed | UAVTelemetry | OSINTReport;
  scenarioId?: string;
  phaseId?: number;
}

// SPUQ 샘플링 결과
export interface SPUQResult {
  classDistribution: Record<ActionClassType, number>;
  selectedClass: ActionClassType;
  classConfidence: number;
  fieldResults: Record<string, {
    value: any;
    uncertainty: number;
    samples: any[];
  }>;
  numSamples: number;
}

// ============================================
// 가설 (추론 계층)
// ============================================

export interface Hypothesis {
  id: string;
  name: string;
  category: string;
  subHypotheses?: Hypothesis[];
  priorProbability: number;
  likelihoodMap: Record<string, number>;
  description: string;
}

export interface HypothesisNode {
  id: string;
  name: string;
  category: string;
  prior: number;
  posterior: number;
  uncertainty: number;
  evidenceChain: string[];
  children?: HypothesisNode[];
}

// ============================================
// 추론 엔진 출력
// ============================================

// 최유력 가설에 대한 개별 증거의 기여도
export interface EvidenceContribution {
  actionId: string;
  likelihood: number;    // L_i(H*): 최유력 가설 하에서의 우도
  weight: number;        // w_i: SPUQ 확신도 가중치
  logOdds: number;       // 판별 로그오즈 (음수면 가설과 상충)
  contribution: number;  // 0-1, 양의 기여분 중 정규화된 비중
}

export interface InferenceResult {
  hypotheses: HypothesisNode[];
  topHypothesis: HypothesisNode | null;
  overallConfidence: number;
  updatedAt: string;
  evidenceCount: number;
  evidenceContributions: EvidenceContribution[];
}

// ============================================
// 보고 계층
// ============================================

export interface BriefingResult {
  summary: string;
  threatAssessment: string;
  confidence: number;
  recommendations: string[];
  historicalCases: HistoricalCase[];
  launchProbability?: number;
  inferenceResult?: InferenceResult;
  evidenceTrace?: EvidenceTrace[];
}

export interface EvidenceTrace {
  actionId: string;
  actionClass: ActionClassType;
  contribution: string;
  weight: number;
}

// ============================================
// 시나리오 (시각화용)
// ============================================

export interface ThreatAsset {
  id: string;
  name: string;
  type: 'SAM' | 'TEL' | 'RADAR' | 'MISSILE_BASE' | 'COMMAND';
  position: Coordinates;
  status: 'active' | 'destroyed' | 'relocating' | 'unknown';
  threatRadius?: number;
  details?: string;
}

export interface FriendlyAsset {
  id: string;
  name: string;
  type: 'MISSILE' | 'FIGHTER' | 'ISR' | 'SHIP' | 'COMMAND' | 'UAV';
  position: Coordinates;
  status: 'ready' | 'engaged' | 'returning' | 'standby';
  capability?: string;
  details?: string;
}

export interface TimelineEvent {
  id: string;
  time: string;
  timestamp: number;
  title: string;
  description: string;
  type: 'intel' | 'movement' | 'launch' | 'strike' | 'bda' | 'alert';
  relatedAssets?: string[];
  threatLevel?: number;
  // 데이터셋 연동
  actionClass?: ActionClassType;
  actionId?: string;
  // Supabase `observation` 연동 (Layer 1 원천 첩보)
  position?: Coordinates;   // MGRS → lat/lng 파싱 결과 (지도 배치용)
  mgrs?: string;            // 원본 군사좌표
  collectedAt?: string;     // observation.collected_at (정본 시간축)
  timeFraction?: number;    // 관측 시간축상 상대 위치 0..1 (재생 타임스탬프 매핑용)
  // 원본 데이터 참조 (각 도메인)
  imintData?: IMINTReport;
  sigintData?: SIGINTProcessed;
  sigintRaw?: SIGINTRaw[];
  uavData?: UAVTelemetry;
  osintData?: OSINTReport;
}

// 발사(H-0) 이후 '커스터디' 화면 전환을 위한 설정. 실제 비행 궤적/제원은
// 데이터로 존재하지 않으므로 site→target 사이를 합성한 부스트/탄도 궤적으로
// 애니메이션한다. launch가 없는 시나리오는 커스터디 전환을 하지 않는다.
export interface LaunchConfig {
  phaseId: number;                        // 이 단계 진입 시각 = H-0
  site: Coordinates & { name: string };   // 발사 지점
  target: Coordinates & { name: string }; // 궤도진입/탄착 지점(다운레인지 종단)
  profile: 'orbital' | 'ballistic';       // orbital=단조상승, ballistic=포물선
  apogeeKm: number;                        // 정점/궤도 고도 (km)
  maxVelKms: number;                       // 최대 속도 (km/s)
  rangeKm: number;                         // 총 다운레인지 (km)
  flightSec: number;                       // 명목 비행시간(초) — MET 표기용
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  startTime: string;
  duration: number;
  cameraPosition: Coordinates & { heading?: number; pitch?: number; range?: number };
  threats: ThreatAsset[];
  friendlies: FriendlyAsset[];
  timeline: TimelineEvent[];
  phases: ScenarioPhase[];
  launch?: LaunchConfig;
}

export interface ScenarioPhase {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  description: string;
  cameraTarget?: Coordinates & { range?: number };
  threatUpdates?: Partial<ThreatAsset>[];
  friendlyUpdates?: Partial<FriendlyAsset>[];
}

// Legacy - kept for RAG compatibility
export interface HistoricalCase {
  id: string;
  date: string;
  title: string;
  missileType: string;
  indicators: string[];
  outcome: string;
  description: string;
  similarity?: number;
}

// Layer 2+ 실제 발사사례 (CNS NK Missile Test Database + nagix bearing).
// Supabase `launch_cases` 테이블이 source of truth; `launch-cases.json`은 RAG용 평면 미러.
// HistoricalCase 호환 필드(id/date/title/missileType/indicators/outcome/description/similarity)를 가져
// `searchSimilarCases`에서 HistoricalCase와 동일하게 취급된다.
export interface LaunchCase {
  id: string;
  caseNo: number;
  date: string;
  title: string;
  missileType: string;
  facility?: string | null;
  outcome: string;
  indicators: string[];
  description: string;
  distanceKm?: number | null;
  apogeeKm?: number | null;
  facilityLat?: number | null;
  facilityLng?: number | null;
  landingLat?: number | null;
  landingLng?: number | null;
  kn?: string | null;
  similarity?: number; // 런타임 계산
}

export type ScenarioId = 'scenario-a' | 'scenario-b';

// Layer 2+ 적 전투서열(ORBAT) 정규 부대 (OSINT 기반). supabase military_units 가 source of truth,
// orbat-units.json 미러(export_orbat_mirror.py)를 서버 fs 로 읽는다.
export interface MilitaryUnit {
  designation: string;
  unitType: string;          // corps/division/brigade/.../missile/air/naval/air_defense/artillery/command
  branch: string;            // army/air/naval/strategic/sf
  parentDesignation?: string | null;
  garrisonFacility?: string | null;   // facilities.canonical_name
  operatesMissile?: string | null;    // missiles.slug
  hqLat?: number | null;
  hqLng?: number | null;
  strengthEst?: string | null;
  readiness?: string | null;
  role?: string | null;
  sourceRef?: string | null;
  aliases?: string[];
}

// ============================================
// 아군 교리 연동 (Track B) — Layer 2+
// 공개 교리 개념(WATCHCON/KAMD 킬체인/3축 대응/C2/ROE) 기반 매핑.
// 실 운용 수치·체계연동은 illustrative stub.
// 미러: src/data/doctrine-ontology.json (export_doctrine_mirror.py 가 원격 Supabase에서 내보냄).
// ============================================

export interface DoctrineWatchcon {
  level: number;              // 1(전시) ~ 5(단순경계)
  name: string;               // 단순경계/경계/비상/심각/전시
  englishName: string | null; // Simple Alert / Watch / Emergency / Severe / War
  meaning: string;
  recommendedPosture: string | null;
  reason: string;             // 데모용 휴리스틱 근거
}

export interface DoctrineKillchainPhase {
  phase: string;              // detect/assess/decide/act
  koreanName: string;         // 탐지/판단/결심/실행
  ordinal: number;
  entryCondition: string | null;
  description: string | null;
  reason: string;
}

export interface DoctrineResponseOption {
  optionId: string;
  pillar: 'kamd' | 'kmpr' | 'lamd'; // 한국형미사일방어(탐지) / 대량응징보복(타격) / 저고도방어(요격)
  pillarName: string;
  asset: string;
  triggerPhase: string | null;
  authorityThreshold: string | null;
  priority: number | null;
  description: string | null;
}

export interface DoctrineC2Authority {
  tier: number;
  authority: string;
  role: string | null;
  decisionThreshold: string | null;
  reportingChain: string | null;
  isActive: boolean;          // 현재 watchcon에 결재권한인지
}

export interface DoctrineRoeCategory {
  categoryId: string;
  name: string;
  allowedActions: string | null;
  activationWatchcon: number | null;
  description: string | null;
}

export interface DoctrineFriendlyAsset {
  canonicalName: string;
  pillar: string | null;
  assetType: string | null;
  rangeKm: number | null;
  detectionRangeKm: number | null;
  readiness: string | null;
  description: string | null;
}

// api/brief 응답에 포함되는 교리 컨텍스트
export interface DoctrineContext {
  watchcon: DoctrineWatchcon;
  killchainPhase: DoctrineKillchainPhase;
  responseOptions: DoctrineResponseOption[];
  c2Authority: DoctrineC2Authority[];
  roeCategory: DoctrineRoeCategory | null;
  readyAssets: DoctrineFriendlyAsset[];
  note: string;               // illustrative disclaimer
}

// ============================================
// 지휘관 AI 코파일럿 Use Case (Session 3 — Layer 2+)
// 실제 지휘소에서 지휘관이 던질 법한 "가장 날카롭고 현실적인 질의" 세트.
// 각 유스케이스는 온톨로지·교리·RAG·아군 자산·ORBAT 데이터와 연결되며,
// /api/copilot POST 가 컨텍스트를 구성해 "지휘관 질의 → AI 답변" 프롬프트를 생성.
// 원천: src/data/use-cases.json (19건, 7 카테고리).
// ============================================

export type UseCaseCategory =
  | '징후해석'      // Indicator interpretation (Rule 매칭, 발사준비 단계)
  | '전례매칭'      // Precedent matching (RAG)
  | '발사임박성'    // Launch imminence (베이지안 사후확률/증거기여도)
  | '대응권고'      // Response recommendation (3축 자산 조합)
  | 'ROE'           // Rules of engagement (교전규칙/C2 결재선)
  | '아군가용성'    // Friendly asset availability (KAMD/LAMD/KMPR 가용성)
  | '교차검증';     // Cross-INT validation (다중 INT 융합/충돌)

export type UseCaseScenario = 'A' | 'B' | 'general';

// 유스케이스가 답변 생성을 위해 끌어와야 할 데이터 참조(정규 엔티티명/교리/사례).
// 모든 참조명은 실제 온톨로지·교리 미러·RAG 사례의 canonical id 와 일치해야 한다.
export interface UseCaseRequiredData {
  facilities?: string[];          // facility-ontology canonicalName (예: 'Sohae Satellite Launching Station')
  missiles?: string[];            // missile-ontology canonicalName (예: 'Hwasong-11A', 'KN-25')
  doctrine?: string[];            // 교리 미러 항목 (예: 'watchcon 3 (비상)', 'roe-selfdefense')
  friendlyAssets?: string[];      // doctrine friendlyAssets canonicalName (예: '철매-2(M-SAM)')
  orbatUnits?: string[];          // military_units designation (예: '제4군단')
  historicalCases?: string[];     // historical-cases id (예: 'case-2023-07')
  hypotheses?: string[];          // hypotheses.json id (예: 'h-satellite')
  scenarioPhases?: string[];      // scenario-a/b phase 참조 (자유 텍스트)
  ragIndicators?: string[];       // RAG 검색용 indicator 키워드
  ruleRef?: string;               // 발사 규칙(Rule#1 등) 참조
  actionClass?: ActionClassType | ActionClassType[];  // 관련 액션 클래스
  apiPointers?: string[];         // 컨텍스트 구성 시 호출할 엔드포인트 힌트
}

export interface UseCase {
  id: string;                     // 'UC-IND-01' 등
  category: UseCaseCategory;
  difficulty: 1 | 2 | 3;          // 1=기본, 2=심화, 3=최고난도
  scenario: UseCaseScenario;      // A(동창리 SLV) / B(고체 SRBM 알섬) / general
  question: string;               // 지휘관 자연어 질의 (한글)
  expectedReasoning: string;      // 기대 AI 추론 경로 (어떤 온톨로지/교리/RAG/아군 데이터를 끌어와야)
  requiredData: UseCaseRequiredData;
  idealAnswerSketch: string;      // 이상적 답 요약 (데모 정답 기준선)
}

// /api/copilot POST 응답 — 유스케이스 + 조립된 컨텍스트 + 프롬프트 템플릿.
// Claude API 키가 없으면 llmAnswer=null 이고 context/prompt 만 반환(폴백).
// lib/ontology 의 resolveMissile/resolveFacility 결과(정규 엔티티 + matchedAlias)를 담는 경량 뷰.
export interface CopilotResolvedEntity {
  canonicalName: string;
  matchedAlias: string;
  [key: string]: unknown;   // kn/weaponClass/rangeKm/facilityType/lat/lng 등 가변 메타
}

export interface CopilotContextResponse {
  useCase: UseCase;
  query: string;
  resolvedEntities: {
    facilities: CopilotResolvedEntity[];   // resolveFacility 결과(정규 시설)
    missiles: CopilotResolvedEntity[];     // resolveMissile 결과(정규 미사일)
  };
  similarCases: HistoricalCase[];          // RAG 매칭 과거사례
  readyAssets: DoctrineFriendlyAsset[];    // 아군 가용 자산(교리 미러)
  doctrineContext: DoctrineContext | null; // 대표 시나리오 사후확률 기반 교리 매핑
  prompt: string;                          // 조립된 "지휘관 질의 → AI" 프롬프트
  answerSketch: string;                    // 정답 기준선
  llmAnswer: string | null;                // Claude API 결과(키 부재/오류 시 null)
  note: string;                            // illustrative disclaimer
}
