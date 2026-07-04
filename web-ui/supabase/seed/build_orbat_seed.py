#!/usr/bin/env python3
"""
build_orbat_seed.py
북한군 전투서열(ORBAT) — military_units + unit_aliases 시드.
원천(민간 OSINT, 비밀 아님): GlobalSecurity KPA ORBAT / 국방백서 / CSIS / 38 North.
크레인: 데모 핵심 ~35개 부대(전방·기동·후방 군단, 전략군 미사일여단, 특수작전, 방공, 해군, 장사정포).
  - 주둔지 좌표 = OSINT 공개 도시 좌표 수준(HQ 추정). source_ref 로 출처 표시.
  - 미사일여단은 launch 시설(facilities) + 운용체계(missiles) 에 FK 연결.
데이터 → 원격 supabase 직접 적재. 산출(gitignore): *_seed.sql.
"""
import argparse, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'orbat_seed.sql')

SRC_GS = ('GlobalSecurity KPA ORBAT', 'https://www.globalsecurity.org/military/world/dprk/kpa-orbat.htm')
SRC_WP = ('국방백서', 'https://www.mnd.go.kr')

# 공개 도시 좌표(OSINT). HQ 좌표는 도시 수준 추정.
CITY = {
    '평양': (39.03, 125.75), '원산': (39.15, 127.41), '개성': (37.97, 126.78), '해주': (37.80, 126.53),
    '사리원': (38.51, 125.76), '신의주': (40.10, 124.40), '함흥': (39.92, 127.55), '청진': (41.78, 129.68),
    '남포': (38.74, 125.40), '단천': (40.00, 128.90), '고성': (38.38, 128.30), '철원': (38.15, 127.30),
    '길주': (41.02, 129.55), '장산곶': (37.62, 125.35), '개마': (41.00, 127.00),
}

