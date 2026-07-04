#!/usr/bin/env python3
"""
export_emitter_mirror.py
원격 Supabase 에서 emitters(+aliases) 를 쿼리해 lib/emitter.ts 가 서버 런타임 fs 로 읽을
평면 JSON 미러로 내보낸다 (키 불필요).

산출(gitignore, data/ 패턴):
  web-ui/src/data/emitter-ontology.json
"""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(WEB_UI, 'src', 'data', 'emitter-ontology.json')


def query(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S)
    if not m:
        m = re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def main():
    print('[1/1] emitters + aliases 쿼리...')
    rows = query("""
        select e.canonical_name, e.slug, e.designation, e.emitter_type, e.band,
               e.nato_name, e.associated_system, e.platform, e.role,
               e.frequency_params, e.threat_relevance, e.description,
               coalesce(array_agg(ea.alias_text) filter (where ea.alias_text is not null), '{}') as aliases
        from emitters e left join emitter_aliases ea on ea.emitter_id = e.emitter_id
        group by e.emitter_id order by e.threat_relevance, e.canonical_name;""")
    emitters = [{
        'canonicalName': r['canonical_name'], 'slug': r['slug'],
        'designation': r['designation'], 'emitterType': r['emitter_type'],
        'band': r['band'], 'natoName': r['nato_name'],
        'associatedSystem': r['associated_system'], 'platform': r['platform'],
        'role': r['role'], 'frequencyParams': r['frequency_params'],
        'threatRelevance': r['threat_relevance'], 'description': r['description'],
        'aliases': sorted({a for a in r['aliases'] if a}),
    } for r in rows]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(emitters, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'      {len(emitters)} emitters → {os.path.relpath(OUT, WEB_UI)}')
    print('\n✅ emitter 온톨로지 미러 내보내기 완료')


if __name__ == '__main__':
    main()
