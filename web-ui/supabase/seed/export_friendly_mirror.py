#!/usr/bin/env python3
"""
export_friendly_mirror.py — 원격 friendly_units(+aliases, doctrine option 해석)를
web-ui/src/data/friendly-units.json 평면 미러로 내보낸다.
(lib/blue.ts 가 서버 fs 로 읽음, 키 불필요)
"""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(WEB_UI, 'src', 'data', 'friendly-units.json')


def q(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S) or re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def main():
    rows = q("""
      select f.canonical_name, f.slug, f.designation, f.asset_type, f.branch,
             f.role, f.capability, f.range_km, f.detection_range_km, f.readiness,
             f.base_name, f.hq_lat, f.hq_lng, f.source_ref, f.source_url, f.description,
             f.operates_doctrine_option as doctrine_option,
             coalesce(array_agg(fa.alias_text) filter (where fa.alias_text is not null), '{}') as aliases
      from friendly_units f
      left join friendly_unit_aliases fa on fa.friendly_id = f.friendly_id
      group by f.friendly_id
      order by f.asset_type, f.branch, f.canonical_name;""")
    units = [{
        'canonicalName': r['canonical_name'], 'slug': r['slug'], 'designation': r['designation'],
        'assetType': r['asset_type'], 'branch': r['branch'], 'role': r['role'],
        'capability': r['capability'], 'rangeKm': r['range_km'], 'detectionRangeKm': r['detection_range_km'],
        'readiness': r['readiness'], 'baseName': r['base_name'],
        'hqLat': r['hq_lat'], 'hqLng': r['hq_lng'],
        'sourceRef': r['source_ref'], 'sourceUrl': r['source_url'],
        'description': r['description'], 'doctrineOption': r['doctrine_option'],
        'aliases': sorted({a for a in r['aliases'] if a}),
    } for r in rows]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(units, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'✅ {len(units)} friendly units → {os.path.relpath(OUT, WEB_UI)}')


if __name__ == '__main__':
    main()
