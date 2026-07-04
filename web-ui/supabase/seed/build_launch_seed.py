#!/usr/bin/env python3
"""
build_launch_seed.py
CNS North Korea Missile Test Database (CSV) + nagix/nk-missile-tests (bearing)
→ launch_facilities / launch_cases (Layer 2+) 시드 생성 + 원격 Supabase 적재.

산출(gitignore — 데이터, supabase가 source of truth):
  web-ui/supabase/seed/data/test.en.json, facility.en.json   (nagix 캐시)
  web-ui/supabase/seed/launch_cases_seed.sql                  (INSERT, ON CONFLICT 멱등)
  web-ui/src/data/launch-cases.json                           (RAG 키워드용 평면 미러)

사용:
  python3 build_launch_seed.py            # 생성 + 원격 적재
  python3 build_launch_seed.py --no-apply # 파일만 생성
  python3 build_launch_seed.py --csv-dir ~/Downloads

원격 적재는 아래와 동일:
  cd web-ui && npx supabase db query --linked -f supabase/seed/launch_cases_seed.sql
"""
import argparse, csv, json, math, os, re, subprocess, sys, urllib.request, uuid
from datetime import datetime

# ----------------------------- config -----------------------------
HERE = os.path.dirname(os.path.abspath(__file__))               # web-ui/supabase/seed
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
DATA_DIR = os.path.join(HERE, 'data')
SQL_OUT = os.path.join(HERE, 'launch_cases_seed.sql')
JSON_OUT = os.path.join(WEB_UI, 'src', 'data', 'launch-cases.json')

TESTS_CSV_NAME = 'north_korea_missile_test_database(Missile Tests).csv'
FACIL_CSV_NAME = 'north_korea_missile_test_database(Facilities).csv'

# nagix pinned commit (재현성)
NAGIX_SHA = '10e0387924a751ce6c07c3874756499bd2f931c8'
NAGIX_BASE = f'https://raw.githubusercontent.com/nagix/nk-missile-tests/{NAGIX_SHA}/data'
NAGIX_TEST_URL = f'{NAGIX_BASE}/test.en.json'
NAGIX_FACIL_URL = f'{NAGIX_BASE}/facility.en.json'

NS = uuid.UUID('00000000-0000-0000-0000-000000000000')   # deterministic uuid5 namespace


# ----------------------------- helpers -----------------------------
def slugify(s: str) -> str:
    s = (s or '').strip().lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

def parse_date(s: str):
    s = (s or '').strip()
    if not s:
        return None
    d = None
    for fmt in ('%d-%b-%y', '%b-%y'):     # '09-Apr-84' 또는 'Sep-84'(일자 미상→1일)
        try:
            d = datetime.strptime(s, fmt).date()
            break
        except ValueError:
            continue
    if d is None:
        return None
    if d.year >= 2070:                    # 2자리 연도 피봇: 84..24 → 1984..2024
        d = d.replace(year=d.year - 100)
    return d.isoformat()

def parse_time(s: str):
    s = (s or '').strip()
    if not s or s.lower() in ('unknown', 'n/a'):
        return None
    s = re.sub(r'^[^0-9]+', '', s)        # "??" 등 비숫자 접두어 제거
    for fmt in ('%H:%M:%S', '%H:%M'):
        try:
            return datetime.strptime(s, fmt).strftime('%H:%M:%S')
        except ValueError:
            continue
    return None

KN_RE = re.compile(r'\bKN-\d+[A-Z]?\b')
def extract_kn(name: str):
    m = KN_RE.search(name or '')
    return m.group(0) if m else None

def parse_measure(s: str):
    """ '1,380 km' / 'between 25 and 90 km' / 'Unknown' → (float|None, raw) ; 범위는 상한 """
    raw = (s or '').strip()
    if not raw or raw.lower() in ('unknown', 'n/a'):
        return None, (raw or None)
    nums = re.findall(r'[\d,]+(?:\.\d+)?', raw)
    vals = []
    for n in nums:
        n2 = n.replace(',', '')
        if n2.replace('.', '').isdigit():
            vals.append(float(n2))
    if not vals:
        return None, raw
    return max(vals), raw

