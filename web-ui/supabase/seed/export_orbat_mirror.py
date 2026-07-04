#!/usr/bin/env python3
"""
export_orbat_mirror.py — 원격 military_units(+aliases, facility/missile/parent 해석)를
web-ui/src/data/orbat-units.json 평면 미러로 내보낸다. (lib/orbat 이 서버 fs 로 읽음, 키 불필요)
"""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(WEB_UI, 'src', 'data', 'orbat-units.json')


def q(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S) or re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def main():
    rows = q("""
      select m.designation, m.unit_type, m.branch, m.hq_lat, m.hq_lng,
             m.strength_est, m.readiness, m.role, m.source_ref,
             p.designation as parent,
             f.canonical_name as facility,
             mi.slug as missile,
             coalesce(array_agg(ua.alias_text) filter (where ua.alias_text is not null), '{}') as aliases
      from military_units m
      left join military_units p on p.unit_id = m.parent_unit_id
      left join facilities    f on f.facility_id = m.garrison_facility_id
      left join missiles      mi on mi.missile_id = m.operates_missile_id
      left join unit_aliases  ua on ua.unit_id = m.unit_id
      group by m.unit_id, p.designation, f.canonical_name, mi.slug
      order by m.branch, m.unit_type, m.designation;""")
    units = [{
        'designation': r['designation'], 'unitType': r['unit_type'], 'branch': r['branch'],
        'hqLat': r['hq_lat'], 'hqLng': r['hq_lng'],
        'strengthEst': r['strength_est'], 'readiness': r['readiness'], 'role': r['role'],
        'sourceRef': r['source_ref'], 'parentDesignation': r['parent'],
        'garrisonFacility': r['facility'], 'operatesMissile': r['missile'],
        'aliases': sorted({a for a in r['aliases'] if a}),
    } for r in rows]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(units, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'✅ {len(units)} units → {os.path.relpath(OUT, WEB_UI)}')


if __name__ == '__main__':
    main()
