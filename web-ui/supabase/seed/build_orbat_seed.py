#!/usr/bin/env python3
"""
build_orbat_seed.py — 북한군 전투서열(ORBAT) military_units + unit_aliases 시드.
원천(민간 OSINT, 비밀 아님): GlobalSecurity KPA ORBAT / 국방백서 / 38North / CSIS / namu.wiki / 시티즌 OSINT 블로그.

재큐레이션(2026-07-05): 사용자 제공 OSINT 자료 기준으로 군단 배치/좌표 전면 수정.
  - 전연(전선) 군단: MDL 서→동 제4(해주)·제2(평산)·제5(세포)·제1(회양)
  - 기동(기갑/기계화) 군단: 제820(신계)·제815(사리원)·제806(고산)·제108(영광)·제425(정주)
  - 후방 군단: 제3(남포)·제7(함흥)·제8(염주)·제9(청진)·제12(혜산)
  - 방공: SA-2(중거리~50km, 권역별) + SA-5(장거리~250-300km, 옹진/문천/평양/영변)
  - 공군: 제1·2·3·8 비행사단 + 핵심 비행장(북창 MiG-29·순천 Su-25·원산 갈마·태탄)
  - 전략군 미사일여단(launch 시설+체계 FK), 해군, 특수작전, 장사정포 유지

데이터 → 원격 supabase. 시작 시 기존 military_units/aliases 삭제 후 재구축(멱등 재생산).
HQ 좌표 = OSINT 공개 도시/군 좌표 수준 추정. source_ref 인증.
산출(gitignore): *_seed.sql.
"""
import argparse, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'orbat_seed.sql')

SRC_GS = ('OSINT: GlobalSecurity/namu/국방백서', 'https://www.globalsecurity.org/military/world/dprk/kpa-orbat.htm')

# 공개 도시/군 좌표 (OSINT). HQ 좌표는 도시·군 수준 추정.
CITY = {
    '평양': (39.039, 125.763), '해주': (37.796, 126.324), '평산': (38.374, 126.394),
    '세포': (38.735, 127.357), '회양': (38.722, 127.635), '신계': (38.510, 126.810),
    '사리원': (38.507, 125.755), '고산': (39.072, 127.305), '영광': (39.037, 127.070),
    '정주': (39.821, 124.802), '남포': (38.735, 125.404), '함흥': (39.918, 127.537),
    '염주': (39.856, 124.687), '청진': (41.783, 129.683), '혜산': (41.251, 128.179),
    '옹진': (37.877, 125.423), '문천': (38.960, 127.301), '영변': (39.800, 125.750),
    '안악': (38.508, 125.238), '북청': (39.421, 127.620), '강계': (40.968, 126.584),
    '개천': (39.692, 125.907), '북창': (39.710, 126.320), '의주': (40.198, 124.530),
    '순천': (39.416, 125.940), '덕산': (39.960, 127.700), '원산': (39.154, 127.448),
    '황주': (38.370, 125.760), '곡산': (38.600, 126.640), '온천': (38.820, 125.250),
    '태탄': (37.830, 125.290), '곽산': (39.660, 124.620), '어랑': (40.910, 128.990),
    '삼지연': (41.800, 128.330), '길주': (41.030, 129.560), '신포': (40.074, 128.179),
    '연탄': (38.360, 126.320), '강서': (38.790, 125.580),
    '동창리': (39.660, 124.710), '철원': (38.150, 127.300), '금호': (40.850, 129.670),
}

