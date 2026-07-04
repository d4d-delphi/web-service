#!/usr/bin/env python3
"""
backfill_embeddings.py
launch_cases.description → OpenAI 임베딩(1536차원) 생성 → launch_cases.embedding 백필.
이후 RAG(match_launch_cases RPC)가 의미론적 유사도 검색 가능.

요구: pip install openai + 환경변수 OPENAI_API_KEY (프로젝트엔 아직 미설정 → 키 확보 후 실행).
모델: text-embedding-3-small (1536 dim, launch_cases.embedding vector(1536)과 일치).

사용:
  export OPENAI_API_KEY=...
  pip install openai
  python3 backfill_embeddings.py            # 전체 백필
  python3 backfill_embeddings.py --dry-run  # 임베딩 생성만 확인(미기입)
"""
import argparse, json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODEL = 'text-embedding-3-small'
DIM = 1536
BATCH = 100


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

    if not os.environ.get('OPENAI_API_KEY'):
        sys.exit('❌ OPENAI_API_KEY 가 설정되지 않음. 키 확보 후 실행 (project .env 미설정).')

    try:
        from openai import OpenAI
    except ImportError:
        sys.exit('❌ openai 패키지 없음: pip install openai')

    client = OpenAI()

    rows = query_db(f"""select case_id, case_no, coalesce(description,'') as description
                        from launch_cases where embedding is null order by case_no;""")
    print(f'백필 대상: {len(rows)}건')
    if not rows:
        print('✅ 이미 전체 백필됨'); return

    updates = []
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        texts = [r['description'] or f"case {r['case_no']}" for r in batch]
        resp = client.embeddings.create(model=MODEL, input=texts)
        for r, item in zip(batch, resp.data):
            vec = item.embedding
            assert len(vec) == DIM, f'차원 불일치 {len(vec)}≠{DIM}'
            vec_sql = '[' + ','.join(f'{x:.7f}' for x in vec) + ']'
            updates.append(f"update launch_cases set embedding = '{vec_sql}'::vector where case_id = '{r['case_id']}';")
        print(f'  임베딩 {min(i + BATCH, len(rows))}/{len(rows)}')

    if args.dry_run:
        print(f'--dry-run: {len(updates)}건 생성, 미기입'); return

    run_sql_file('\n'.join(updates) + '\n')
    print(f'✅ {len(updates)}건 embedding 백필 완료. match_launch_cases RPC 사용 가능.')


if __name__ == '__main__':
    main()
