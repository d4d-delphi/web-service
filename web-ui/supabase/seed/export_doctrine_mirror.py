#!/usr/bin/env python3
"""
export_doctrine_mirror.py
원격 Supabase 에서 교리 6개 테이블을 쿼리해 RAG/보고용 평면 JSON 미러로 내보낸다.
lib/doctrine.ts 가 서버 런타임에 fs 로 읽는다 (키 불필요, fresh clone 시 빈 폴백).

산출(gitignore, src/data/ 패턴):
  web-ui/src/data/doctrine-ontology.json
"""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(WEB_UI, 'src', 'data', 'doctrine-ontology.json')


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
    print('[1/6] watchcon_levels...')
    watchcon = query("""select level, name, english_name, meaning, activation_condition, recommended_posture
                        from watchcon_levels order by level desc;""")
    print('[2/6] killchain_phases...')
    killchain = query("""select phase, korean_name, ordinal, entry_condition, exit_condition, description
                         from killchain_phases order by ordinal;""")
    print('[3/6] response_options...')
    options = query("""select option_id, pillar, pillar_name, asset, trigger_phase,
                              authority_threshold, priority, description
                       from response_options order by priority, pillar;""")
    print('[4/6] c2_authority...')
    c2 = query("""select tier, authority, role, decision_threshold, reporting_chain
                  from c2_authority order by tier;""")
    print('[5/6] roe_categories...')
    roe = query("""select category_id, name, allowed_actions, activation_watchcon, description
                   from roe_categories order by activation_watchcon;""")
    print('[6/6] friendly_assets_doctrine...')
    assets = query("""select canonical_name, slug, pillar, asset_type, range_km, detection_range_km,
                             readiness, current_watchcon, description
                      from friendly_assets_doctrine order by pillar, canonical_name;""")

    def num(x):
        return None if x is None else float(x)

    mirror = {
        'watchconLevels': [{
            'level': r['level'], 'name': r['name'], 'englishName': r['english_name'],
            'meaning': r['meaning'], 'activationCondition': r['activation_condition'],
            'recommendedPosture': r['recommended_posture'],
        } for r in watchcon],
        'killchainPhases': [{
            'phase': r['phase'], 'koreanName': r['korean_name'], 'ordinal': r['ordinal'],
            'entryCondition': r['entry_condition'], 'exitCondition': r['exit_condition'],
            'description': r['description'],
        } for r in killchain],
        'responseOptions': [{
            'optionId': r['option_id'], 'pillar': r['pillar'], 'pillarName': r['pillar_name'],
            'asset': r['asset'], 'triggerPhase': r['trigger_phase'],
            'authorityThreshold': r['authority_threshold'], 'priority': r['priority'],
            'description': r['description'],
        } for r in options],
        'c2Authority': [{
            'tier': r['tier'], 'authority': r['authority'], 'role': r['role'],
            'decisionThreshold': r['decision_threshold'], 'reportingChain': r['reporting_chain'],
        } for r in c2],
        'roeCategories': [{
            'categoryId': r['category_id'], 'name': r['name'], 'allowedActions': r['allowed_actions'],
            'activationWatchcon': r['activation_watchcon'], 'description': r['description'],
        } for r in roe],
        'friendlyAssets': [{
            'canonicalName': r['canonical_name'], 'slug': r['slug'], 'pillar': r['pillar'],
            'assetType': r['asset_type'], 'rangeKm': num(r['range_km']),
            'detectionRangeKm': num(r['detection_range_km']), 'readiness': r['readiness'],
            'currentWatchcon': r['current_watchcon'], 'description': r['description'],
        } for r in assets],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(mirror, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    total = sum(len(v) for v in mirror.values())
    print(f'\n✅ 교리 온톨로지 미러 내보내기 완료: {total}행 → {os.path.relpath(OUT, WEB_UI)}')


if __name__ == '__main__':
    main()
