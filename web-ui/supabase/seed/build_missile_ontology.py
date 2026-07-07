#!/usr/bin/env python3
"""
build_missile_ontology.py
nagix/nk-missile-tests missile.en.json → missiles + missile_aliases (명명 온톨로지) 시드.
launch_cases.missile_id 를 정규 미사일로 best-effort 연결.

명명 4대 체계를 missile_aliases 로 통합:
  dprk_official(화성/북한공식) / kn(한미) / nato / colloquial(별칭) / class(SRBM·ICBM…) / slug / english

산출(gitignore): supabase/seed/missile_ontology_seed.sql → 원격 적재.
"""
import argparse, json, os, re, subprocess, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'missile_ontology_seed.sql')
DATA_DIR = os.path.join(HERE, 'data')
NAGIX_SHA = '10e0387924a751ce6c07c3874756499bd2f931c8'
NAGIX_URL = f'https://raw.githubusercontent.com/nagix/nk-missile-tests/{NAGIX_SHA}/data/missile.en.json'
NS = uuid.UUID('00000000-0000-0000-0000-000000000000')

WC_MAP = {'SRBM': 'SRBM', 'MRBM': 'MRBM', 'IRBM': 'IRBM', 'ICBM': 'ICBM',
          'SLBM': 'SLBM', 'SLV': 'SLV', 'HGV': 'HGV', 'CM': 'CM', 'Unknown': 'Unknown'}

FUEL = {  # slug -> fuel_type (curated)
    'kn-02': 'solid', 'hwasong-11a': 'solid', 'hwasong-11b': 'solid', 'hwasong-11c': 'solid',
    'hwasong-11d': 'solid', 'hwasong-11-da-45': 'solid', 'hwasong-11s': 'solid', 'kn-25': 'solid',
    'rail-mobile-kn-23': 'solid', 'silo-based-kn-23': 'solid',
    'pukguksong-1': 'solid', 'pukguksong-2': 'solid', 'pukguksong-3': 'solid',
    'hwasong-12b': 'solid', 'hwasong-16b': 'solid', 'hwasong-18': 'solid', 'hwasong-19': 'solid',
    'scud-b': 'liquid', 'scud-c': 'liquid', 'scud-b-marv': 'liquid', 'scud-c-marv': 'liquid',
    'er-scud': 'liquid', 'nodong': 'liquid', 'musudan': 'liquid', 'hwasong-11e': 'liquid',
    'hwasong-12': 'liquid', 'hwasong-12a': 'liquid', 'hwasong-14': 'liquid', 'hwasong-15': 'liquid',
    'hwasong-16a': 'liquid', 'hwasong-17': 'liquid', 'taepodong-1': 'liquid',
    'unha': 'liquid', 'unha-3': 'liquid', 'chollima-1': 'liquid',
}

FAMILY = {  # slug prefix -> family
    'hwasong': 'Hwasong', 'scud': 'Scud', 'er-scud': 'Scud', 'kn-': 'KN',
    'pukguksong': 'Pukguksong', 'nodong': 'Nodong', 'musudan': 'Musudan',
    'unha': 'Unha', 'chollima': 'Chollima', 'taepodong': 'Taepodong',
    'rail-mobile-kn-23': 'KN', 'silo-based-kn-23': 'KN', 'new-irbm-2022': 'IRBM(new)', 'unknown': 'Unknown',
}

# colloquial / 언론 별칭 (well-documented 만)
COLLOQUIAL = {
    'hwasong-11a': ['북한판 이스칸데르', "Kim's Iskander"],
    'hwasong-11b': ['북한판 ATACMS'],
    'kn-25': ['초대형방사포', '600mm 방사포'],
    'hwasong-17': ['괴물 미사일', 'monster missile'],
    'hwasong-18': ['고체연료 ICBM'],
    'musudan': ['무수단', 'BM-25', 'Nodong-B'],
    'nodong': ['노동', 'Scud-D'],
    'pukguksong-1': ['북극성-1', 'Polaris-1'],
    'pukguksong-3': ['북극성-3'],
    # 천리마-1형: 2023.11 만리경-1호 정찰위성 궤도진입 성공(동창리). 만리경-1호는 탑재위성이나
    # 해당 발사사건 RAG 검색 회수율을 높이기 위해 발사체 별칭으로 등록.
    'chollima-1': ['천리마-1형', '만리경-1호'],
}

