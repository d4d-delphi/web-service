-- Layer 2+ 적 전투서열(ORBAT) 온톨로지: military_units + unit_aliases
-- 근거: 파트너 "전장 중심 사고" — 적(북한군)이 어떻게 구성/기능하는가(전장의 적 축).
-- 원천: 민간 OSINT(GlobalSecurity KPA ORBAT / CSIS / 38 North / NK Uncovered KML / 국방백서 / DIA).
-- canonical+alias 패턴 계승(missiles/missile_aliases, facilities/facility_aliases 참고).
-- 계층(parent_unit_id) + 주둔지(garrison_facility_id→facilities) + 운용체계(operates_missile_id→missiles).

create extension if not exists pgcrypto;

create table if not exists military_units (
  unit_id              uuid primary key default gen_random_uuid(),
  designation          text not null,
  unit_type            text not null check (unit_type in
                         ('corps','division','brigade','regiment','battalion','sf',
                          'missile','air','naval','air_defense','artillery','command','other')),
  branch               text not null check (branch in
                         ('army','air','naval','strategic','sf','other')),
  parent_unit_id       uuid references military_units(unit_id) on delete set null,
  garrison_facility_id uuid references facilities(facility_id) on delete set null,
  hq_lat               double precision,
  hq_lng               double precision,
  strength_est         text,
  readiness            text check (readiness in ('high','medium','low','unknown')),
  role                 text,
  operates_missile_id  uuid references missiles(missile_id) on delete set null,
  source_ref           text,
  source_url           text,
  created_at           timestamptz not null default now()
);
comment on table military_units is 'military_units — 북한군 전투서열(ORBAT) 정규 부대 엔티티 (Layer 2+, OSINT)';

create index if not exists military_units_parent_idx     on military_units (parent_unit_id);
create index if not exists military_units_branch_idx     on military_units (branch);
create index if not exists military_units_type_idx       on military_units (unit_type);
create index if not exists military_units_garrison_idx   on military_units (garrison_facility_id);
create index if not exists military_units_missile_idx    on military_units (operates_missile_id);

create table if not exists unit_aliases (
  alias_id     uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references military_units(unit_id) on delete cascade,
  alias_text   text not null,
  alias_type   text not null check (alias_type in ('official','dprk','nato','colloquial','slug')),
  source       text,
  unique (unit_id, alias_text, alias_type)
);
comment on table unit_aliases is 'unit_aliases — 부대 명칭 온톨로지';
create index if not exists unit_aliases_text_idx  on unit_aliases (alias_text);
create index if not exists unit_aliases_unit_idx  on unit_aliases (unit_id);

alter table military_units enable row level security;
alter table unit_aliases   enable row level security;

create policy military_units_read   on military_units for select to public using (true);
create policy military_units_write  on military_units for insert to public with check (true);
create policy military_units_update on military_units for update to public using (true);
create policy military_units_delete on military_units for delete to public using (true);

create policy unit_aliases_read   on unit_aliases for select to public using (true);
create policy unit_aliases_write  on unit_aliases for insert to public with check (true);
create policy unit_aliases_update on unit_aliases for update to public using (true);
create policy unit_aliases_delete on unit_aliases for delete to public using (true);
