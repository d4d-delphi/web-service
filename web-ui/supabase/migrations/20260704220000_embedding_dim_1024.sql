-- 임베딩 차원 1536 → 1024 (BAAI/bge-m3 로컬 임베딩 전환).
-- 근거: bge-m3 = 1024차원, MIT, 한/영 코드스위칭 강점, DGX 로컬 추론 ~10-30ms/쿼리.
-- 주의: vector(1536)→vector(1024)는 차원 축소라 데이터가 있으면 실패. 임베딩이 전부 NULL인
--       지금(백필 전)이 유일한 변경 창. using null 로 (어차피 NULL인) 기존값 무시.
alter table launch_cases
  alter column embedding type vector(1024) using null;

-- RPC 시그니처도 1024로 재정의
drop function if exists match_launch_cases(vector(1536), int);
create or replace function match_launch_cases(query_embedding vector(1024), match_count int default 5)
returns table (
  case_id uuid, case_no int, launch_date date, missile_name text,
  weapon_class launch_weapon_class, outcome launch_outcome,
  indicators text[], description text, distance float, similarity float
)
language sql stable
as $$
  select case_id, case_no, launch_date, missile_name, weapon_class, outcome,
         indicators, description,
         embedding <=> query_embedding as distance,
         1 - (embedding <=> query_embedding) as similarity
  from launch_cases
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
comment on function match_launch_cases is 'launch_cases pgvector 유사도 검색 (bge-m3 1024차원). embedding 백필 후 사용.';

-- HNSW 인덱스 (cosine) — 백필 전에 생성해도 NULL은 제외됨, 백필 후 즉시 효과
create index if not exists launch_cases_embedding_hnsw
  on launch_cases using hnsw (embedding vector_cosine_ops);
