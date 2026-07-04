#!/usr/bin/env python3
"""
backfill_embeddings.py
launch_cases.description → BAAI/bge-m3 로컬 임베딩(1024차원) → launch_cases.embedding 백필.
이후 RAG(match_launch_cases RPC)가 의미론적 유사도 검색 가능.

정책: 외부 API(OpenAI) 미사용 — DGX 로컬 추론으로 폐쇄망/국방 망분리 준수.

요구 (DGX에서):
  pip install FlagEmbedding torch
  (폐쇄망 전) huggingface-cli download BAAI/bge-m3   # ~2.2GB 사전 다운로드

사용:
  python3 backfill_embeddings.py            # 전체 백필 (GPU)
  python3 backfill_embeddings.py --dry-run  # 1건만 임베딩 생성 확인(미기입)
"""
import argparse, json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIM = 1024
BATCH = 32


def query_db(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ DB 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S) or re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def run_sql_file(sql_text):
    path = '/tmp/_backfill_embeddings.sql'
    open(path, 'w', encoding='utf-8').write(sql_text)
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', path],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 적재 실패:\n' + (r.stderr or r.stdout))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    try:
        from FlagEmbedding import BGEM3FlagModel
    except ImportError:
        sys.exit('❌ FlagEmbedding 없음: pip install FlagEmbedding torch (DGX 로컬). bge-m3 사용.')

    print('[init] BAAI/bge-m3 로드 (DGX GPU, fp16)...')
    model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True)

    rows = query_db("""select case_id, case_no, coalesce(description,'') as description
                       from launch_cases where embedding is null order by case_no;""")
    print(f'백필 대상: {len(rows)}건')
    if not rows:
        print('✅ 이미 전체 백필됨'); return

    if args.dry_run:
        sample = rows[0]['description'] or f"case {rows[0]['case_no']}"
        emb = model.encode([sample], return_dense=True, return_sparse=False, return_colbert_vecs=False)['dense_vecs']
        print(f'--dry-run: 1건 임베딩 차원={len(emb[0])} (기대 {DIM}). 미기입.'); return

    updates = []
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        texts = [r['description'] or f"case {r['case_no']}" for r in batch]
        out = model.encode(texts, batch_size=len(batch), return_dense=True,
                           return_sparse=False, return_colbert_vecs=False)
        vecs = out['dense_vecs']
        for r, vec in zip(batch, vecs):
            vec = list(vec)
            assert len(vec) == DIM, f'차원 불일치 {len(vec)}≠{DIM}'
            vec_sql = '[' + ','.join(f'{float(x):.7f}' for x in vec) + ']'
            updates.append(f"update launch_cases set embedding = '{vec_sql}'::vector where case_id = '{r['case_id']}';")
        print(f'  임베딩 {min(i + BATCH, len(rows))}/{len(rows)}')

    run_sql_file('\n'.join(updates) + '\n')
    print(f'✅ {len(updates)}건 embedding 백필 완료 (bge-m3, {DIM}차원). match_launch_cases RPC 사용 가능.')


if __name__ == '__main__':
    main()
