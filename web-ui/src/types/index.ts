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

export interface InferenceResult {
  hypotheses: HypothesisNode[];
  topHypothesis: HypothesisNode | null;
  overallConfidence: number;
  updatedAt: string;
  evidenceCount: number;
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
  // 원본 데이터 참조 (각 도메인)
  imintData?: IMINTReport;
  sigintData?: SIGINTProcessed;
  sigintRaw?: SIGINTRaw[];
  uavData?: UAVTelemetry;
  osintData?: OSINTReport;
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

export type ScenarioId = 'scenario-a' | 'scenario-b';
