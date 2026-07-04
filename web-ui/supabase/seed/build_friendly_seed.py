#!/usr/bin/env python3
"""
build_friendly_seed.py
아군(Blue) 전투서열/작전 자산 — friendly_units + friendly_unit_aliases 시드.
원천(공개 자료, 비밀 아님): 국방백서 / ROK MND 발표 / 공개 제원 보도 / 제조사 / CSIS / GlobalSecurity.
큐레이션: 공수 양면(Offense+Defense) — KAMD(탐지) / LAMD(요격) / KMPR(타격) / 해상 / ISR.
  - 제원(사거리/탐지거리)은 공개보도 수치(illustrative)이며, 실 운용 수치·체계연동이 아님.
  - base_facility_id(facilities)는 ROK 기지를 별도 확장하기 전까지 null, base_name 텍스트로 표시.
  - operates_doctrine_option은 기존 response_options.option_id와 매칭(교리 3축 연결).
데이터 → 원격 supabase 직접 적재. 산출(gitignore): *_seed.sql.
"""
import argparse, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'friendly_seed.sql')

SRC_MND = ('ROK 국방백서/국방부 발표', 'https://www.mnd.go.kr')
SRC_OPEN = ('공개 제원 보도/CSIS/GlobalSecurity', 'https://www.csis.org')

# 공개 ROK 주요 기지 좌표(OSINT 수준). 기지 좌표는 공개 보도 수준 추정.
BASE = {
    '오산 공군기지': (37.09, 127.03), '군산 공군기지': (35.90, 126.62),
    '청주 공군기지': (36.70, 127.50), '대구 공군기지': (35.90, 128.66),
    '사동 기지(글로벌호크)': (37.14, 127.05),
    '미사일방어사(음성)': (36.94, 127.83), '방공포병여단(수도권)': (37.50, 127.00),
    '진해 해군기지': (35.15, 128.65), '부산 해군작전기지': (35.10, 129.04),
    '오봉리 K-MLRS 기지': (38.10, 127.10),
}