# (designation, unit_type, branch, role, city, garrison_facility, operates_missile_slug, strength_est, readiness, parent_designation, aliases[])
# corps/missile/air/naval/sf/artillery
UNITS = [
    # ── 육군 군단 ──
    ('제1군단', 'corps', 'army', '전방방어(동해안축)', '고성', None, None, '군단급', 'high', None,
        [('I Corps', 'nato'), ('1st Corps', 'nato')]),
    ('제2군단', 'corps', 'army', '전방방어(중부/철원축)', '철원', None, None, '군단급', 'high', None,
        [('II Corps', 'nato')]),
    ('제3군단', 'corps', 'army', '전방방어(개성축)', '개성', None, None, '군단급', 'high', None,
        [('III Corps', 'nato')]),
    ('제4군단', 'corps', 'army', '전방방어(서해안/연평도축)', '해주', None, None, '군단급', 'high', None,
        [('IV Corps', 'nato')]),
    ('평양방위사령부', 'command', 'army', '수도방어', '평양', None, None, '사령부급', 'high', None,
        [('Pyongyang Defense Command', 'nato')]),
    ('제425대연합부대', 'corps', 'army', '기동타격(전략예비)', '평양', None, None, '군단급', 'high', None,
        [('425 Corps', 'nato'), ('425 Combined Unit', 'nato'), ('425 대연합부대', 'colloquial')]),
    ('제108군단', 'corps', 'army', '기동(서부 예비)', '사리원', None, None, '군단급', 'medium', None,
        [('108 Corps', 'nato')]),
    ('제807군단', 'corps', 'army', '기동(동부 예비)', '함흥', None, None, '군단급', 'medium', None,
        [('807 Corps', 'nato')]),
    ('제815군단', 'corps', 'army', '기동(수도권 예비)', '평양', None, None, '군단급', 'medium', None,
        [('815 Corps', 'nato')]),
    ('제5군단', 'corps', 'army', '후방방어(동해안)', '원산', None, None, '군단급', 'medium', None,
        [('V Corps', 'nato')]),
    ('제12군단', 'corps', 'army', '후방방어(동북부)', '청진', None, None, '군단급', 'medium', None,
        [('XII Corps', 'nato')]),
    ('제7군단', 'corps', 'army', '후방방어(서부/압록강)', '신의주', None, None, '군단급', 'low', None,
        [('VII Corps', 'nato')]),

    # ── 전략군 미사일 ──
    ('전략군 미사일총국', 'command', 'strategic', '전략 미사일 작전 지휘', '평양', None, None, '사령부급', 'high', None,
        [('Strategic Force', 'nato'), ('미사일총국', 'colloquial')]),
    ('전략군 미사일여단 (동창리)', 'missile', 'strategic', 'SLV/액체 ICBL 발사', '동창리', 'Sohae Satellite Launching Station', 'unha-3', '여단급', 'high', '전략군 미사일총국',
        [('Sohae missile brigade', 'nato')]),
    ('전략군 미사일여단 (기타룡)', 'missile', 'strategic', '고체 SRBM(KN-23계열) 운용', '철원', 'Kittaeryong Missile Base', 'hwasong-11a', '여단급', 'high', '전략군 미사일총국',
        [('Kittaeryong missile brigade', 'nato')]),
    ('전략군 미사일여단 (순안)', 'missile', 'strategic', '액체/고체 ICBM 운용', '평양', 'Pyongyang International Airport', 'hwasong-17', '여단급', 'high', '전략군 미사일총국',
        [('Sunam ICBM brigade', 'nato')]),
    ('전략군 미사일여단 (동해)', 'missile', 'strategic', '액체 ICBM/SLV 발사', '고성', 'Tonghae Satellite Launching Ground', 'hwasong-15', '여단급', 'medium', '전략군 미사일총국',
        [('Tonghae missile brigade', 'nato')]),

    # ── 특수작전군 ──
    ('특수작전군 사령부', 'command', 'sf', '특수작전 총지휘(폭풍군단)', '평양', None, None, '사령부급', 'high', None,
        [('11th Corps', 'nato'), ('폭풍군단', 'colloquial'), ('Storm Corps', 'nato')]),
    ('정찰총국', 'sf', 'sf', '대남 특수정찰/공작', '평양', None, None, '총국급', 'high', '특수작전군 사령부',
        [('Reconnaissance General Bureau', 'nato'), ('RGB', 'nato')]),
    ('경호총국', 'sf', 'sf', '수령부 경호/근위', '평양', None, None, '총국급', 'high', None,
        [('Guard Command', 'nato')]),

    # ── 방공 / 공군 ──
    ('방공사령부', 'command', 'air', '방공작전 지휘(SAM/요격)', '평양', None, None, '사령부급', 'medium', None,
        [('Air Defense Command', 'nato')]),
    ('SA-5 방공여단 (수도권)', 'air_defense', 'air', 'SA-5 중고공 방공(사거리 ~250km)', '남포', None, None, '여단급', 'medium', '방공사령부',
        [('SA-5/Gammon brigade', 'nato')]),
    ('SA-2 방공여단 (전방)', 'air_defense', 'air', 'SA-2 중저공 방공(개성축)', '개성', None, None, '여단급', 'medium', '방공사령부',
        [('SA-2/Guideline brigade', 'nato')]),
    ('MiG-29 요격비행단', 'air', 'air', '요격 전력(MiG-29)', '평양', 'Sunchon Airbase', None, '비행단급', 'low', '방공사령부',
        [('MiG-29 interceptor regiment', 'nato')]),

    # ── 해군 ──
    ('해군사령부', 'command', 'naval', '해군 작전 지휘', '평양', None, None, '사령부급', 'medium', None,
        [('Naval Command', 'nato')]),
    ('동해함대', 'naval', 'naval', '동해 작전(정찰/잠수함)', '원산', None, None, '함대급', 'medium', '해군사령부',
        [('East Sea Fleet', 'nato')]),
    ('서해함대', 'naval', 'naval', '서해 작전(연평도축)', '남포', None, None, '함대급', 'medium', '해군사령부',
        [('West Sea Fleet', 'nato')]),
    ('잠수함사령부', 'naval', 'naval', 'SLBM 잠수함 운용', '신포', 'Sinpo Shipyard', 'pukguksong-1', '사령부급', 'medium', '해군사령부',
        [('Submarine Command', 'nato'), ('고래(Gorae)基地', 'colloquial')]),

    # ── 장사정포 / 포병 ──
    ('장사정포 여단 (장산곶)', 'artillery', 'army', '장사정포(서해안 위협, 사거리 ~170mm급)', '장산곶', None, None, '여단급', 'medium', '제4군단',
        [('Long-range artillery brigade', 'nato')]),
    ('제4군단 예하 포병여단', 'artillery', 'army', '방사포/야포(서해안축)', '해주', None, None, '여단급', 'medium', '제4군단',
        [('IV Corps artillery brigade', 'nato')]),
    ('방사포 여단 (전방 중부)', 'artillery', 'army', '대구경 방사포(300mm)', '철원', None, None, '여단급', 'high', '제2군단',
        [('MLRS brigade', 'nato')]),
]


