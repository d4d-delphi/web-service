#!/usr/bin/env python3
"""
validate_coords.py
DELPHI/NL-COP 전 테이블 지리 좌표 이상치 검증.

검증 대상:
  - observation.mgrs        (MGRS → lat/lng 변환)
      · bbox 이탈 체크
      · location_name 으로 매칭되는 정규 시설(facilities/facility_aliases) 좌표와
        거리 비교 → 10km 초과 이격 시 이상치 (MGRS 오타/밴드 오류 탐지 목적)
  - facilities.lat/lng                       (bbox)
  - launch_facilities.lat/lng                (bbox)
  - military_units.hq_lat/hq_lng             (bbox)
  - launch_cases.facility_lat/facility_lng   (발사 시설=북한 영토, bbox)
  - launch_cases.landing_lat/landing_lng      (낙탄지: 해상 정상 → 정보만)

북한 영토 bbox (해상 낙탄 제외): lat 37.5–43.0, lng 124.0–130.7
이 범위를 벗어나는 육상 시설/주둔지/발사지 좌표 = 의심 → 리포트.

사용: python3 validate_coords.py
"""
import json, math, os, re, subprocess, sys, time

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# 북한 영토 대략 bbox (해상 낙탄 제외)
NK_LAT_MIN, NK_LAT_MAX = 37.5, 43.0
NK_LNG_MIN, NK_LNG_MAX = 124.0, 130.7

# location_name ↔ 정규 시설 좌표 거리 임계 (km). 이격 시 MGRS 오류 의심.
FACILITY_MATCH_RADIUS_KM = 15.0

ANOMALIES = []  # (table, key, name, raw, lat, lng, reason)


def q(sql):
    """npx supabase db query 실행 (간헐적 'Initialising login role' 오류 시 재시도)."""
    # "Initialising login role..." 은 informational 메시지(에러 아님). rows 가 있으면 파싱.
    for attempt in range(4):
        r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                           cwd=WEB_UI, capture_output=True, text=True)
        out = r.stdout or ''
        if r.returncode == 0 and '"rows"' in out:
            m = (re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', out, re.S)
                 or re.search(r'"rows":\s*(\[.*\])', out, re.S))
            if m:
                return json.loads(m.group(1))
        if attempt < 3:
            time.sleep(1.2 * (attempt + 1))
    sys.exit('쿼리 실패(재시도 초과):\nSQL: ' + sql[:200] + '\n' + (r.stderr or out))


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def in_nk_bbox(lat, lng):
    return (NK_LAT_MIN <= lat <= NK_LAT_MAX and NK_LNG_MIN <= lng <= NK_LNG_MAX)


def add(table, key, name, raw, lat, lng, reason):
    ANOMALIES.append((table, key, name, raw, lat, lng, reason))


def check_bbox(table, key, name, lat, lng, raw):
    if lat is None or lng is None:
        return
    reasons = []
    if not (NK_LAT_MIN <= lat <= NK_LAT_MAX):
        reasons.append(f'lat {lat} bbox({NK_LAT_MIN}~{NK_LAT_MAX}) 이탈')
    if not (NK_LNG_MIN <= lng <= NK_LNG_MAX):
        reasons.append(f'lng {lng} bbox({NK_LNG_MIN}~{NK_LNG_MAX}) 이탈')
    if reasons:
        add(table, key, name, raw, lat, lng, '; '.join(reasons))


def section(title):
    print('\n' + '=' * 70)
    print(title)
    print('=' * 70)


def build_facility_index():
    """(alias_text → (canonical_name, lat, lng)) 서브스트링 매칭용 인덱스."""
    rows = q("""select fa.alias_text, f.canonical_name, f.lat, f.lng
                from facility_aliases fa
                join facilities f on f.facility_id = fa.facility_id
                where f.lat is not null and fa.alias_text is not null;""")
    # 긴 alias 먼저 매칭 (더 구체적)
    return sorted(rows, key=lambda r: len(r['alias_text']), reverse=True)


