-- Layer 2+ 아군(Blue) 전투서열/작전 자산 온톨로지: friendly_units + friendly_unit_aliases
-- 근거: Session 2 — 지휘관은 "적이 쏠 것 같냐"뿐 아니라 "그럼 우리 아군 자산은 뭘 할 수 있나?"를 함께 묻는다.
--       공수 양면(Offense+Defense) 고려를 위해 아군 가용 대응 전력(KAMD/LAMD/KMPR/해상/ISR)을 정규 엔티티로 구축.
-- 원천(공개 자료/비밀 아님): 국방백서 / ROK MND 발표 / 공개 제원 보도 / 제조사/CSIS/GlobalSecurity.
-- canonical+alias 패턴 계승(missiles/missile_aliases, military_units/unit_aliases 참고).
-- 기존 교리(response_options), 시설(facilities)과 연결:
--   operates_doctrine_option → response_options(option_id)  (교리 3축 대응 자산 매칭)
--   base_facility_id         → facilities(facility_id)       (ROK 기지는 확장용 nullable)

create extension if not exists pgcrypto;

-- =========================================================
-- friendly_units — 아군 정규 자산/부대 엔티티 (Blue ORBAT)
-- =========================================================
create table if not exists friendly_units (
  friendly_id              uuid primary key default gen_random_uuid(),
  canonical_name           text not null unique,          -- 정규 자산명 (예: 현무-4M, L-SAM, F-35A, 피스아이)
  slug                     text unique,                   -- 정규화 키
  designation              text not null,                 -- 제식/운용 명칭
  asset_type               text not null check (asset_type in
                             ('KAMD_DETECT','KAMD_INTERCEPT','KMPR_STRIKE',
                              'AIR','NAVAL','ISR','C2','GROUND')),
  branch                   text not null check (branch in
                             ('army','air','naval','strategic')),
  role                     text,                          -- 운용 역할 (탐지/요격/타격/정찰/지휘...)
  capability               text,                          -- 제원 요약 (사거리/탐지거리/요격고도 등 공개 수치)
  range_km                 numeric(8,2),                  -- 요격/타격 사거리 (공개보도 수치)
  detection_range_km       numeric(8,2),                  -- 탐지거리 (센서)
  readiness                text check (readiness in ('ready','standby','maintenance','unknown')),
  base_facility_id         uuid references facilities(facility_id) on delete set null, -- ROK 기지(확장용)
  base_name                text,                          -- 주둔 기지명(텍스트, 공개 자료)
  operates_doctrine_option text references response_options(option_id) on delete set null, -- 교리 대응옵션 연결
  hq_lat                   double precision,
  hq_lng                   double precision,
  source_ref               text,
  source_url               text,
  description              text,
  created_at               timestamptz not null default now()
);
comment on table friendly_units is 'friendly_units — 아군(Blue) 정규 자산/부대 엔티티 (Layer 2+, 공개 제원만)';

create index if not exists friendly_units_type_idx      on friendly_units (asset_type);
create index if not exists friendly_units_branch_idx    on friendly_units (branch);
create index if not exists friendly_units_readiness_idx on friendly_units (readiness);
create index if not exists friendly_units_doctrine_idx  on friendly_units (operates_doctrine_option);
create index if not exists friendly_units_base_idx      on friendly_units (base_facility_id);

-- =========================================================
-- friendly_unit_aliases — 아군 자산 명칭 온톨로지 (제식명/별칭/영문/slug 통합)
-- =========================================================
create table if not exists friendly_unit_aliases (
  alias_id     uuid primary key default gen_random_uuid(),
  friendly_id  uuid not null references friendly_units(friendly_id) on delete cascade,
  alias_text   text not null,
  alias_type   text not null check (alias_type in ('official','nato','colloquial','slug','english')),
  source       text,
  unique (friendly_id, alias_text, alias_type)
);
comment on table friendly_unit_aliases is 'friendly_unit_aliases — 아군 자산 명칭 온톨로지 (제식/별칭/영문)';
create index if not exists friendly_unit_aliases_text_idx    on friendly_unit_aliases (alias_text);
create index if not exists friendly_unit_aliases_friendly_idx on friendly_unit_aliases (friendly_id);

-- =========================================================
-- RLS: 공개 read/write/update/delete (기존 테이블과 동일 — 해커톤 데이터 파이프라인)
-- =========================================================
alter table friendly_units        enable row level security;
alter table friendly_unit_aliases enable row level security;

create policy friendly_units_read   on friendly_units for select to public using (true);
create policy friendly_units_write  on friendly_units for insert to public with check (true);
create policy friendly_units_update on friendly_units for update to public using (true);
create policy friendly_units_delete on friendly_units for delete to public using (true);

create policy friendly_unit_aliases_read   on friendly_unit_aliases for select to public using (true);
create policy friendly_unit_aliases_write  on friendly_unit_aliases for insert to public with check (true);
create policy friendly_unit_aliases_update on friendly_unit_aliases for update to public using (true);
create policy friendly_unit_aliases_delete on friendly_unit_aliases for delete to public using (true);