def qt(v):
    if v is None:
        return 'NULL'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-apply', action='store_true')
    args = ap.parse_args()

    lines = ['-- AUTO-GENERATED by build_orbat_seed.py (gitignore). OSINT 기반 KPA ORBAT.', '']

    # military_units (garrison_facility_id/operates_missile_id 는 서브쿼리로, parent 는 후처리)
    lines.append('-- military_units')
    for u in UNITS:
        des, ut, br, role, city, fac, ms, strength, ready, parent, aliases = u
        lat, lng = CITY.get(city, (None, None))
        fac_sql = f"(select facility_id from facilities where canonical_name={qt(fac)})" if fac else 'NULL'
        mis_sql = f"(select missile_id from missiles where slug={qt(ms)})" if ms else 'NULL'
        src_ref, src_url = SRC_GS
        lines.append(
            "insert into military_units (designation,unit_type,branch,hq_lat,hq_lng,garrison_facility_id,operates_missile_id,strength_est,readiness,role,source_ref,source_url) values ("
            f"{qt(des)},{qt(ut)},{qt(br)},{qt(lat)},{qt(lng)},{fac_sql},{mis_sql},{qt(strength)},{qt(ready)},{qt(role)},{qt(src_ref)},{qt(src_url)}"
            ") on conflict do nothing;")

    # parent 연결 (2-pass update by designation)
    lines.append('\n-- parent_unit_id 연결')
    for u in UNITS:
        des = u[0]; parent = u[9]
        if parent:
            lines.append(
                "update military_units set parent_unit_id = "
                f"(select unit_id from military_units where designation={qt(parent)}) "
                f"where designation={qt(des)};")

    # unit_aliases
    lines.append('\n-- unit_aliases')
    for u in UNITS:
        des = u[0]; aliases = u[10]
        for atext, atype in aliases:
            lines.append(
                "insert into unit_aliases (unit_id,alias_text,alias_type,source) values "
                f"((select unit_id from military_units where designation={qt(des)}),{qt(atext)},{qt(atype)},{qt(SRC_GS[0])}) "
                "on conflict (unit_id,alias_text,alias_type) do nothing;")

    open(SQL_OUT, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    n = len(UNITS)
    print(f'✅ military_units={n} → {os.path.relpath(SQL_OUT, WEB_UI)}')

    if args.no_apply:
        print('(--no-apply) 적재 생략'); return
    print('[apply] 원격 적재...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
                       cwd=WEB_UI, capture_output=True, text=True)
    print('✅ 적재 성공' if r.returncode == 0 else '❌ ' + (r.stderr or r.stdout))


if __name__ == '__main__':
    main()