def match_facility(location_name, fac_index):
    """location_name 서브스트링으로 매칭되는 시설 좌표 반환."""
    if not location_name:
        return None
    for r in fac_index:
        al = r['alias_text']
        if al and (al in location_name or location_name in al):
            return r
    return None


def main():
    section('DELPHI/NL-COP 좌표 검증 (전 테이블)')

    # ── 1) observation.mgrs ──
    print('\n[1/5] observation.mgrs 변환 + bbox + 정규시설 거리 체크')
    try:
        import mgrs
        conv = mgrs.MGRS()
    except ImportError:
        sys.exit('mgrs 라이브러리 필요: pip install mgrs packaging')

    fac_index = build_facility_index()
    print(f'    정규 시설 인덱스: {len(fac_index)}개 alias')

    obs = q("""select obs_id, mgrs, location_name from observation
               where mgrs is not null;""")
    print(f'    관측 {len(obs)}행 중 mgrs 보유 행 검사')

    mgrs_seen = {}    # mgrs_string -> dict(lat,lng,loc,fac,anomaly)
    parse_fail = []
    for r in obs:
        mgrs_str = (r.get('mgrs') or '').strip()
        if not mgrs_str:
            continue
        if mgrs_str not in mgrs_seen:
            try:
                lat, lng = conv.toLatLon(mgrs_str.replace(' ', ''))
            except Exception:
                mgrs_seen[mgrs_str] = None
                parse_fail.append((r['obs_id'], mgrs_str, r.get('location_name')))
                continue
            mgrs_seen[mgrs_str] = {
                'lat': lat, 'lng': lng, 'loc': r.get('location_name'),
                'rows': [], 'anomaly': None
            }
        entry = mgrs_seen[mgrs_str]
        if entry is not None:
            entry['rows'].append(r)

    # 고유 MGRS별 검증
    for mgrs_str, entry in mgrs_seen.items():
        if entry is None:
            continue
        lat, lng = entry['lat'], entry['lng']
        loc = entry['loc']
        fac = match_facility(loc, fac_index)
        # bbox
        bbox_reasons = []
        if not (NK_LAT_MIN <= lat <= NK_LAT_MAX):
            bbox_reasons.append(f'lat {lat:.4f} bbox 이탈')
        if not (NK_LNG_MIN <= lng <= NK_LNG_MAX):
            bbox_reasons.append(f'lng {lng:.4f} bbox 이탈')
        # 정규 시설 거리
        dist_reason = None
        if fac:
            d = haversine_km(lat, lng, fac['lat'], fac['lng'])
            entry['dist_km'] = d
            if d > FACILITY_MATCH_RADIUS_KM:
                dist_reason = (f'정규시설({fac["canonical_name"]})과 '
                               f'{d:.0f}km 이격 (정상좌표 {fac["lat"]},{fac["lng"]})')
        reasons = bbox_reasons + ([dist_reason] if dist_reason else [])
        if reasons:
            entry['anomaly'] = '; '.join(reasons)
            sample = entry['rows'][0]
            add('observation.mgrs', sample['obs_id'], loc, mgrs_str,
                lat, lng, entry['anomaly'])

    print(f'    고유 MGRS 값: {sum(1 for v in mgrs_seen.values() if v)}개 '
          f'(파싱 실패 {len(parse_fail)}개)')
    print('    고유 MGRS 변환 결과:')
    for mgrs_str, entry in sorted(mgrs_seen.items()):
        if entry is None:
            print(f'      ✗ {mgrs_str:<24} → 파싱 실패 ({parse_fail[0][2] if parse_fail else ""})')
            continue
        flag = '✗' if entry.get('anomaly') else ' '
        d = entry.get('dist_km')
        dtag = f' 매칭시설로부터 {d:.0f}km' if d is not None else ''
        print(f'      {flag} {mgrs_str:<24} → {entry["lat"]:.4f}, {entry["lng"]:.4f}'
              f'{dtag}  ({entry["loc"]})')

    # ── 2) facilities.lat/lng ──
    print('\n[2/5] facilities.lat/lng bbox 체크')
    fac_rows = q("""select facility_id, canonical_name, lat, lng from facilities
                    where lat is not null;""")
    print(f'    {len(fac_rows)}행 검사')
    for r in fac_rows:
        check_bbox('facilities', r['facility_id'], r['canonical_name'],
                   r['lat'], r['lng'], f"{r['lat']},{r['lng']}")

    # ── 3) launch_facilities.lat/lng ──
    print('\n[3/5] launch_facilities.lat/lng bbox 체크')
    lf = q("""select facility_id, facility_name, lat, lng
              from launch_facilities where lat is not null;""")
    print(f'    {len(lf)}행 검사')
    for r in lf:
        check_bbox('launch_facilities', r['facility_id'],
                   r['facility_name'], r['lat'], r['lng'],
                   f"{r['lat']},{r['lng']}")

    # ── 4) military_units.hq_lat/hq_lng ──
    print('\n[4/5] military_units.hq_lat/hq_lng bbox 체크')
    mu = q("""select unit_id, designation, hq_lat, hq_lng from military_units
              where hq_lat is not null;""")
    print(f'    {len(mu)}행 검사')
    for r in mu:
        check_bbox('military_units', r['unit_id'], r['designation'],
                   r['hq_lat'], r['hq_lng'], f"{r['hq_lat']},{r['hq_lng']}")

    # ── 5) launch_cases 발사 시설 (육지) ──
    print('\n[5/5] launch_cases.facility_lat/lng bbox 체크 (발사 시설=육지)')
    lc = q("""select case_id, case_no, missile_name, facility_lat, facility_lng
              from launch_cases where facility_lat is not null;""")
    print(f'    발사 시설 {len(lc)}행 검사')
    for r in lc:
        check_bbox('launch_cases.facility', r['case_id'],
                   f"{r.get('case_no')} {r.get('missile_name')}",
                   r['facility_lat'], r['facility_lng'],
                   f"{r['facility_lat']},{r['facility_lng']}")
    # 낙탄지 (참고 정보)
    land = q("""select count(*) as n from launch_cases
                where landing_lat is not null;""")
    n_land = land[0]['n'] if land else 0
    print(f'    (참고) 낙탄지 landing 좌표 {n_land}행 — 해상 낙탄 정상이므로 bbox 제외')

    # ── 종합 리포트 ──
    section(f'이상치 종합 (총 {len(ANOMALIES)}건)')
    if not ANOMALIES:
        print('  이상치 없음 — 모든 육지 좌표가 북한 bbox 내 + 시설 거리 정상')
    else:
        from collections import defaultdict
        by_table = defaultdict(list)
        for a in ANOMALIES:
            by_table[a[0]].append(a)
        for tbl, items in by_table.items():
            print(f'\n  [{tbl}] {len(items)}건')
            seen = set()
            for (t, key, name, raw, lat, lng, reason) in items:
                sig = (raw, lat, lng)
                if tbl.startswith('launch_cases'):
                    if sig in seen:
                        continue
                    seen.add(sig)
                    cnt = sum(1 for x in items if (x[3], x[4], x[5]) == sig)
                    dup = f'  ({cnt}행 동일좌표)' if cnt > 1 else ''
                else:
                    dup = ''
                print(f'    • {name} | raw={raw} → ({lat}, {lng}){dup}')
                print(f'        사유: {reason}')

    section('검증 결과: ' + ('PASS ✓ (이상치 0)' if not ANOMALIES
                            else f'FAIL ✗ (이상치 {len(ANOMALIES)}건 — 수정 필요)'))
    return 1 if ANOMALIES else 0


if __name__ == '__main__':
    sys.exit(main())
