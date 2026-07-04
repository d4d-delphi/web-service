-- NL-COP core schema
-- 원래 docs/data_dict/NL-COP 데이터 사전.md 기준으로 정의됨(현재는 docs/DATASET-SCHEMA.md 부록으로 이관).
-- 참고: 이 테이블들은 이후 20260704084259_layer1_observation_schema.sql에서 Layer 1 설계로 대체되어 drop됨.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- =========================================================
-- 1. 시나리오 / 시각화 계층 (§7, §12)
-- =========================================================

create table if not exists scenarios (
  id text primary key,
  name text not null,
  description text not null,
  start_time timestamptz not null,
  duration_seconds integer not null,
  camera_lat double precision not null,
  camera_lng double precision not null,
  camera_alt double precision,
  camera_heading double precision,
  camera_pitch double precision,
  camera_range double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table scenarios is 'Scenario — 시나리오 A(평시)/B(전시) 컨테이너';

create table if not exists scenario_phases (
  id uuid primary key default gen_random_uuid(),
  scenario_id text not null references scenarios(id) on delete cascade,
  phase_no integer not null,
  name text not null,
  start_time_sec integer not null,
  end_time_sec integer not null,
  description text not null,
  camera_target jsonb,
  threat_updates jsonb default '[]'::jsonb,
  friendly_updates jsonb default '[]'::jsonb,
  unique (scenario_id, phase_no)
);
comment on table scenario_phases is 'ScenarioPhase — 시나리오 내 단계 구성';

create table if not exists threat_assets (
  id text primary key,
  scenario_id text references scenarios(id) on delete cascade,
  name text not null,
  asset_type text not null check (asset_type in ('SAM','TEL','RADAR','MISSILE_BASE','COMMAND')),
  lat double precision not null,
  lng double precision not null,
  alt double precision,
  status text not null check (status in ('active','destroyed','relocating','unknown')),
  threat_radius_km numeric(6,2),
  details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table threat_assets is 'ThreatAsset — 적 자산(지도 표출)';

create table if not exists friendly_assets (
  id text primary key,
  scenario_id text references scenarios(id) on delete cascade,
  name text not null,
  asset_type text not null check (asset_type in ('MISSILE','FIGHTER','ISR','SHIP','COMMAND','UAV')),
  lat double precision not null,
  lng double precision not null,
  alt double precision,
  status text not null check (status in ('ready','engaged','returning','standby')),
  capability text,
  details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table friendly_assets is 'FriendlyAsset — 아군 자산(지도 표출)';

-- =========================================================
-- 2. 원천 데이터 계층 — 영상/신호/추적자산 (§2, §3, §4)
-- =========================================================

create table if not exists imint_reports (
  id uuid primary key default gen_random_uuid(),
  timestamp_captured timestamptz not null,
  timestamp_analyzed timestamptz not null,
  sensor_type text not null check (sensor_type in ('EO','SAR','IR')),
  source_platform text not null,
  mgrs_coordinate text not null,
  location_name text not null,
  detected_objects jsonb not null default '[]'::jsonb,
  unusual_activity_flag boolean not null default false,
  semantic_analysis text not null,
  confidence_level smallint not null check (confidence_level between 1 and 5),
  analyst_name text not null,
  analyst_unit text not null,
  created_at timestamptz not null default now()
);
comment on table imint_reports is 'IMINTReport — 영상자산(위성/항공기) 판독 결과';
create index if not exists idx_imint_reports_captured on imint_reports(timestamp_captured);

create table if not exists sigint_raw (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null,
  receiving_system text not null,
  estimated_mgrs text not null,
  frequency_band text not null check (frequency_band in ('UHF','HF','VHF','X-Band','S-Band','L-Band')),
  signal_characteristics jsonb not null default '{}'::jsonb,
  raw_emitter_guess text not null,
  signal_strength text not null check (signal_strength in ('Weak','Moderate','High')),
  created_at timestamptz not null default now()
);
comment on table sigint_raw is 'SIGINTRaw — 체계 자동 수집 신호 원천 데이터(식별 주체 없음)';
create index if not exists idx_sigint_raw_captured on sigint_raw(captured_at);

create table if not exists sigint_processed (
  id uuid primary key default gen_random_uuid(),
  time_start timestamptz not null,
  time_end timestamptz not null,
  facility_name text not null,
  emitter_identified text not null,
  integrated_sources jsonb not null default '[]'::jsonb,
  human_summary text not null,
  ew_environment text not null check (ew_environment in ('Normal','Jammed')),
  created_at timestamptz not null default now()
);
comment on table sigint_processed is 'SIGINTProcessed — 병사/AI가 종합한 신호 가공 데이터';
create index if not exists idx_sigint_processed_time on sigint_processed(time_start, time_end);

create table if not exists uav_telemetry (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null,
  task_id text not null,
  asset_name text not null,
  sensor_mode text not null check (sensor_mode in ('FLIR_WhiteHot','FLIR_BlackHot','EO_DayTV','IR_MidWave')),
  platform_mgrs text not null,
  crosshair_mgrs text not null,
  slant_range_km numeric(6,2) not null,
  tracking_status text not null check (tracking_status in ('Searching','Lock-on','Lost')),
  linked_target_id text references threat_assets(id),
  created_at timestamptz not null default now()
);
comment on table uav_telemetry is 'UAVTelemetry — 헤론/MQ-9 실시간 텔레메트리 스트리밍';
create index if not exists idx_uav_telemetry_task on uav_telemetry(task_id, captured_at);

-- =========================================================
-- 3. 과거사례 / 공개첩보 (§5, §6)
-- =========================================================

create table if not exists provocation_cases (
  yearly_launch_seq text primary key,
  launch_time text not null,
  launch_count integer not null,
  weapon_class text not null check (weapon_class in ('SRBM','MRBM','IRBM','ICBM','SLBM','CM','HGV')),
  kn_designation text not null,
  visual_indicators jsonb not null default '[]'::jsonb,
  signal_indicators jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table provocation_cases is 'ProvocationCase — 미사일 도발 사례 원장';

create table if not exists friendly_actions (
  id uuid primary key default gen_random_uuid(),
  related_launch_seq text not null unique references provocation_cases(yearly_launch_seq) on delete cascade,
  targeting_process text not null,
  response_action text not null,
  bda_result text not null,
  created_at timestamptz not null default now()
);
comment on table friendly_actions is 'FriendlyActionCase — 아군 표적처리/대응/BDA (도발 사례와 1:1)';

create table if not exists osint_reports (
  osint_id text primary key,
  published_time timestamptz not null,
  processed_time timestamptz not null,
  source_media text not null,
  media_type text not null,
  original_title text not null,
  key_entities jsonb not null default '[]'::jsonb,
  dia_analytical_summary text not null,
  strategic_intent text not null,
  related_launch_seq text references provocation_cases(yearly_launch_seq),
  created_at timestamptz not null default now()
);
comment on table osint_reports is 'OSINTReport — 정보사 공개정보단 분석 결과';
create index if not exists idx_osint_reports_related_seq on osint_reports(related_launch_seq);

create table if not exists historical_cases (
  id text primary key,
  case_date date not null,
  title text not null,
  missile_type text not null,
  indicators text[] not null default '{}',
  outcome text not null,
  description text not null,
  provocation_seq text references provocation_cases(yearly_launch_seq),
  embedding vector(1536),
  created_at timestamptz not null default now()
);
comment on table historical_cases is 'HistoricalCase — RAG 검색용 평면 요약(legacy 호환), embedding은 향후 pgvector 검색용';
create index if not exists idx_historical_cases_provocation on historical_cases(provocation_seq);

-- =========================================================
-- 4. 시설 마스터 / 발사 징후 이벤트 / Rule-Base (§8, §13, 목표 설계)
-- =========================================================

create table if not exists facilities (
  facility_id uuid primary key default gen_random_uuid(),
  facility_name text not null,
  region text not null,
  fuel_type text not null check (fuel_type in ('liquid','solid','common')),
  facility_role text not null,
  related_weapon_class text,
  first_observed_phase text not null check (first_observed_phase in ('pre_phase','phase1','phase2','phase3','phase4')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table facilities is 'facilities — 발사 준비 관련 시설 마스터(목표 설계)';

create table if not exists launch_indicator_events (
  event_id uuid primary key default gen_random_uuid(),
  related_launch_seq text references provocation_cases(yearly_launch_seq),
  facility_id uuid references facilities(facility_id),
  phase text not null check (phase in (
    'pre_phase','phase1_fuel_prep','phase2_movement','phase3_vip','phase4_imminent','phase5_custody','phase6_osint_verify'
  )),
  indicator_type text not null check (indicator_type in ('visual','signal','vip','osint')),
  event_time timestamptz not null,
  location_name text not null,
  activity text not null,
  launch_probability_estimate numeric(4,3),
  created_at timestamptz not null default now()
);
comment on table launch_indicator_events is 'launch_indicator_events — 발사 징후 마스터 타임라인 정규화(목표 설계)';
create index if not exists idx_launch_indicator_events_seq on launch_indicator_events(related_launch_seq);
create index if not exists idx_launch_indicator_events_facility on launch_indicator_events(facility_id);

create table if not exists launch_classification_rules (
  rule_id uuid primary key default gen_random_uuid(),
  launch_site_pattern text not null,
  notification_pattern text not null check (notification_pattern in ('notified','not_notified')),
  trajectory_pattern text not null,
  collateral_indicator text,
  concluded_fuel_type text not null check (concluded_fuel_type in ('liquid','solid')),
  concluded_weapon_class text not null,
  confidence_hint numeric(3,2) not null check (confidence_hint between 0 and 1),
  created_at timestamptz not null default now()
);
comment on table launch_classification_rules is 'launch_classification_rules — 발사 원점/궤적 Rule-Base 매칭(목표 설계)';

-- =========================================================
-- 5. 정형화 / 추론 계층 (§9, §10)
-- =========================================================

create table if not exists hypotheses (
  id text primary key,
  name text not null,
  category text not null,
  parent_id text references hypotheses(id),
  prior_probability numeric(5,4) not null check (prior_probability between 0 and 1),
  likelihood_map jsonb not null default '{}'::jsonb,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table hypotheses is 'Hypothesis — 베이지안 추론 사전 지식(가설 DB)';

create table if not exists action_classes (
  id text primary key,
  class_type text not null check (class_type in ('IMINT','HUMINT','SIGINT','GEOINT','OSINT','MASINT','CYBINT','WXINT','UAV')),
  occurred_at timestamptz not null,
  source text not null,
  raw_report text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  field_uncertainty jsonb not null default '{}'::jsonb,
  analyst_confidence numeric(4,3) not null check (analyst_confidence between 0 and 1),
  fields jsonb not null default '{}'::jsonb,
  source_type text check (source_type in ('imint','sigint_raw','sigint_processed','uav','osint')),
  source_ref_id text,
  scenario_id text references scenarios(id),
  phase_no integer,
  created_at timestamptz not null default now()
);
comment on table action_classes is 'ActionClass — SPUQ로 정형화된 액션 클래스(원본 참조는 source_type/source_ref_id 다형 조합)';
create index if not exists idx_action_classes_scenario on action_classes(scenario_id);

create table if not exists inference_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id text references scenarios(id),
  top_hypothesis_id text references hypotheses(id),
  overall_confidence numeric(5,4) not null check (overall_confidence between 0 and 1),
  evidence_count integer not null default 0,
  hypotheses_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
comment on table inference_runs is 'InferenceResult — 추론 실행 결과 영속화(감사/재현용, 목표 설계)';
create index if not exists idx_inference_runs_scenario on inference_runs(scenario_id, created_at);

-- =========================================================
-- 6. 보고 / 시각화 연동 (§11, §12)
-- =========================================================

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  scenario_id text references scenarios(id),
  inference_run_id uuid references inference_runs(id),
  summary text not null,
  threat_assessment text not null,
  confidence numeric(5,2) not null,
  launch_probability numeric(5,2),
  recommendations jsonb not null default '[]'::jsonb,
  historical_case_ids text[] default '{}',
  evidence_trace jsonb,
  created_at timestamptz not null default now()
);
comment on table briefings is 'BriefingResult — 지휘관용 종합 브리핑 영속화(감사/재현용, 목표 설계)';

create table if not exists timeline_events (
  id text primary key,
  scenario_id text not null references scenarios(id) on delete cascade,
  display_time text not null,
  timestamp_sec integer not null,
  title text not null,
  description text not null,
  event_type text not null check (event_type in ('intel','movement','launch','strike','bda','alert')),
  related_assets jsonb default '[]'::jsonb,
  threat_level numeric(4,2),
  action_class text check (action_class in ('IMINT','HUMINT','SIGINT','GEOINT','OSINT','MASINT','CYBINT','WXINT','UAV')),
  action_id text references action_classes(id),
  imint_report_id uuid references imint_reports(id),
  sigint_processed_id uuid references sigint_processed(id),
  uav_telemetry_id uuid references uav_telemetry(id),
  osint_report_id text references osint_reports(osint_id),
  created_at timestamptz not null default now()
);
comment on table timeline_events is 'TimelineEvent — 지도/타임라인 UI 표출 이벤트(원천 데이터 참조 포함)';
create index if not exists idx_timeline_events_scenario on timeline_events(scenario_id, timestamp_sec);

create table if not exists timeline_event_sigint_raw (
  timeline_event_id text not null references timeline_events(id) on delete cascade,
  sigint_raw_id uuid not null references sigint_raw(id) on delete cascade,
  primary key (timeline_event_id, sigint_raw_id)
);
comment on table timeline_event_sigint_raw is 'TimelineEvent.sigintRaw[] 배열 관계를 위한 조인 테이블';

-- =========================================================
-- 7. Row Level Security — 데모 기본값: 읽기는 공개, 쓰기는 service role만
-- =========================================================

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'scenarios','scenario_phases','threat_assets','friendly_assets',
      'imint_reports','sigint_raw','sigint_processed','uav_telemetry',
      'provocation_cases','friendly_actions','osint_reports','historical_cases',
      'facilities','launch_indicator_events','launch_classification_rules',
      'hypotheses','action_classes','inference_runs','briefings',
      'timeline_events','timeline_event_sigint_raw'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('create policy %I on %I for select using (true);', t || '_read_all', t);
  end loop;
end $$;
