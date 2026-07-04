-- Layer 1 스키마: 원천 관측 통합 테이블 `observation`
-- 근거: docs/DATASET-SCHEMA.md (모든 감시 자산을 단일 테이블 + jsonb로 통합)
-- 참고: 이 마이그레이션은 Supabase SQL Editor로 이미 원격에 적용된 스키마 변경을
--       로컬 마이그레이션 이력과 동기화하기 위해 사후 작성되었다.
--
-- 이전 마이그레이션(20260704071600_init_nl_cop_schema.sql)에서 만든 ~20개 테이블은
-- 새 Layer 1 단일 관측 테이블 설계로 대체되며 원격에서 이미 제거되었다. 로컬에서
-- 이 마이그레이션을 재적용(예: `supabase db reset`)했을 때도 동일한 최종 상태가
-- 되도록 여기서 명시적으로 drop한다.

drop table if exists timeline_event_sigint_raw cascade;
drop table if exists timeline_events cascade;
drop table if exists briefings cascade;
drop table if exists inference_runs cascade;
drop table if exists action_classes cascade;
drop table if exists hypotheses cascade;
drop table if exists launch_classification_rules cascade;
drop table if exists launch_indicator_events cascade;
drop table if exists facilities cascade;
drop table if exists historical_cases cascade;
drop table if exists osint_reports cascade;
drop table if exists friendly_actions cascade;
drop table if exists provocation_cases cascade;
drop table if exists uav_telemetry cascade;
drop table if exists sigint_processed cascade;
drop table if exists sigint_raw cascade;
drop table if exists imint_reports cascade;
drop table if exists friendly_assets cascade;
drop table if exists threat_assets cascade;
drop table if exists scenario_phases cascade;
drop table if exists scenarios cascade;

create table if not exists observation (
  obs_id          uuid primary key default gen_random_uuid(),

  -- ── 관측 정체 ──
  asset_type      text not null
    check (asset_type in ('SATELLITE_IMINT','AERIAL_IMINT','SIGINT','UAV_FLIR','OSINT')),
  polarity        text not null default 'PRESENT'
    check (polarity in ('PRESENT','ABSENT')),      -- negative evidence
  collected_at    timestamptz not null,            -- 촬영/포착/보도 일시 (정본 시간축)

  -- ── 공간 ──
  mgrs            text,                             -- 대상 위치 (군사좌표)
  location_name   text,                             -- 판독관이 쓴 시설/지역명 (자유텍스트)

  -- ── 판독관이 본 것 (액션 단위 핵심) ──
  observed_objects jsonb not null default '[]',     -- [{type(자유텍스트), count}]
  activity_desc   text not null,                    -- 판독관 서술 (단일 관측 한정)
  unusual_flag    boolean not null default false,   -- routine vs unusual

  -- ── 출처 · 신뢰도 (Provenance) ──
  platform        text not null,                    -- 자산명 (425위성, 헤론, RF-16, 노동신문)
  analyst_id      text,                             -- 판독관 ID (SIGINT raw는 null)
  analyst_unit    text,                             -- 소속 부대
  reliability     smallint not null                 -- 판독 신뢰 등급
    check (reliability between 1 and 5),

  -- ── 자산별 상세 (원천 필드) ──
  asset_detail    jsonb not null default '{}',

  -- ── 원본 참조 ──
  source_ref      text,                             -- 원 아티클 URL / 파일 포인터
  image_urls      jsonb not null default '[]',      -- [{url, caption, license}]
  created_at      timestamptz not null default now()
);
comment on table observation is 'Layer 1 — 판독관 1인이 감시 자산 1개에서 얻은 단일 액션 관측 + 출처/신뢰도';

create index if not exists observation_collected_at_idx on observation (collected_at);
create index if not exists observation_asset_type_idx on observation (asset_type);

-- RLS: 해커톤 데이터 파이프라인 단계 — 공개 read/write/update/delete 허용 (원격 적용 상태 그대로 반영)
alter table observation enable row level security;

create policy observation_read on observation
  for select to public using (true);
create policy observation_write on observation
  for insert to public with check (true);
create policy observation_update on observation
  for update to public using (true);
create policy observation_delete on observation
  for delete to public using (true);
