-- Layer 2+ 온톨로지: 미사일 체계 / 미사일 시설 정규 엔티티 + 별명(alias)
-- 목적: Palantir 온톨로지처럼 — 에이전트(LLM)가 어떤 명칭으로 불리든 정규 객체로 해석.
--   1) missiles + missile_aliases : 화성(DPRK 공식) / KN(한미) / NATO·별칭 / 체계명(SRBM…) 통합
--   2) facilities + facility_aliases : observation의 세분화된 location_name(자유텍스트) → 정규 시설 매칭
-- observation(Layer 1)은 location_name 자유텍스트를 그대로 두고(§5), 매칭은 본 온톨로지로(Layer 2+ 지오코딩).
-- launch_cases(Layer 2+)에는 정규 미사일 FK를 추가해 정규화 손실 없이 체계 정보 접근.

-- =========================================================
-- missiles — 정규 미사일 체계 엔티티
-- =========================================================
create table if not exists missiles (
  missile_id          uuid primary key default gen_random_uuid(),
  canonical_name      text not null unique,        -- 표준 표기 (예: Hwasong-17, Scud-B, KN-23)
  slug                text unique,                 -- 정규화 키 (nagix/CNS 슬러그)
  weapon_class        launch_weapon_class not null,-- SRBM/MRBM/IRBM/ICBM/SLBM/SLV/CM/HGV/Unknown
  family              text,                        -- Hwasong / Scud / Pukguksong / Nodong / Musudan / Unha ...
  fuel_type           text check (fuel_type in ('liquid','solid','mixed','unknown')),
  propulsion          text,                        -- 단발/다단/고체모터/액체엔진 등 자유텍스트
  range_km            numeric(8,2),
  dprk_official_name  text,                        -- 북한 공식 명칭 (예: 화성-17형)
  kn_designation      text,                        -- 한미 연합 식별명 (예: KN-23)
  nato_name           text,                        -- NATO 명칭(있으면)
  description         text,
  created_at          timestamptz not null default now()
);
comment on table missiles is 'missiles — 정규 미사일 체계 (온톨로지 canonical)';

-- =========================================================
-- missile_aliases — 4대 명명 체계 통합 (체계명/화성/KN/별칭 외 슬러그·영문)
-- =========================================================
create table if not exists missile_aliases (
  alias_id     uuid primary key default gen_random_uuid(),
  missile_id   uuid not null references missiles(missile_id) on delete cascade,
  alias_text   text not null,                       -- "화성-17", "KN-23", "북한판 이스칸데르", "SRBM"
  alias_type   text not null check (alias_type in
                 ('dprk_official','kn','nato','colloquial','class','slug','english')),
  -- class = 체계명(SRBM/ICBM…) — 동일 class에 속한 모든 미사일이 공유
  source       text,                                -- 근거 (CNS/nagix/언론보도)
  unique (missile_id, alias_text, alias_type)
);
comment on table missile_aliases is 'missile_aliases — 미사일 명칭 온톨로지 (화성/KN/NATO/별칭/체계명)';
create index if not exists missile_aliases_text_idx on missile_aliases (alias_text);
create index if not exists missile_aliases_missile_idx on missile_aliases (missile_id);

-- =========================================================
-- facilities — 정규 미사일 관련 시설 엔티티 (발사장/시험장/공장/기지/항로 포괄)
-- =========================================================
create table if not exists facilities (
  facility_id         uuid primary key default gen_random_uuid(),
  canonical_name      text not null unique,         -- 정규 시설명
  slug                text unique,
  facility_type       text check (facility_type in
                 ('launch_site','test_stand','motor_test','factory','chemical_plant',
                  'airbase','naval_base','rail_site','command','vip','nuclear_site','air_corridor','air_defense_zone','other')),
  region              text,
  lat                 double precision,
  lng                 double precision,
  fuel_type           text check (fuel_type in ('liquid','solid','common','unknown')),
  role                text,                         -- 시설 역할 (발사/엔진시험/산화제생산/동체조립/TEL제작/SLBM/핵시험…)
  parent_facility_id  uuid references facilities(facility_id) on delete set null, -- 하위 구역 계층
  launch_facility_id  uuid references launch_facilities(facility_id) on delete set null, -- CNS 49개 발사장 연결
  description         text,
  created_at          timestamptz not null default now()
);
comment on table facilities is 'facilities — 정규 미사일 관련 시설 (온톨로지 canonical)';

-- =========================================================
-- facility_aliases — 세분화된 location_name/장소명 → 정규 시설 매칭
-- =========================================================
create table if not exists facility_aliases (
  alias_id     uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(facility_id) on delete cascade,
  alias_text   text not null,                       -- observation.location_name 원문 그대로 (예: "동창리 서해위성발사장 - 발사대 및 추진제 저장동")
  alias_type   text not null check (alias_type in
                 ('official','colloquial','sub_area','osint','english','region')),
  source       text,
  unique (facility_id, alias_text, alias_type)
);
comment on table facility_aliases is 'facility_aliases — 위치명 매칭 온톨로지 (location_name → 정규 시설)';
create index if not exists facility_aliases_text_idx on facility_aliases (alias_text);
create index if not exists facility_aliases_facility_idx on facility_aliases (facility_id);

-- launch_cases 에 정규 미사일 연결 (Layer 2+ 이므로 허용; nullable)
alter table launch_cases add column if not exists missile_id uuid references missiles(missile_id) on delete set null;
create index if not exists launch_cases_missile_id_idx on launch_cases (missile_id);

-- RLS: observation/launch_*와 동일 — 해커톤 데이터 파이프라인, 공개 read/write/update/delete.
alter table missiles          enable row level security;
alter table missile_aliases   enable row level security;
alter table facilities        enable row level security;
alter table facility_aliases  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['missiles','missile_aliases','facilities','facility_aliases'] loop
    execute format('create policy %s on %s for select to public using (true);', t||'_read', t);
    execute format('create policy %s on %s for insert to public with check (true);', t||'_write', t);
    execute format('create policy %s on %s for update to public using (true);', t||'_update', t);
    execute format('create policy %s on %s for delete to public using (true);', t||'_delete', t);
  end loop;
end $$;
