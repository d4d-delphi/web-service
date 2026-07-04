#!/usr/bin/env python3
"""
export_ontology_mirror.py
원격 Supabase 에서 missiles(+aliases)·facilities(+aliases) 를 쿼리해
RAG/추론용 평면 JSON 미러로 내보낸다 (lib/ontology.ts 가 서버 런타임 fs 로 읽음, 키 불필요).

산출(gitignore, data/ 패턴):
  web-ui/src/data/missile-ontology.json
  web-ui/src/data/facility-ontology.json
"""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_MISSILE = os.path.join(WEB_UI, 'src', 'data', 'missile-ontology.json')
OUT_FACILITY = os.path.join(WEB_UI, 'src', 'data', 'facility-ontology.json')


def query(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S)
    if not m:
        # array literal 종료가 다를 수 있어 보정
        m = re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def main():
    print('[1/2] missiles + aliases 쿼리...')
    mrows = query("""
        select m.canonical_name, m.slug, m.weapon_class, m.family, m.fuel_type,
               m.kn_designation, m.range_km,
               coalesce(array_agg(ma.alias_text) filter (where ma.alias_text is not null), '{}') as aliases
        from missiles m left join missile_aliases ma on ma.missile_id = m.missile_id
        group by m.missile_id order by m.canonical_name;""")
    missiles = [{
        'canonicalName': r['canonical_name'], 'slug': r['slug'],
        'weaponClass': r['weapon_class'], 'family': r['family'], 'fuelType': r['fuel_type'],
        'kn': r['kn_designation'], 'rangeKm': r['range_km'],
        'aliases': sorted({a for a in r['aliases'] if a}),
    } for r in mrows]
    os.makedirs(os.path.dirname(OUT_MISSILE), exist_ok=True)
    json.dump(missiles, open(OUT_MISSILE, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'      {len(missiles)} missiles → {os.path.relpath(OUT_MISSILE, WEB_UI)}')

    print('[2/2] facilities + aliases 쿼리...')
    frows = query("""
        select f.canonical_name, f.slug, f.facility_type, f.region, f.lat, f.lng,
               f.fuel_type, f.role, f.launch_facility_id,
               coalesce(array_agg(fa.alias_text) filter (where fa.alias_text is not null), '{}') as aliases
        from facilities f left join facility_aliases fa on fa.facility_id = f.facility_id
        group by f.facility_id order by f.canonical_name;""")
    facilities = [{
        'canonicalName': r['canonical_name'], 'slug': r['slug'],
        'facilityType': r['facility_type'], 'region': r['region'],
        'lat': r['lat'], 'lng': r['lng'], 'fuelType': r['fuel_type'], 'role': r['role'],
        'launchFacilityId': r['launch_facility_id'],
        'aliases': sorted({a for a in r['aliases'] if a}),
    } for r in frows]
    json.dump(facilities, open(OUT_FACILITY, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'      {len(facilities)} facilities → {os.path.relpath(OUT_FACILITY, WEB_UI)}')

    print(f'\n✅ 온톨로지 미러 내보내기 완료')


if __name__ == '__main__':
    main()