LANDING_RX = [
    (re.compile(r'east sea|sea of japan', re.I), 'sea_of_japan'),
    (re.compile(r'west sea|yellow sea', re.I), 'yellow_sea'),
    (re.compile(r'pacific', re.I), 'pacific'),
    (re.compile(r'orbital', re.I), 'orbital'),
]
def landing_region(s: str):
    s = (s or '').strip()
    if not s:
        return 'na'
    low = s.lower()
    if low == 'unknown':
        return 'unknown'
    if low == 'n/a':
        return 'na'
    for rx, val in LANDING_RX:
        if rx.search(s):
            return val
    return 'unknown'

REGION_KR = {'sea_of_japan': '동해', 'yellow_sea': '서해', 'pacific': '태평양',
             'orbital': '궤도진입', 'na': '미상', 'unknown': '미상'}
OUTCOME_KR = {'success': '성공', 'failure': '실패', 'unknown': '미상'}

def dest_point(lat, lng, bearing_deg, distance_km):
    """대권 목적점 (φ2, λ2). 인자 하나라도 None → (None,None)."""
    if None in (lat, lng, bearing_deg, distance_km):
        return None, None
    R = 6371.0
    d = distance_km / R
    br = math.radians(bearing_deg)
    lat1, lng1 = math.radians(lat), math.radians(lng)
    sin_lat1, cos_lat1 = math.sin(lat1), math.cos(lat1)
    sin_d, cos_d = math.sin(d), math.cos(d)
    lat2 = math.asin(sin_lat1 * cos_d + cos_lat1 * sin_d * math.cos(br))
    lng2 = lng1 + math.atan2(math.sin(br) * sin_d * cos_lat1, cos_d - sin_lat1 * math.sin(lat2))
    return round(math.degrees(lat2), 6), round((math.degrees(lng2) + 540) % 360 - 180, 6)

def to_float(s):
    s = (s or '').strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None

def uuid5(name: str) -> str:
    return str(uuid.uuid5(NS, name))


