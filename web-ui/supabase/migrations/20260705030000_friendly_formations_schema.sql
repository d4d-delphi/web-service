-- Layer 2+ 아군(ROK/USFK) 전투서열 온톨로지: friendly_formations + friendly_formation_aliases
-- 적 military_units 와 대칭 — 대한민국 군의 편제(전투비행단/전방군단/미사일·방공사령부/정찰/SIGINT/해군).
-- 원천: 공개 자료(국방백서/공개 보도). 정밀 위경도는 비공개 → 행정구역(시/군) 수준 공개 좌표.
create extension if not exists pgcrypto;

create table if not exists friendly_formations (
  formation_id         uuid primary key default gen_random_uuid(),
  designation          text not null,                   -- 제17전투비행단, 제1군단(광개토), 미사일전략사령부 ...
  formation_type       text not null check (formation_type in
                         ('fighter_wing','recon_wing','army_corps','mobile_corps','missile_cmd',
                          'air_defense_cmd','sam_base','sigint','naval','command','other')),
  branch               text not null check (branch in ('air','army','naval','strategic','sf','other')),
  side                 text not null default 'rok' check (side in ('rok','usfk','combined')),
  parent_formation_id  uuid references friendly_formations(formation_id) on delete set null,
  hq_lat               double precision,                -- 행정구역(시/군) 공개 좌표
  hq_lng               double precision,
  role                 text,                            -- 핵심 임무
  operates             text,                            -- 주요 전력(자산명 자유텍스트)
  readiness            text check (readiness in ('high','medium','low','unknown')),
  base_region          text,                            -- 행정구역(시/군)
  source_ref           text,
  source_url           text,
  created_at           timestamptz not null default now()
);
comment on table friendly_formations is 'friendly_formations — 아군(ROK/USFK) 전투서열 정규 부대 엔티티 (Layer 2+)';

create index if not exists friendly_formations_type_idx   on friendly_formations (formation_type);
create index if not exists friendly_formations_branch_idx on friendly_formations (branch);
create index if not exists friendly_formations_parent_idx on friendly_formations (parent_formation_id);

create table if not exists friendly_formation_aliases (
  alias_id     uuid primary key default gen_random_uuid(),
  formation_id uuid not null references friendly_formations(formation_id) on delete cascade,
  alias_text   text not null,
  alias_type   text not null check (alias_type in ('official','rok','nato','colloquial','slug')),
  source       text,
  unique (formation_id, alias_text, alias_type)
);
comment on table friendly_formation_aliases is 'friendly_formation_aliases — 아군 부대 명칭 온톨로지';
create index if not exists friendly_formation_aliases_text_idx on friendly_formation_aliases (alias_text);
create index if not exists friendly_formation_aliases_fmt_idx   on friendly_formation_aliases (formation_id);

alter table friendly_formations       enable row level security;
alter table friendly_formation_aliases enable row level security;
create policy friendly_formations_read  on friendly_formations        for select to public using (true);
create policy friendly_formations_write on friendly_formations        for insert to public with check (true);
create policy friendly_formations_upd   on friendly_formations        for update to public using (true);
create policy friendly_formations_del   on friendly_formations        for delete to public using (true);
create policy ffa_read  on friendly_formation_aliases for select to public using (true);
create policy ffa_write on friendly_formation_aliases for insert to public with check (true);
create policy ffa_upd   on friendly_formation_aliases for update to public using (true);
create policy ffa_del   on friendly_formation_aliases for delete to public using (true);
