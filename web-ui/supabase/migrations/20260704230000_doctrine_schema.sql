-- Layer 2+: 아군 교리 연동 (Track B)
-- 목적: api/brief의 추상적 recommendations를 교리 기반 매핑으로 강화.
--   솔루션이 아군 경계태세(WATCHCON)/킬체인/대응옵션/C2/ROE를 반영해 "즉시 투입 가능"하게 한다.
-- 공개 교리 개념만 사용. 실 운용 수치·체계연동은 stub/illustrative 로 표기.
--
-- 5개 룩업 테이블 + 아군 자산 교리 메타:
--   1) watchcon_levels     — 경계태세 위상 1-5 (단순경계 ~ 전시)
--   2) killchain_phases    — KAMD 킬체인 detect/assess/decide/act
--   3) response_options    — 교리 기반 대응 (KAMD 탐지 / KMPR 타격 / LAMD 요격)
--   4) c2_authority        — 보고/결재선 (합참의장 → 작전사령관 → 군사령관/기능사)
--   5) roe_categories      — 교전규칙 카테고리 (단계별 허용행동, 데모용)
--   6) friendly_assets_doctrine — 아군 자산 교리 메타(사거리·탐지거리·가용성·현재 경계단계)
--      (시나리오 JSON의 FriendlyAsset 타입을 건드리지 않고 별도 테이블로 연결)

-- =========================================================
-- watchcon_levels — 경계태세 위상 (Korea Watch Condition, 5=평시 ~ 1=전시)
-- =========================================================
create table if not exists watchcon_levels (
  level                 smallint primary key,            -- 1(전시) ~ 5(단순경계)
  name                  text not null,                   -- 단순경계/경계/비상/심각/전시
  english_name          text,                            -- Simple Alert / Watch / Emergency / Severe / War
  meaning               text not null,                   -- 의미
  activation_condition  text,                            -- 발동조건(threat band/phase 휴리스틱, illustrative)
  recommended_posture   text,                            -- 권고 태세전환
  created_at            timestamptz not null default now()
);
comment on table watchcon_levels is 'watchcon_levels — 경계태세 위상 1-5 (공개 교리 개념, 데모용 수치는 illustrative)';

-- =========================================================
-- killchain_phases — KAMD 킬체인 4단계 (detect/assess/decide/act)
-- =========================================================
create table if not exists killchain_phases (
  phase             text primary key,                    -- detect/assess/decide/act
  korean_name       text not null,                       -- 탐지/판단/결심/실행
  ordinal           smallint not null unique,            -- 1-4 순서
  entry_condition   text,                                -- 진입조건(관측/추론 상태)
  exit_condition    text,                                -- 종료조건
  description       text,
  created_at        timestamptz not null default now()
);
comment on table killchain_phases is 'killchain_phases — KAMD 킬체인 detect/assess/decide/act (매핑: 포착=detect, 사후확률 산출=assess, 임계도달=decide, 대응=act)';

-- =========================================================
-- response_options — 교리 기반 대응 (3축: KAMD 탐지 / KMPR 타격 / LAMD 요격)
-- =========================================================
create table if not exists response_options (
  option_id           text primary key,                  -- kamd-peaceseye, kmpr-hyunmoo-4 등
  pillar              text not null check (pillar in ('kamd','kmpr','lamd')),  -- 축: 탐지/타격/요격
  pillar_name         text not null,                     -- 한국형 미사일방어 / 대량응징보복 / 저고도방어
  asset               text not null,                     -- 자산: 현무-4 / L-SAM / PAC-3 / F-35 / Peace Eye(E-737)
  trigger_phase       text references killchain_phases(phase) on delete set null,  -- 발동 킬체인 단계
  authority_threshold text,                              -- 권한 임계 (illustrative)
  priority            int,                               -- 우선순위 (1=최우선)
  description         text,
  created_at          timestamptz not null default now()
);
comment on table response_options is 'response_options — 교리 3축 대응(KAMD 탐지/KMPR 타격/LAMD 요격), 데모용';
create index if not exists response_options_pillar_idx on response_options (pillar);
create index if not exists response_options_trigger_phase_idx on response_options (trigger_phase);

-- =========================================================
-- c2_authority — 보고/결재선
-- =========================================================
create table if not exists c2_authority (
  tier                int primary key,                   -- 1(최고) ~ 4
  authority           text not null,                     -- 권자: 합참의장/작전사령관/군사령관/기능사
  role                text,                              -- 역할
  decision_threshold  text,                              -- 결재 임계 (어느 watchcon/행동 단위까지 결재)
  reporting_chain     text,                              -- 보고체계 (상황보고 시간통제, illustrative)
  created_at          timestamptz not null default now()
);
comment on table c2_authority is 'c2_authority — 보고/결재선 (합참의장→작전사령관→군사령관/기능사), 데모용 illustrative';

-- =========================================================
-- roe_categories — 교전규칙 카테고리 (단계별 허용행동, 데모용)
-- =========================================================
create table if not exists roe_categories (
  category_id         text primary key,
  name                text not null,                     -- 정찰/감시 / 자위권 / 제한타격 / 전면대응
  allowed_actions     text,                              -- 허용 행동
  activation_watchcon smallint references watchcon_levels(level) on delete set null,  -- 대응 watchcon 등급
  description         text,
  created_at          timestamptz not null default now()
);
comment on table roe_categories is 'roe_categories — 교전규칙 카테고리(데모용, 공개 교리 개념만)';

-- =========================================================
-- friendly_assets_doctrine — 아군 자산 교리 메타 (별도 테이블, FriendlyAsset 타입 미건드림)
-- =========================================================
create table if not exists friendly_assets_doctrine (
  asset_id            uuid primary key default gen_random_uuid(),
  canonical_name      text not null unique,              -- 정규 자산명: 현무-4 / L-SAM / PAC-3 / Peace Eye / F-35A
  slug                text unique,
  pillar              text check (pillar in ('kamd','kmpr','lamd','c2','isr')),
  asset_type          text check (asset_type in ('interceptor','strike','sensor','fighter','command','uav')),
  range_km            numeric(8,2),                      -- 사거리 (요격/타격)
  detection_range_km  numeric(8,2),                      -- 탐지거리 (센서)
  readiness           text check (readiness in ('ready','standby','maintenance','unknown')),
  current_watchcon    smallint references watchcon_levels(level) on delete set null,  -- 현재 경계단계
  description         text,
  created_at          timestamptz not null default now()
);
comment on table friendly_assets_doctrine is 'friendly_assets_doctrine — 아군 자산 교리 메타(사거리·탐지거리·가용성·현재 경계단계)';
create index if not exists friendly_assets_doctrine_pillar_idx on friendly_assets_doctrine (pillar);

-- =========================================================
-- RLS: 공개 read/write/update/delete (기존 테이블과 동일 — 해커톤 데이터 파이프라인)
-- =========================================================
alter table watchcon_levels          enable row level security;
alter table killchain_phases         enable row level security;
alter table response_options         enable row level security;
alter table c2_authority             enable row level security;
alter table roe_categories           enable row level security;
alter table friendly_assets_doctrine enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'watchcon_levels','killchain_phases','response_options',
    'c2_authority','roe_categories','friendly_assets_doctrine'
  ] loop
    execute format('create policy %s on %s for select to public using (true);', t||'_read', t);
    execute format('create policy %s on %s for insert to public with check (true);', t||'_write', t);
    execute format('create policy %s on %s for update to public using (true);', t||'_update', t);
    execute format('create policy %s on %s for delete to public using (true);', t||'_delete', t);
  end loop;
end $$;
