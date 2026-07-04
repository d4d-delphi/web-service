#!/usr/bin/env python3
"""export_friendly_formations_mirror.py — 원격 friendly_formations(+aliases) → src/data/friendly-formations.json 평면 미러."""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(WEB_UI, 'src', 'data', 'friendly-formations.json')


def q(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S) or re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def main():
    rows = q("""
      select f.designation, f.formation_type, f.branch, f.side, f.hq_lat, f.hq_lng,
             f.role, f.operates, f.readiness, f.base_region,
             p.designation as parent,
             coalesce(array_agg(a.alias_text) filter (where a.alias_text is not null), '{}') as aliases
      from friendly_formations f
      left join friendly_formations p on p.formation_id = f.parent_formation_id
      left join friendly_formation_aliases a on a.formation_id = f.formation_id
      group by f.formation_id, p.designation order by f.branch, f.formation_type, f.designation;""")
    out = [{
        'designation': r['designation'], 'formationType': r['formation_type'], 'branch': r['branch'],
        'side': r['side'], 'hqLat': r['hq_lat'], 'hqLng': r['hq_lng'], 'role': r['role'],
        'operates': r['operates'], 'readiness': r['readiness'], 'baseRegion': r['base_region'],
        'parentDesignation': r['parent'], 'aliases': sorted({a for a in r['aliases'] if a}),
    } for r in rows]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'✅ {len(out)} friendly formations → {os.path.relpath(OUT, WEB_UI)}')


if __name__ == '__main__':
    main()
