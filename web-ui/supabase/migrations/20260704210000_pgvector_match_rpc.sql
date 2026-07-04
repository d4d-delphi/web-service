-- pgvector 유사도 검색 RPC for launch_cases (과거 전례 매칭).
-- backfill_embeddings.py 로 launch_cases.embedding 을 채운 뒤 사용.
-- 호출: select * from match_launch_cases(<1536차원 벡터>, 5);
create or replace function match_launch_cases(query_embedding vector(1536), match_count int default 5)
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
comment on function match_launch_cases is 'launch_cases pgvector 유사도 검색 (과거 전례 매칭). embedding 백필 후 사용.';