# (designation, unit_type, branch, role, city, garrison_facility, operates_missile_slug, strength, readiness, parent, aliases[])
UNITS = [
    # ── 전연(전선) 군단: MDL 서→동 ──
    ('제4군단', 'corps', 'army', '서부전선/서해안(서해5도·연평부대 대치)', '해주', None, None, '군단급', 'high', None, [('IV Corps', 'nato')]),
    ('제2군단', 'corps', 'army', '서남부 평야/서부전선 주공(수도권 겨냥)', '평산', None, None, '군단급', 'high', None, [('II Corps', 'nato')]),
    ('제5군단', 'corps', 'army', '중부전선(철원·화천·평강)', '세포', None, None, '군단급', 'high', None, [('V Corps', 'nato')]),
    ('제1군단', 'corps', 'army', '동부전선(동해안/태백 산악)', '회양', None, None, '군단급', 'high', None, [('I Corps', 'nato')]),
    # ── 기동(기갑/기계화) 군단: 전선 돌파 시 종심 타격 ──
    ('제820기갑군단', 'corps', 'army', '기갑 돌파/종심 타격(서부전선 배후, 최정예)', '신계', None, None, '군단급', 'high', None, [('820th Armored Corps', 'nato')]),
    ('제815기계화군단', 'corps', 'army', '기계화 기동(서부 후방)', '사리원', None, None, '군단급', 'high', None, [('815th Mech Corps', 'nato')]),
    ('제806기계화군단', 'corps', 'army', '기계화 기동(동부/중부 후방)', '고산', None, None, '군단급', 'medium', None, [('806th Mech Corps', 'nato')]),
    ('제108기계화군단', 'corps', 'army', '기계화 기동(동해안 축선 후방)', '영광', None, None, '군단급', 'medium', None, [('108th Mech Corps', 'nato')]),
    ('제425기계화군단', 'corps', 'army', '기계화 기동(평양 북방/서해안 종심)', '정주', None, None, '군단급', 'medium', None, [('425th Mech Corps', 'nato'), ('425 대연합부대', 'colloquial')]),
    # ── 후방 군단: 평양 외곽/도별 방어 ──
    ('제3군단', 'corps', 'army', '평양 서남부 관문/해안 방어', '남포', None, None, '군단급', 'medium', None, [('III Corps', 'nato')]),
    ('제7군단', 'corps', 'army', '동해안 종심 방어(청진·함흥 축)', '함흥', None, None, '군단급', 'medium', None, [('VII Corps', 'nato')]),
    ('제8군단', 'corps', 'army', '평양 북방 방어/중국 접경', '염주', None, None, '군단급', 'low', None, [('VIII Corps', 'nato')]),
    ('제9군단', 'corps', 'army', '최북단 후방(러·중 접경)', '청진', None, None, '군단급', 'low', None, [('IX Corps', 'nato')]),
    ('제12군단', 'corps', 'army', '한·중 국경 산악 방어', '혜산', None, None, '군단급', 'low', None, [('XII Corps', 'nato')]),
    # ── 수도 방어 ──
    ('평양방어사령부', 'command', 'army', '수도 방어(91훈련소 계보)', '평양', None, None, '사령부급', 'high', None, [('Pyongyang Defense Command', 'nato')]),
    # ── 전략군 미사일 ──
    ('전략군 미사일총국', 'command', 'strategic', '전략 미사일 작전 지휘', '평양', None, None, '사령부급', 'high', None, [('Strategic Force', 'nato'), ('미사일총국', 'colloquial')]),
    ('전략군 미사일여단 (동창리)', 'missile', 'strategic', 'SLV/액체 ICBM 발사', '동창리', 'Sohae Satellite Launching Station', 'unha-3', '여단급', 'high', '전략군 미사일총국', [('Sohae missile brigade', 'nato')]),
    ('전략군 미사일여단 (기타룡)', 'missile', 'strategic', '고체 SRBM(KN-23계열) 운용', '철원', 'Kittaeryong Missile Base', 'hwasong-11a', '여단급', 'high', '전략군 미사일총국', [('Kittaeryong missile brigade', 'nato')]),
    ('전략군 미사일여단 (순안)', 'missile', 'strategic', '액체/고체 ICBM 운용', '평양', 'Pyongyang International Airport', 'hwasong-17', '여단급', 'high', '전략군 미사일총국', [('Sunam ICBM brigade', 'nato')]),
    ('전략군 미사일여단 (동해)', 'missile', 'strategic', '액체 ICBM/SLV 발사', '금호', 'Tonghae Satellite Launching Ground', 'hwasong-15', '여단급', 'medium', '전략군 미사일총국', [('Tonghae missile brigade', 'nato')]),
    # ── 특수작전군 ──
    ('특수작전군 사령부', 'command', 'sf', '특수작전 총지휘(폭풍군단)', '평양', None, None, '사령부급', 'high', None, [('11th Corps', 'nato'), ('폭풍군단', 'colloquial'), ('Storm Corps', 'nato')]),
    ('정찰총국', 'sf', 'sf', '대남 특수정찰/공작', '평양', None, None, '총국급', 'high', '특수작전군 사령부', [('Reconnaissance General Bureau', 'nato'), ('RGB', 'nato')]),
    ('경호총국', 'sf', 'sf', '수령부 경호/근위', '평양', None, None, '총국급', 'high', None, [('Guard Command', 'nato')]),
    # ── 방공(SAM) ──
    ('방공사령부', 'command', 'air', '방공작전 지휘(SAM/요격)', '평양', None, None, '사령부급', 'medium', None, [('Air Defense Command', 'nato')]),
    ('SA-2 방공여단 (평양·강서)', 'air_defense', 'air', 'SA-2 중거리 방공(~50km, 수도권)', '강서', None, None, '여단급', 'medium', '방공사령부', [('SA-2/Guideline', 'nato')]),
    ('SA-2 방공여단 (영변)', 'air_defense', 'air', 'SA-2 (핵시설 방어)', '영변', None, None, '여단급', 'medium', '방공사령부', []),
    ('SA-2 방공여단 (평산·사리원)', 'air_defense', 'air', 'SA-2 (서부전선 배후, 수도권 접근 차단)', '사리원', None, None, '여단급', 'medium', '방공사령부', []),
    ('SA-2 방공여단 (안악)', 'air_defense', 'air', 'SA-2 (서해안 지원)', '안악', None, None, '여단급', 'medium', '방공사령부', []),
    ('SA-2 방공여단 (세포)', 'air_defense', 'air', 'SA-2 (중부전선 후방)', '세포', None, None, '여단급', 'medium', '방공사령부', []),
    ('SA-2 방공여단 (북청)', 'air_defense', 'air', 'SA-2 (동해안 함흥권)', '북청', None, None, '여단급', 'medium', '방공사령부', []),
    ('SA-2 방공여단 (강계)', 'air_defense', 'air', 'SA-2 (중국접경 산악, 미사일기지 대공우산)', '강계', None, None, '여단급', 'low', '방공사령부', []),
    ('SA-5 방공대대 (옹진 옹고덕)', 'air_defense', 'air', 'SA-5 장거리 방공(~250-300km, 서울·평택 사정권)', '옹진', None, None, '대대급', 'high', '방공사령부', [('SA-5/Gammon', 'nato')]),
    ('SA-5 방공대대 (원산 문천)', 'air_defense', 'air', 'SA-5 (동해안/동부전선, 지하격납 이동식)', '문천', None, None, '대대급', 'high', '방공사령부', []),
    ('SA-5 방공대대 (평양 외곽)', 'air_defense', 'air', 'SA-5 (수도 고고도 요격)', '평양', None, None, '대대급', 'medium', '방공사령부', []),
    ('SA-5 방공대대 (영변)', 'air_defense', 'air', 'SA-5 (핵시설 고고도 방어)', '영변', None, None, '대대급', 'medium', '방공사령부', []),
    # ── 공군 ──
    ('공군사령부', 'command', 'air', '공군 작전 지휘(중화군)', '평양', None, None, '사령부급', 'medium', None, [('Air Force Command', 'nato')]),
    ('제1비행사단', 'air', 'air', '서북 권역/평양 방어', '개천', None, None, '사단급', 'medium', '공군사령부', [('1st Air Division', 'nato')]),
    ('제2비행사단', 'air', 'air', '동부 권역/동해안 방어', '덕산', None, None, '사단급', 'medium', '공군사령부', [('2nd Air Division', 'nato')]),
    ('제3비행사단', 'air', 'air', '남부 권역/최전방 공세(수도권 타격)', '황주', None, None, '사단급', 'high', '공군사령부', [('3rd Air Division', 'nato')]),
    ('제8비행사단', 'air', 'air', '북부 후방/교육훈련', '어랑', None, None, '사단급', 'low', '공군사령부', [('8th Air Division', 'nato')]),
    ('북창 비행장 (MiG-29 요격)', 'air', 'air', 'MiG-29/MiG-23 평양 영공 방어 핵심', '북창', None, None, '비행단급', 'high', '제1비행사단', []),
    ('순천 비행장 (Su-25 CAS)', 'air', 'air', 'Su-25 근접항공지원', '순천', 'Sunchon Airbase', None, '비행단급', 'medium', '제1비행사단', []),
    ('원산(갈마) 비행장', 'air', 'air', '지하활주로 기습출격 요충지', '원산', None, None, '비행단급', 'medium', '제2비행사단', []),
    ('태탄·곽산 비행장 (An-2/헬기)', 'air', 'air', 'An-2 침투/공격헬기 (서해 NLL)', '태탄', None, None, '비행단급', 'medium', '제3비행사단', []),
    # ── 해군 ──
    ('해군사령부', 'command', 'naval', '해군 작전 지휘', '평양', None, None, '사령부급', 'medium', None, [('Naval Command', 'nato')]),
    ('동해함대', 'naval', 'naval', '동해 작전(정찰/잠수함)', '원산', None, None, '함대급', 'medium', '해군사령부', [('East Sea Fleet', 'nato')]),
    ('서해함대', 'naval', 'naval', '서해 작전(연평도축)', '남포', None, None, '함대급', 'medium', '해군사령부', [('West Sea Fleet', 'nato')]),
    ('잠수함사령부', 'naval', 'naval', 'SLBM 잠수함 운용', '신포', 'Sinpo Shipyard', 'pukguksong-1', '사령부급', 'medium', '해군사령부', [('Submarine Command', 'nato'), ('고래(Gorae)基地', 'colloquial')]),
    # ── 장사정포 / 방사포 ──
    ('장사정포 여단 (서부전선)', 'artillery', 'army', '장사정포(서울 사정권)', '연탄', None, None, '여단급', 'high', '제2군단', [('Long-range artillery brigade', 'nato')]),
    ('방사포 여단 (중부전선)', 'artillery', 'army', '대구경 방사포(300mm)', '세포', None, None, '여단급', 'high', '제5군단', [('MLRS brigade', 'nato')]),
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

    lines = ['-- AUTO-GENERATED by build_orbat_seed.py (gitignore). OSINT 기반 KPA ORBAT (재큐레이션 2026-07-05).', '',
             '-- 기존 ORBAT 삭제 후 재구축(멱등 재생산). aliases 는 cascade 삭제.', '',
             'delete from unit_aliases;', 'delete from military_units;', '']

    lines.append('-- military_units')
    for u in UNITS:
        des, ut, br, role, city, fac, ms, strength, ready, parent, aliases = u
        lat, lng = CITY.get(city, (None, None))
        fac_sql = f"(select facility_id from facilities where canonical_name={qt(fac)})" if fac else 'NULL'
        mis_sql = f"(select missile_id from missiles where slug={qt(ms)})" if ms else 'NULL'
        lines.append(
            "insert into military_units (designation,unit_type,branch,hq_lat,hq_lng,garrison_facility_id,operates_missile_id,strength_est,readiness,role,source_ref,source_url) values ("
            f"{qt(des)},{qt(ut)},{qt(br)},{qt(lat)},{qt(lng)},{fac_sql},{mis_sql},{qt(strength)},{qt(ready)},{qt(role)},{qt(SRC_GS[0])},{qt(SRC_GS[1])});")

    lines.append('\n-- parent_unit_id 연결')
    for u in UNITS:
        des, parent = u[0], u[9]
        if parent:
            lines.append(f"update military_units set parent_unit_id = (select unit_id from military_units where designation={qt(parent)}) where designation={qt(des)};")

    lines.append('\n-- unit_aliases')
    for u in UNITS:
        des, aliases = u[0], u[10]
        for atext, atype in aliases + [(des, 'official')]:
            lines.append(
                "insert into unit_aliases (unit_id,alias_text,alias_type,source) values "
                f"((select unit_id from military_units where designation={qt(des)}),{qt(atext)},{qt(atype)},{qt(SRC_GS[0])}) "
                "on conflict (unit_id,alias_text,alias_type) do nothing;")

    open(SQL_OUT, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print(f'✅ military_units={len(UNITS)} → {os.path.relpath(SQL_OUT, WEB_UI)}')

    if args.no_apply:
        print('(--no-apply) 적재 생략'); return
    print('[apply] 원격 적재(delete + reseed)...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
                       cwd=WEB_UI, capture_output=True, text=True)
    print('✅ 적재 성공' if r.returncode == 0 else '❌ ' + (r.stderr or r.stdout))


if __name__ == '__main__':
    main()
