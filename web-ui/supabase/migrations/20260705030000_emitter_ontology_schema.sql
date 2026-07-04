-- Layer 2+ 온톨로지: 방출원(emitter) 정규 엔티티 + 별명(alias)
-- 근거: SIGINT observation(asset_type='SIGINT')은 "방공 감시레이더 계열"/"텔레메트리 송신 계열"/
--       "미상" 같은 generic emitter_guess 를 가지며, 이를 정규 엔티티(레이더/통신/텔레메트리)로
--       해석할 온톨로지가 없었다. 방공·발사 징후 해석(SIGINT/교차검증)에 필수.
-- 목적: Palantir 온톨로지 패턴 계승(missiles/missile_aliases, facilities/facility_aliases).
--   1) emitters        — 정규 방출원 (Fan Song/SA-2, Straight Flush/SA-6, 조기경보, 텔레메트리, 통신망...)
--   2) emitter_aliases — NATO명/한글/영문/신호패턴 묘사(alias_text) → 정규 emitter 매칭
-- observation(Layer1)은 asset_detail.emitter_guess 자유텍스트를 그대로 두고(§5), 매칭은 본 온톨로지로.
--
-- ⚠️ 제원(대역/PRI/PW)은 공개 OSINT(GlobalSecurity/CSIS/IHS Jane's 공개/Wikipedia) 기반 illustrative stub.
--    실 운용 수치·체계연동이 아님. source_ref 인증.
-- 충돌 회피: associated_unit 은 military_units FK 가 아닌 텍스트(designation) — ORBAT 데이터는 메인 세션 소유.

create extension if not exists pgcrypto;

-- =========================================================
-- emitters — 정규 방출원 엔티티 (레이더/통신/텔레메트리/데이터링크)
-- =========================================================
create table if not exists emitters (
  emitter_id        uuid primary key default gen_random_uuid(),
  canonical_name    text not null unique,         -- 정규 표기 (예: Fan Song, Telemetry S-Band PCM/FM)
  slug              text unique,                  -- 정규화 키
  designation       text not null,                -- NATO reporting name / 정규 명칭
  emitter_type      text not null check (emitter_type in
                      ('SEARCH','FIRE_CONTROL','SEARCH_FIRE','EARLY_WARNING',
                       'COMMS','TELEMETRY','DATALINK','NAVIGATION','UNKNOWN')),
  band              text,                         -- 주 대역(VHF/UHF/S-Band/E-F/G-H/X...) — 공개범위
  nato_name         text,                         -- NATO reporting name (있으면)
  associated_system text,                         -- 연동 체계(텍스트): SA-2/SA-5/SA-6/S-300/SLV/야전망...
  platform          text,                         -- 탑재/운용 플랫폼(지상/차량/함정/공중)
  role              text,                         -- 운용 역할(탐색/사격통제/추적/텔레메트리/지휘통신...)
  frequency_params  jsonb not null default '{}',  -- 전형적 신호 파라미터(PRI/PW/Scan/Modulation) — 공개범위
  threat_relevance  text check (threat_relevance in
                      ('launch_indicator','air_defense','background','comms','neutral','unknown')),
  source_ref        text,                         -- 근거(GlobalSecurity/CSIS/언론보도)
  source_url        text,
  description       text,
  created_at        timestamptz not null default now()
);
comment on table emitters is 'emitters — 정규 방출원(레이더/통신/텔레메트리) 온톨로지 canonical (Layer 2+, 공개 OSINT만)';

create index if not exists emitters_type_idx    on emitters (emitter_type);
create index if not exists emitters_band_idx    on emitters (band);
create index if not exists emitters_relevance_idx on emitters (threat_relevance);

-- =========================================================
-- emitter_aliases — 방출원 명칭 온톨로지 (NATO명/한글/영문/신호패턴 묘사 통합)
-- alias_type=signal_pattern: observation의 generic emitter_guess("방공 감시레이더 계열" 등) →
--                            정규 emitter 매칭용 묘사 별칭. 여러 emitter가 공유 가능(1:N).
-- =========================================================
create table if not exists emitter_aliases (
  alias_id    uuid primary key default gen_random_uuid(),
  emitter_id  uuid not null references emitters(emitter_id) on delete cascade,
  alias_text  text not null,                      -- "Fan Song", "방공 감시레이더 계열", "SA-2 레이더"...
  alias_type  text not null check (alias_type in
                ('nato','official','colloquial','english','slug','signal_pattern','korean')),
  source      text,
  unique (emitter_id, alias_text, alias_type)
);
comment on table emitter_aliases is 'emitter_aliases — 방출원 명칭 온톨로지 (NATO/한글/영문/신호패턴묘사)';
create index if not exists emitter_aliases_text_idx   on emitter_aliases (alias_text);
create index if not exists emitter_aliases_emitter_idx on emitter_aliases (emitter_id);

-- =========================================================
-- RLS: 공개 read/write/update/delete (기존 테이블과 동일 — 해커톤 데이터 파이프라인)
-- =========================================================
alter table emitters         enable row level security;
alter table emitter_aliases  enable row level security;

create policy emitters_read   on emitters for select to public using (true);
create policy emitters_write  on emitters for insert to public with check (true);
create policy emitters_update on emitters for update to public using (true);
create policy emitters_delete on emitters for delete to public using (true);

create policy emitter_aliases_read   on emitter_aliases for select to public using (true);
create policy emitter_aliases_write  on emitter_aliases for insert to public with check (true);
create policy emitter_aliases_update on emitter_aliases for update to public using (true);
create policy emitter_aliases_delete on emitter_aliases for delete to public using (true);