# ----------------------------- nagix fetch/cache -----------------------------
def fetch_cached(url: str, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        print(f'  fetching {url}')
        # curl 사용 (macOS Python SSL 인증서 이슈 회피)
        res = subprocess.run(['curl', '-fsSL', url, '-o', path],
                             capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit(f'❌ fetch 실패 {url}:\n{res.stderr}')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ----------------------------- SQL emit -----------------------------
def q_text(v):
    return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"

def q_num(v):
    return 'NULL' if v is None else str(v)

def q_arr(vs):
    vs = [v for v in (vs or []) if v not in (None, '')]
    if not vs:
        return "'{}'"
    return 'ARRAY[' + ','.join(q_text(v) for v in vs) + ']'


# ----------------------------- main -----------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv-dir', default=os.path.expanduser('~/Downloads'))
    ap.add_argument('--no-apply', action='store_true', help='파일만 생성(원격 적재 생략)')
    args = ap.parse_args()

    tests_csv = os.path.join(args.csv_dir, TESTS_CSV_NAME)
    facil_csv = os.path.join(args.csv_dir, FACIL_CSV_NAME)
    for p in (tests_csv, facil_csv):
        if not os.path.exists(p):
            sys.exit(f'❌ 입력 CSV 없음: {p}')

    # ---- nagix (bearing) ----
    print('[1/5] nagix 데이터 fetch (bearing 보강용)')
    nagix_test = fetch_cached(NAGIX_TEST_URL, os.path.join(DATA_DIR, 'test.en.json'))
    nagix_facil = fetch_cached(NAGIX_FACIL_URL, os.path.join(DATA_DIR, 'facility.en.json'))['facilities']
    nagix_recs = [x for b in nagix_test['timeBins'] for x in b['data']]
    # date → [{facility_slug, lat, lng, bearing}]
    nagix_by_date = {}
    for r in nagix_recs:
        f = nagix_facil.get(r.get('facility'), {})
        b = r.get('bearing')
        nagix_by_date.setdefault(r.get('date'), []).append({
            'lat': f.get('lat'), 'lng': f.get('lon'),
            'bearing': float(b) if isinstance(b, (int, float)) else None,
        })
    print(f'      nagix 레코드 {len(nagix_recs)}건, 날짜 {len(nagix_by_date)}일분')

    def find_bearing(iso_date, lat, lng):
        cands = nagix_by_date.get(iso_date)
        if not cands:
            return None
        if lat is not None and lng is not None:
            best, best_d = None, 1e9
            for c in cands:
                if c['lat'] is None or c['lng'] is None:
                    continue
                dd = (c['lat'] - lat) ** 2 + (c['lng'] - lng) ** 2
                if dd < best_d:
                    best, best_d = c, dd
            if best:
                return best['bearing']
        return cands[0]['bearing']   # 폴백: 당일 첫 기록

    # ---- launch_facilities (CNS Facilities.csv) ----
    print('[2/5] launch_facilities 정제 (CNS Facilities.csv)')
    facilities = []
    fac_by_slug = {}
    with open(facil_csv, encoding='latin-1', newline='') as f:
        rows = list(csv.reader(f))
    # 헤더 찾기 (Facility 컬럼 포함 행)
    hidx = next(i for i, r in enumerate(rows) if r and r[0].strip() == 'Facility')
    hdr = rows[hidx]
    h = {name.strip(): i for i, name in enumerate(hdr)}
    for r in rows[hidx + 1:]:
        if not r or not r[0].strip() or r[0].strip().lower().startswith('grand total'):
            continue
        name = r[h['Facility']].strip()
        slug = slugify(name)
        if not slug or slug in fac_by_slug:
            continue
        fid = uuid5('facility:' + slug)
        rec = {
            'facility_id': fid, 'facility_name': name.title() if name.isupper() else name,
            'facility_name_raw': name, 'region': r[h['Location']].strip(),
            'lat': to_float(r[h['Latitude']]), 'lng': to_float(r[h['Longitude']]),
            'first_test_date': parse_date(r[h['Date of First Test']]),
            'most_recent_test_date': parse_date(r[h['Date of Most Recent Test']]),
            'number_of_tests': to_float(r[h['Number of Tests']]),
        }
        rec['number_of_tests'] = int(rec['number_of_tests']) if rec['number_of_tests'] is not None else None
        facilities.append(rec)
        fac_by_slug[slug] = rec
    print(f'      시설 {len(facilities)}건')

    # ---- launch_cases (CNS Missile Tests.csv) ----
    print('[3/5] launch_cases 정제 (CNS Missile Tests.csv) + nagix bearing 보강')
    cases = []
    stats = {'bearing': 0, 'landing': 0, 'kn': 0, 'facility': 0}
    with open(tests_csv, encoding='latin-1', newline='') as f:
        rows = list(csv.reader(f))
    hidx = next(i for i, r in enumerate(rows) if r and r[0].strip() == 'F1')
    hdr = rows[hidx]
    h = {name.strip(): i for i, name in enumerate(hdr)}
    for r in rows[hidx + 1:]:
        if not r or not r[0].strip() or not r[0].strip().isdigit():
            continue
        case_no = int(r[h['F1']].strip())
        name = r[h['Missile Name']].strip()
        wc = r[h['Missile Type']].strip() or 'Unknown'
        if wc not in ('SRBM', 'MRBM', 'IRBM', 'ICBM', 'SLBM', 'SLV', 'CM', 'HGV'):
            wc = 'Unknown'
        kn = extract_kn(name)
        outcome = r[h['Test Outcome']].strip().lower() or 'unknown'
        confirm = r[h['Confirmation Status']].strip().lower() or None
        iso_date = parse_date(r[h['Date']])
        fac_name_raw = r[h['Facility Name']].strip()
        fac_lat = to_float(r[h['Facility Latitude']])
        fac_lng = to_float(r[h['Facility Longitude']])
        fac_slug = slugify(fac_name_raw)
        fac_rec = fac_by_slug.get(fac_slug)
        if fac_rec:
            stats['facility'] += 1
        dist_km, dist_raw = parse_measure(r[h['Distance Travelled']])
        apo_km, apo_raw = parse_measure(r[h['Apogee']])
        landing_loc = r[h['Landing Location']].strip() or None
        lreg = landing_region(landing_loc)
        bearing = find_bearing(iso_date, fac_lat, fac_lng)
        if bearing is not None:
            stats['bearing'] += 1
        land_lat, land_lng = dest_point(fac_lat, fac_lng, bearing, dist_km)
        if land_lat is not None:
            stats['landing'] += 1
        if kn:
            stats['kn'] += 1
        sources = [s.strip() for s in re.split(r';', r[h['Source(s)']]) if s.strip()]
        authority = r[h['Launch Agency/Authority']].strip() or None
        addl = r[h['Additional Information']].strip() or None

        # indicators (facts-derived 중립 토큰)
        ind = [wc.lower(), name]
        if kn:
            ind.append(kn)
        if fac_rec:
            ind.append(fac_rec['facility_name'])
        ind.append('발사-' + outcome)
        if dist_km:
            ind.append(f'사거리{int(dist_km)}km')
        if apo_km:
            ind.append(f'고도{int(apo_km)}km')
        ind.append('착탄-' + REGION_KR[lreg])
        if authority:
            ind.append(authority)
        ind = list(dict.fromkeys(ind))   # 중복 제거, 순서 유지

        # description (한국어 요약)
        d = parse_date(r[h['Date']])
        y, m, dd = (datetime.fromisoformat(d).year, datetime.fromisoformat(d).month, datetime.fromisoformat(d).day) if d else ('?', '?', '?')
        desc = f"{y}년 {m}월 {dd}일 {fac_rec['facility_name'] if fac_rec else (fac_name_raw or '미상의 시설')}에서 {name}({wc}) 발사. 결과: {OUTCOME_KR.get(outcome, outcome)}."
        if dist_km:
            desc += f" 사거리 {int(dist_km)}km."
        if apo_km:
            desc += f" 최대고도 {int(apo_km)}km."
        desc += f" 착탄: {REGION_KR[lreg]}."

        cases.append({
            'case_id': uuid5('case:' + str(case_no)), 'case_no': case_no,
            'launch_date': iso_date, 'launch_time_utc': parse_time(r[h['Launch Time (UTC)']]),
            'missile_name': name, 'missile_slug': slugify(name), 'kn_designation': kn,
            'weapon_class': wc, 'launch_authority': authority,
            'facility_id': fac_rec['facility_id'] if fac_rec else None,
            'facility_name_raw': fac_name_raw or None, 'facility_lat': fac_lat, 'facility_lng': fac_lng,
            'landing_location': landing_loc, 'landing_region': lreg,
            'landing_lat': land_lat, 'landing_lng': land_lng, 'bearing_deg': bearing,
            'apogee_km': apo_km, 'apogee_raw': apo_raw,
            'distance_km': dist_km, 'distance_raw': dist_raw,
            'confirmation_status': confirm if confirm in ('confirmed', 'unconfirmed') else None,
            'outcome': outcome, 'indicators': ind, 'description': desc,
            'sources': sources, 'additional_info': addl,
            'source_ref': sources[0] if sources else None,
        })
    print(f'      발사사례 {len(cases)}건')
    print(f'      보강률: bearing={stats['bearing']}/{len(cases)} landing={stats['landing']} kn={stats['kn']} facility_FK={stats['facility']}')

    # ---- SQL emit ----
    print('[4/5] SQL 시드 생성 →', os.path.relpath(SQL_OUT, WEB_UI))
    lines = ['-- AUTO-GENERATED by build_launch_seed.py (gitignore). 재실행 멱등.',
             '-- 원천: CNS NK Missile Test Database + nagix/nk-missile-tests (bearing)', '']

    lines.append('-- launch_facilities')
    for r in facilities:
        lines.append(
            "insert into launch_facilities (facility_id,facility_name,facility_name_raw,region,lat,lng,"
            "first_test_date,most_recent_test_date,number_of_tests) values ("
            f"{q_text(r['facility_id'])},{q_text(r['facility_name'])},{q_text(r['facility_name_raw'])},{q_text(r['region'])},"
            f"{q_num(r['lat'])},{q_num(r['lng'])},{q_text(r['first_test_date'])},{q_text(r['most_recent_test_date'])},{q_num(r['number_of_tests'])}"
            ") on conflict (facility_name) do update set region=excluded.region,lat=excluded.lat,lng=excluded.lng,"
            "first_test_date=excluded.first_test_date,most_recent_test_date=excluded.most_recent_test_date,"
            "number_of_tests=excluded.number_of_tests;"
        )

    lines.append('')
    lines.append('-- launch_cases')
    for c in cases:
        lines.append(
            "insert into launch_cases (case_id,case_no,launch_date,launch_time_utc,missile_name,missile_slug,"
            "kn_designation,weapon_class,launch_authority,facility_id,facility_name_raw,facility_lat,facility_lng,"
            "landing_location,landing_region,landing_lat,landing_lng,bearing_deg,apogee_km,apogee_raw,"
            "distance_km,distance_raw,confirmation_status,outcome,indicators,description,sources,additional_info,source_ref) values ("
            f"{q_text(c['case_id'])},{q_num(c['case_no'])},{q_text(c['launch_date'])},{q_text(c['launch_time_utc'])},"
            f"{q_text(c['missile_name'])},{q_text(c['missile_slug'])},{q_text(c['kn_designation'])},{q_text(c['weapon_class'])},{q_text(c['launch_authority'])},"
            f"{q_text(c['facility_id'])},{q_text(c['facility_name_raw'])},{q_num(c['facility_lat'])},{q_num(c['facility_lng'])},"
            f"{q_text(c['landing_location'])},{q_text(c['landing_region'])},{q_num(c['landing_lat'])},{q_num(c['landing_lng'])},{q_num(c['bearing_deg'])},"
            f"{q_num(c['apogee_km'])},{q_text(c['apogee_raw'])},{q_num(c['distance_km'])},{q_text(c['distance_raw'])},"
            f"{q_text(c['confirmation_status'])},{q_text(c['outcome'])},{q_arr(c['indicators'])},{q_text(c['description'])},{q_arr(c['sources'])},{q_text(c['additional_info'])},{q_text(c['source_ref'])}"
            ") on conflict (case_no) do update set launch_date=excluded.launch_date,launch_time_utc=excluded.launch_time_utc,"
            "missile_name=excluded.missile_name,kn_designation=excluded.kn_designation,weapon_class=excluded.weapon_class,"
            "bearing_deg=excluded.bearing_deg,landing_lat=excluded.landing_lat,landing_lng=excluded.landing_lng,"
            "apogee_km=excluded.apogee_km,distance_km=excluded.distance_km,outcome=excluded.outcome,"
            "indicators=excluded.indicators,description=excluded.description,sources=excluded.sources;"
        )
    with open(SQL_OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    # ---- JSON mirror (RAG) ----
    print('[5/5] RAG 미러 생성 →', os.path.relpath(JSON_OUT, WEB_UI))
    mirror = [{
        'id': f"lc-{c['case_no']}", 'caseNo': c['case_no'],
        'date': c['launch_date'], 'title': f"{c['missile_name']} ({c['weapon_class']}) 발사",
        'missileType': f"{c['weapon_class']} ({c['missile_name']})",
        'facility': c['facility_name_raw'], 'outcome': c['outcome'],
        'indicators': c['indicators'], 'description': c['description'],
        'distanceKm': c['distance_km'], 'apogeeKm': c['apogee_km'],
        'facilityLat': c['facility_lat'], 'facilityLng': c['facility_lng'],
        'landingLat': c['landing_lat'], 'landingLng': c['landing_lng'],
        'kn': c['kn_designation'],
    } for c in cases]
    os.makedirs(os.path.dirname(JSON_OUT), exist_ok=True)
    with open(JSON_OUT, 'w', encoding='utf-8') as f:
        json.dump(mirror, f, ensure_ascii=False, indent=2)

    print(f'\n✅ 생성 완료: facilities={len(facilities)} cases={len(cases)}')
    if args.no_apply:
        print('   (--no-apply) 원격 적재 생략. 적재하려면:')
        print(f'   cd web-ui && npx supabase db query --linked -f {os.path.relpath(SQL_OUT, WEB_UI)}')
        return

    print('\n[apply] 원격 Delphi에 적재...')
    res = subprocess.run(
        ['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
        cwd=WEB_UI, capture_output=True, text=True)
    if res.returncode == 0:
        print('✅ 적재 성공')
    else:
        print('❌ 적재 실패:\n', res.stderr or res.stdout)
        sys.exit(1)


if __name__ == '__main__':
    main()
