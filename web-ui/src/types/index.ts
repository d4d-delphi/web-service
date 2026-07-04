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
// 아군(Blue) 전투서열/작전 자산 — Layer 2+ (Session 2)
// 공수 양면(Offense+Defense) 고려: KAMD(탐지) / LAMD(요격) / KMPR(타격) / 해상 / ISR.
// 공개 제원만(비밀 X). supabase friendly_units 가 source of truth,
// friendly-units.json 미러(export_friendly_mirror.py)를 서버 fs 로 읽는다.
// ============================================

export type FriendlyAssetType =
  | 'KAMD_DETECT'      // 한국형미사일방어 - 탐지/추적
  | 'KAMD_INTERCEPT'   // 요격(LAMD)
  | 'KMPR_STRIKE'      // 대량응징보복 - 타격
  | 'AIR'              // 공군 전투기/타격
  | 'NAVAL'            // 해상(이지스/잠수함)
  | 'ISR'              // 정찰(ISR/AWACS/UAV)
  | 'C2'               // 지휘통제
  | 'GROUND';          // 지상(일반)

export interface FriendlyUnit {
  canonicalName: string;
  slug: string;
  designation: string;
  assetType: FriendlyAssetType;
  branch: string;             // army/air/naval/strategic
  role?: string | null;
  capability?: string | null; // 제원 요약(사거리/탐지거리 등 공개 수치)
  rangeKm?: number | string | null;
  detectionRangeKm?: number | string | null;
  readiness?: string | null;  // ready/standby/maintenance/unknown
  baseName?: string | null;
  hqLat?: number | null;
  hqLng?: number | null;
  sourceRef?: string | null;
  sourceUrl?: string | null;
  description?: string | null;
  doctrineOption?: string | null; // response_options.option_id 연결
  aliases?: string[];
  matchedAlias?: string;          // resolve 결과(어느 별칭에 매칭됐는지)
}

// 현재 킬체인 단계/교리 축 기반으로 "지금 우리가 할 수 있는 것" — 아군 가용 대응 전력.
export interface BlueResponseAsset {
  canonicalName: string;
  assetType: FriendlyAssetType;
  branch: string;
  role?: string | null;
  capability?: string | null;
  rangeKm?: number | string | null;
  detectionRangeKm?: number | string | null;
  readiness?: string | null;
  baseName?: string | null;
  doctrineOption?: string | null;
  pillar: 'kamd' | 'lamd' | 'kmpr' | 'isr' | 'other'; // 정규화된 축
}

// api/brief 응답에 포함되는 아군(Blue) 컨텍스트 (공수 양면)
export interface BlueContext {
  // 현재 킬체인 단계에서 가용한 탐지/요격/타격 전력 요약
  availableAssets: BlueResponseAsset[];
  // 축별 카운트(요약용)
  byPillar: { kamd: number; lamd: number; kmpr: number; isr: number; other: number };
  // 정규 엔티티 해석(징후 텍스트에 아군 자산이 언급된 경우)
  resolvedUnits: FriendlyUnit[];
  note: string; // illustrative disclaimer
}