# (canonical_name, slug, designation, asset_type, branch, role, capability,
#  range_km, detection_range_km, readiness, base_name, doctrine_option,
#  source_ref, source_url, aliases[])
UNITS = [
    # ── KAMD 탐지 (detect) ──
    ('피스아이(E-737)', 'peace-eye-e737', 'E-737 조기경보통제기(AEW&C)',
     'KAMD_DETECT', 'air', '공중 조기경보/부스트 추적',
     '공중 조기경보기. 발사체 부스트 단계 원거리 탐지/추적. 레이더 탐지거리 ~370km(공개보도).',
     None, 370, 'ready', '오산 공군기지', 'kamd-peaceseye', SRC_MND,
     [('Peace Eye', 'official'), ('E-737', 'english'), ('피스아이', 'colloquial'),
      ('조기경보기', 'colloquial'), ('AEW&C', 'english'), ('Boeing E-737', 'english')]),
    ('그린파인 레이더', 'green-pine-radar', '그린파인(Green Pine) 지상탐지레이더',
     'KAMD_DETECT', 'army', '지상 탄도미사일 추적 레이더',
     '지상 기반 X밴드 탄도미사일 추적 레이더. 탐지거리 ~500km(공개보도 수치).',
     None, 500, 'ready', '미사일방어사(음성)', 'kamd-greenpine', SRC_OPEN,
     [('Green Pine', 'english'), ('GBR', 'english'), ('그린파인', 'colloquial'),
      ('AN/TPY-2', 'english')]),
    ('글로벌호크(RQ-4B)', 'global-hawk-rq4b', 'RQ-4B 글로벌호크 고고도 ISR UAV',
     'ISR', 'air', '고고도 전략 정찰(ISR)',
     '고고도 장기체공 전략 정찰 UAV. 한반도 전역 감시(ISR).',
     None, None, 'ready', '사동 기지(글로벌호크)', None, SRC_OPEN,
     [('Global Hawk', 'english'), ('RQ-4B', 'english'), ('글로벌호크', 'colloquial'),
      ('Northrop Grumman RQ-4', 'english')]),
    ('헤론(Heron) UAV', 'heron-uav', '헤론(Heron) 중고도 ISR UAV',
     'ISR', 'air', '중고도 장기체공 정찰',
     '중고도 장기체공 정찰 UAV. 전술 ISR.',
     None, None, 'standby', '진해 해군기지', None, SRC_OPEN,
     [('Heron', 'english'), ('헤론', 'colloquial'), ('IAI Heron', 'english')]),
    ('M-SAM 다기능레이더(MSR)', 'm-sam-msr-radar', '철매-2 체계 다기능레이더(MSR)',
     'KAMD_DETECT', 'army', '중고공 탐지/추적(요격체계 연동)',
     'M-SAM(철매-2) 체계의 다기능 레이더. 탐지거리 ~100km급(공개보도 수치).',
     None, 100, 'ready', '미사일방어사(음성)', None, SRC_OPEN,
     [('MSR', 'english'), ('철매-2 지상레이더', 'colloquial'), ('M-SAM radar', 'english')]),

    # ── LAMD 요격 (intercept) ──
    ('L-SAM', 'l-sam', 'L-SAM 장거리 지대공미사일',
     'KAMD_INTERCEPT', 'strategic', '장거리 고고도 요격(탄도미사일 종말단계)',
     '장거리 고고도 요격체계. 사거리 ~150km(개발중, 공개보도 수치).',
     150, None, 'standby', '미사일방어사(음성)', 'lamd-lsam', SRC_MND,
     [('L-SAM', 'official'), ('장거리 지대공미사일', 'colloquial'),
      ('Long-range Surface-to-Air Missile', 'english')]),
    ('M-SAM(철매-2/천궁-II)', 'm-sam-cheolmae', '철매-2(M-SAM, 천궁-II) 중고도 요격체계',
     'KAMD_INTERCEPT', 'army', '중고도 요격(탄도미사일 종말단계)',
     '중고도 요격체계. 탄도미사일 종말단계 요격. 사거리 ~40km(공개보도 수치).',
     40, None, 'ready', '미사일방어사(음성)', 'lamd-msam', SRC_MND,
     [('철매-2', 'colloquial'), ('M-SAM', 'english'), ('천궁', 'colloquial'),
      ('Cheolmae-2', 'english'), ('KM-SAM', 'english')]),
    ('PAC-3 패트리어트', 'pac-3', 'PAC-3 지대공 요격(패트리어트)',
     'KAMD_INTERCEPT', 'army', '저고도 최종 요격(수도권/주요시설 방어)',
     '저고도 최종 요격. 수도권/주요시설 방어. 사거리 ~20km(공개보도 수치).',
     20, None, 'ready', '방공포병여단(수도권)', 'lamd-pac3', SRC_OPEN,
     [('PAC-3', 'official'), ('Patriot', 'english'), ('패트리어트', 'colloquial'),
      ('MIM-104', 'english')]),

    # ── KMPR 타격 (strike) ──
    ('현무-4M', 'hyunmoo-4m', '현무-4M 지대지 탄도/순항미사일',
     'KMPR_STRIKE', 'strategic', '전략 타격(KMPR 핵심)',
     '지대지 탄도/순항미사일. KMPR 핵심 자산. 사거리 ~800km(공개보도 수치).',
     800, None, 'ready', '미사일방어사(음성)', 'kmpr-hyunmoo', SRC_MND,
     [('현무-4', 'colloquial'), ('Hyunmoo-4', 'english'), ('Hyunmoo', 'english'),
      ('현무', 'colloquial')]),
    ('현무-2B', 'hyunmoo-2b', '현무-2B 지대지 탄도미사일',
     'KMPR_STRIKE', 'army', '전술 타격(지대지)',
     '지대지 단거리 탄도미사일. 사거리 ~500km(공개보도 수치).',
     500, None, 'ready', '미사일방어사(음성)', None, SRC_MND,
     [('현무-2', 'colloquial'), ('Hyunmoo-2', 'english')]),
    ('현무-3 순항미사일', 'hyunmoo-3', '현무-3 지대지 순항미사일',
     'KMPR_STRIKE', 'strategic', '장거리 정밀타격(순항)',
     '지대지 순항미사일(장거리 타격). 사거리 ~1000km 이상(공개보도 수치).',
     1000, None, 'ready', '미사일방어사(음성)', None, SRC_MND,
     [('현무-3', 'colloquial'), ('Hyunmoo-3', 'english'),
      ('현무 순항미사일', 'colloquial')]),
    ('F-35A 스텔스 전투기', 'f-35a', 'F-35A 스텔스 전투기(정밀타격)',
     'KMPR_STRIKE', 'air', '스텔스 침투 정밀타격(스크램블)',
     '5세대 스텔스 전투기. 적 핵·미사일 시설 정밀타격. 작전반경 ~1093km(공개보도 수치).',
     1093, None, 'ready', '청주 공군기지', 'kmpr-f35', SRC_MND,
     [('F-35A', 'official'), ('F-35', 'english'), ('스텔스 전투기', 'colloquial'),
      ('Lightning II', 'english')]),
    ('F-15K 전투기', 'f-15k', 'F-15K(SLAM-ER/AGM-84H 장거리 정밀타격)',
     'AIR', 'air', '장거리 정밀타격(공대지)',
     'F-15K 슬램MER/AGM-84H 장거리 정밀타격. 작전반경 ~1800km(공개보도 수치).',
     1800, None, 'ready', '대구 공군기지', None, SRC_OPEN,
     [('F-15K', 'official'), ('Slam Eagle', 'english'),
      ('SLAM-ER', 'english'), ('AGM-84H', 'english')]),
    ('KF-21 전투기', 'kf-21', 'KF-21 보라매 차세대 전투기',
     'AIR', 'air', '다목적 전투/타격',
     '국산 4.5세대 전투기. 다목적 전투/타격.',
     None, None, 'standby', '청주 공군기지', None, SRC_MND,
     [('KF-21', 'official'), ('보라매', 'colloquial'), ('Boramae', 'english')]),
    ('천무(K-MLRS)', 'cheonmu-k-mlrs', '천무(K239/K-MLRS) 다연장로켓',
     'KMPR_STRIKE', 'army', '장사정 방사포 타격',
     '대구경 다연장로켓(천무). 사거리 ~80km(기본)/~160km(전탄, 공개보도 수치).',
     160, None, 'ready', '오봉리 K-MLRS 기지', None, SRC_MND,
     [('천무', 'colloquial'), ('K-MLRS', 'english'), ('K239', 'english'),
      ('다연장로켓', 'colloquial')]),

    # ── 해상 (NAVAL) ──
    ('이지구축함(세종대왕급)', 'sejong-the-great-aegis', '세종대왕급 이지스 구축함(SPY-1D/SM-2)',
     'NAVAL', 'naval', '해상 탄도미사일 탐지/추적(SM-2 요격)',
     '이지스 구축함. SPY-1D 레이더로 동해상 발사체 탐지/추적. 탐지거리 ~500km(공개보도 수치). SM-2 요격.',
     150, 500, 'ready', '부산 해군작전기지', 'kamd-args', SRC_OPEN,
     [('세종대왕급', 'colloquial'), ('Sejong the Great', 'english'),
      ('Aegis destroyer', 'english'), ('SPY-1D', 'english'), ('SM-2', 'english')]),
    ('이지구축함(정조대왕급)', 'jeongjo-the-great-aegis', '정조대왕급 이지스 구축함(KDX-III Batch-II)',
     'NAVAL', 'naval', '해상 탄도미사일 탐지/SM-3 상층요격',
     '차세대 이지스 구축함(KDX-III Batch-II). SM-3 상층요격 탑재 예정. 탐지거리 ~500km+(공개보도 수치).',
     500, 500, 'standby', '진해 해군기지', None, SRC_OPEN,
     [('정조대왕급', 'colloquial'), ('Jeongjo the Great', 'english'),
      ('KDX-III Batch-II', 'english'), ('SM-3', 'english')]),
    ('손원일급 잠수함(SLBM)', 'son-won-il-submarine', '손원일급(도산안창호급) 잠수함(SLBM)',
     'NAVAL', 'naval', '잠수함 발사 탄도미사일(현무-4-4) 보복타격',
     '손원일급(도산안창호급) 잠수함. 현무-4-4 SLBM 탑재. 2격 전력 보존/KMPR 보복타격.',
     800, None, 'ready', '진해 해군기지', 'kmpr-slbm', SRC_MND,
     [('손원일급', 'colloquial'), ('도산안창호급', 'colloquial'),
      ('Dosan Ahn Changho', 'english'), ('SLBM', 'english'), ('현무-4-4', 'colloquial')]),
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

    lines = ['-- AUTO-GENERATED by build_friendly_seed.py (gitignore). 공개 제원 기반 아군(Blue) 자산.', '']

    # friendly_units
    lines.append('-- friendly_units')
    for u in UNITS:
        (cn, slug, des, atype, branch, role, cap, rng, det, ready,
         base, doctrine, (sref, surl), aliases) = u
        lat, lng = BASE.get(base, (None, None))
        lines.append(
            "insert into friendly_units (canonical_name,slug,designation,asset_type,branch,role,capability,"
            "range_km,detection_range_km,readiness,base_name,operates_doctrine_option,hq_lat,hq_lng,source_ref,source_url) values ("
            f"{qt(cn)},{qt(slug)},{qt(des)},{qt(atype)},{qt(branch)},{qt(role)},{qt(cap)},"
            f"{qt(rng)},{qt(det)},{qt(ready)},{qt(base)},{qt(doctrine)},{qt(lat)},{qt(lng)},{qt(sref)},{qt(surl)}"
            ") on conflict (canonical_name) do update set "
            "designation=excluded.designation,asset_type=excluded.asset_type,branch=excluded.branch,"
            "role=excluded.role,capability=excluded.capability,range_km=excluded.range_km,"
            "detection_range_km=excluded.detection_range_km,readiness=excluded.readiness,"
            "base_name=excluded.base_name,operates_doctrine_option=excluded.operates_doctrine_option,"
            "hq_lat=excluded.hq_lat,hq_lng=excluded.hq_lng,source_ref=excluded.source_ref,"
            "source_url=excluded.source_url;")

    # friendly_unit_aliases
    lines.append('\n-- friendly_unit_aliases')
    for u in UNITS:
        cn = u[0]
        aliases = u[-1]
        asrc = u[12][0]  # source tuple 첫 번째 요소(source_ref)
        for atext, atype in aliases:
            lines.append(
                "insert into friendly_unit_aliases (friendly_id,alias_text,alias_type,source) values "
                f"((select friendly_id from friendly_units where canonical_name={qt(cn)}),{qt(atext)},{qt(atype)},{qt(asrc)}) "
                "on conflict (friendly_id,alias_text,alias_type) do nothing;")

    open(SQL_OUT, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    n = len(UNITS)
    print(f'✅ friendly_units={n} → {os.path.relpath(SQL_OUT, WEB_UI)}')

    if args.no_apply:
        print('(--no-apply) 적재 생략'); return
    print('[apply] 원격 적재...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
                       cwd=WEB_UI, capture_output=True, text=True)
    print('✅ 적재 성공' if r.returncode == 0 else '❌ ' + (r.stderr or r.stdout))


if __name__ == '__main__':
    main()