KR_PREFIX = {'Hwasong': '화성', 'Scud': '스커드', 'Pukguksong': '북극성', 'Nodong': '노동',
             'Musudan': '무수단', 'Unha': '은하', 'Chollima': '천리마', 'Taepodong': '대포동'}

KN_RE = re.compile(r'\bKN-\d+[A-Z]?\b')
PAREN_RE = re.compile(r'\s*\([^)]*\)\s*')


def uuid5(s): return str(uuid.uuid5(NS, s))

def family_of(slug):
    for k, v in FAMILY.items():
        if slug == k or slug.startswith(k.rstrip('-')) or slug.startswith(k):
            return v
    return None

def base_name(full):
    """ 'Hwasong-11A (KN-23)' → 'Hwasong-11A' ; 'Rail-mobile KN-23' → 'Rail-mobile KN-23' """
    return PAREN_RE.sub('', full).strip()

def korean_name(full, family):
    if family in KR_PREFIX:
        m = re.match(r'([A-Za-z]+)(.*)$', base_name(full))
        if m:
            return KR_PREFIX[family] + m.group(2)
    return None


def fetch_nagix():
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, 'missile.en.json')
    if not os.path.exists(path):
        subprocess.run(['curl', '-fsSL', NAGIX_URL, '-o', path], check=True)
    return json.load(open(path, encoding='utf-8'))


def qt(v): return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-apply', action='store_true')
    args = ap.parse_args()

    nagix = fetch_nagix()
    missiles, aliases = [], []
    slug_to_mid = {}

    for slug, v in sorted(nagix.items()):
        full = v['name']
        wc = WC_MAP.get(v.get('type', 'Unknown'), 'Unknown')
        base = base_name(full)
        family = family_of(slug)
        kn = KN_RE.search(full)
        kn = kn.group(0) if kn else None
        mid = uuid5('missile:' + slug)
        slug_to_mid[slug] = mid

        dprk = base if (family in KR_PREFIX or slug.startswith(('scud', 'nodong', 'musudan', 'unha', 'chollima', 'taepodong'))) else None
        missiles.append({
            'missile_id': mid, 'canonical_name': base, 'slug': slug, 'weapon_class': wc,
            'family': family, 'fuel_type': FUEL.get(slug, 'unknown'),
            'dprk_official_name': dprk, 'kn_designation': kn,
            'description': f"{base} ({wc}" + (f", {FUEL.get(slug,'?')}" if FUEL.get(slug) else '') + ')',
        })

        def add(alias_text, alias_type, source='nagix'):
            if alias_text:
                aliases.append({'missile_id': mid, 'alias_text': str(alias_text), 'alias_type': alias_type, 'source': source})

        add(slug, 'slug')
        add(full, 'english')
        add(base, 'dprk_official')
        add(korean_name(full, family), 'dprk_official', source='derived')
        add(kn, 'kn')
        add(wc, 'class', source='derived')
        for c in COLLOQUIAL.get(slug, []):
            add(c, 'colloquial', source='press')

    # launch_cases.missile_id 연결 (이름 정규화 + 소수 수동 오버라이드)
    name_override = {  # CNS missile_name → nagix slug (정규화 불가분)
        'Hwasong-11S (Navalized KN-23)': 'hwasong-11s',
        'New IRBM (2022)': 'new-irbm-2022',
    }

    def name_to_slug(name):
        if name in name_override:
            return name_override[name]
        n = name.rstrip('?').strip()
        for slug, v in nagix.items():
            if v['name'].rstrip('?').strip() == n:
                return slug
        return None

    # launch_cases 현재 이름을 SQL 에서 가져와 매핑 (여기서는 파일 산출만; 매핑은 UPDATE 문으로)
    lines = ['-- AUTO-GENERATED by build_missile_ontology.py (gitignore). 재실행 멱등.',
             '-- 원천: nagix/nk-missile-tests missile.en.json', '']
    lines.append('-- missiles')
    for m in missiles:
        lines.append(
            "insert into missiles (missile_id,canonical_name,slug,weapon_class,family,fuel_type,"
            "dprk_official_name,kn_designation,description) values ("
            f"{qt(m['missile_id'])},{qt(m['canonical_name'])},{qt(m['slug'])},{qt(m['weapon_class'])},"
            f"{qt(m['family'])},{qt(m['fuel_type'])},{qt(m['dprk_official_name'])},{qt(m['kn_designation'])},{qt(m['description'])}"
            ") on conflict (canonical_name) do update set slug=excluded.slug,weapon_class=excluded.weapon_class,"
            "family=excluded.family,fuel_type=excluded.fuel_type,dprk_official_name=excluded.dprk_official_name,"
            "kn_designation=excluded.kn_designation,description=excluded.description;"
        )
    lines.append('\n-- missile_aliases')
    for a in aliases:
        lines.append(
            "insert into missile_aliases (missile_id,alias_text,alias_type,source) values ("
            f"{qt(a['missile_id'])},{qt(a['alias_text'])},{qt(a['alias_type'])},{qt(a['source'])}"
            ") on conflict (missile_id,alias_text,alias_type) do nothing;"
        )

    # launch_cases.missile_id 갱신 — 각 (missile_name → slug → missile_id) 매핑을 CASE 로 인라인
    seen = set()
    upd = []
    for name in [v['name'] for v in nagix.values()] + list(name_override):
        slug = name_to_slug(name)
        if not slug or slug not in slug_to_mid or name in seen:
            continue
        seen.add(name)
        upd.append(f"  when missile_name = {qt(name)} then {qt(slug_to_mid[slug])}")
    if upd:
        lines.append('\n-- launch_cases.missile_id 연결 (best-effort, 미매칭은 null)')
        lines.append("update launch_cases set missile_id = case\n" + '\n'.join(upd) + "\n  else missile_id end\n  where missile_id is null;")
    # CNS '?'/variant 이름도 동일 슬러그로 (Hwasong-12A? → hwasong-12a)
    for qname, canon in [('Hwasong-12A?', 'Hwasong-12A'), ('Hwasong-16A?', 'Hwasong-16A')]:
        canon_slug = name_to_slug(canon)
        if canon_slug in slug_to_mid:
            lines.append(f"update launch_cases set missile_id = {qt(slug_to_mid[canon_slug])} where missile_name = {qt(qname)} and missile_id is null;")

    # missiles.range_km 백필 — launch_cases 실측 최대 비행거리 (missile_id 조인)
    lines.append('\n-- missiles.range_km 백필 (launch_cases 실측 최대 비행거리)')
    lines.append("""update missiles m set range_km = d.range_km
from (
  select missile_id, max(distance_km) as range_km
  from launch_cases where missile_id is not null and distance_km is not null
  group by missile_id
) d
where d.missile_id = m.missile_id and m.range_km is distinct from d.range_km;""")

    with open(SQL_OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'✅ missiles={len(missiles)} aliases={len(aliases)}  → {os.path.relpath(SQL_OUT, WEB_UI)}')

    if args.no_apply:
        print('(--no-apply) 적재 생략'); return
    print('[apply] 원격 적재...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
                       cwd=WEB_UI, capture_output=True, text=True)
    print('✅ 적재 성공' if r.returncode == 0 else '❌ ' + (r.stderr or r.stdout))


if __name__ == '__main__':
    main()
