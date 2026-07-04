#!/usr/bin/env python3
"""
build_doctrine_seed.py
아군 교리 연동(Track B) 5+1 테이블 시드 생성기.

테이블:
  watchcon_levels          — 경계태세 위상 1-5 (단순경계 ~ 전시)
  killchain_phases         — KAMD 킬체인 detect/assess/decide/act
  response_options         — 교리 3축 대응 (KAMD 탐지 / KMPR 타격 / LAMD 요격)
  c2_authority             — 보고/결재선
  roe_categories           — 교전규칙 카테고리
  friendly_assets_doctrine — 아군 자산 교리 메타 (사거리/탐지거리/가용성)

원천: 공개 교리 개념(ROK MND 발표자료/공개 보도 수준). 실 운용 수치·체계연동은
      illustrative stub. 데이터는 supabase 가 source of truth.

산출(gitignore): supabase/seed/doctrine_seed.sql → 원격 적재 (ON CONFLICT 멱등).
"""
import argparse, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'doctrine_seed.sql')


def qt(v):
    return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"


# =========================================================
# 1) watchcon_levels — 경계태세 위상 1(전시) ~ 5(단순경계)
# =========================================================
WATCHCON = [
    # level, name, english, meaning, activation_condition(illustrative), recommended_posture
    (5, '단순경계', 'Simple Alert',
     '평시 기본 경계태세. 특이 징후 없음.',
     '발사 가설 사후확률 < 25% (illustrative)',
     '정례 감시 유지. 정문 감시체계 정상 가동.'),
    (4, '경계', 'Watch',
     '징후 단계. 부분적 이상 활동 탐지, 발사 가능성 낮음.',
     '발사 가설 사후확률 25-50% 또는 엔진시험/연료활동 단독 탐지',
     'KAMD 감시자산(피스아이/그린파인) 가동률 상향. 정보수집 강화.'),
    (3, '비상', 'Emergency',
     '발사 준비 징후 누적. 발사 가능성 상당.',
     '발사 가설 사후확률 50-70% 또는 발사대 TEL 전개 포착',
     'LAMD 요격자산(M-SAM/L-SAM) 전개 완료. KMPR 타격자산 대기.'),
    (2, '심각', 'Severe',
     '발사 임박 또는 발사 직후. 고도 위협.',
     '발사 가설 사후확률 >= 70% 또는 부스트 단계 탐지',
     '전 축 대응 태세. NSC 안보상황회의 소집. 요격/타격 결심 대기.'),
    (1, '전시', 'War',
     '적 공격이 개시되었거나 전시 상황. (데모에서는 자동 발동 제외)',
     '실제 타격 발생 (데모 범위 밖)',
     '전시작업권 전환. 전면 대응. (본 데모에서는 stub)'),
]

# =========================================================
# 2) killchain_phases — KAMD 킬체인 4단계
# =========================================================
KILLCHAIN = [
    # phase, korean, ordinal, entry_condition, exit_condition, description
    ('detect', '탐지', 1,
     'IMINT/SIGINT 등 첫 징후 포착 (관측 계층 진입).',
     '탐지된 신호가 유의미한 위협으로 분류될 때까지.',
     '위성영상·SIGINT·레이더로 적 발사체 징후를 최초 포착. KAMD 감시자산 가동.'),
    ('assess', '판단', 2,
     '관측 정형화 + 베이지안 추론으로 사후확률 산출 개시.',
     '위협 확률이 결심 임계(illustrative 65%)에 도달하기 전.',
     '추론 엔진이 복수 가설의 사후확률을 갱신하고 정규 미사일/시설 온톨로지로 징후를 해석.'),
    ('decide', '결심', 3,
     '최유력 발사 가설 사후확률 >= 결심 임계(65%, illustrative).',
     '아군 대응 옵션 결심 및 권한 보고 완료.',
     'C2 체계에서 watchcon 상향, ROE 단계 결정, 축별(KAMD/KMPR/LAMD) 대응 결심.'),
    ('act', '실행', 4,
     '아군 대응 개시(요격/타격/축출) 또는 부스트 단계 확정 탐지.',
     '위협 종식 또는 상황 종료 선언.',
     'LAMD 요격 + KMPR 타격 + KAMD 추적의 종합 대응 실행. 전 과정 BDA 피드백.'),
]

# =========================================================
# 3) response_options — 교리 3축 (KAMD 탐지 / KMPR 타격 / LAMD 요격)
# =========================================================
RESPONSE_OPTIONS = [
    # option_id, pillar, pillar_name, asset, trigger_phase, authority_threshold, priority, description
    # KAMD (Korea Air and Missile Defense) — 탐지/추적/요격지휘
    ('kamd-peaceseye', 'kamd', '한국형 미사일방어(KAMD) - 탐지',
     '피스아이(E-737) 조기경보기', 'detect', '작전사령관 (illustrative)', 1,
     '공중 조기경보로 부스트 단계 발사체 추적. 서해 감시 비행 기지 준비.'),
    ('kamd-greenpine', 'kamd', '한국형 미사일방어(KAMD) - 탐지',
     '그린파인(Green Pine) 레이더', 'detect', '작전사령관 (illustrative)', 2,
     '지상 기반 탄도미사일 추적 레이더. 탐지거리 ~500km(공개보도 수치).'),
    ('kamd-args', 'kamd', '한국형 미사일방어(KAMD) - 탐지',
     '이지구축함 ARGS(Sejong the Great-class)', 'detect', '작전사령관 (illustrative)', 3,
     '함정 SPY-1 레이더로 동해상 발사체 탐지/추적.'),
    # LAMD (Lower Altitude Air and Missile Defense) — 저고도 요격
    ('lamd-msam', 'lamd', '저고도방어(LAMD) - 요격',
     '철매-2(M-SAM Cheolmae)', 'decide', '미사일방어사령관 (illustrative)', 1,
     '중고도 요격체계. 탄도미사일 종말단계 요격. 사거리 ~40km(공개보도 수치).'),
    ('lamd-lsam', 'lamd', '저고도방어(LAMD) - 요격',
     'L-SAM 장거리 지대공미사일', 'decide', '미사일방어사령관 (illustrative)', 2,
     '장거리 고고도 요격. 사거리 ~150km(개발중, 공개보도 수치).'),
    ('lamd-pac3', 'lamd', '저고도방어(LAMD) - 요격',
     'PAC-3 패트리어트', 'act', '방공포병여단장 (illustrative)', 3,
     '저고도 최종 요격. 수도권/주요시설 방어.'),
    # KMPR (Korea Massive Punishment and Retaliation) — 타격보복
    ('kmpr-hyunmoo', 'kmpr', '대량응징보복(KMPR) - 타격',
     '현무 탄도미사일(Hyunmoo)', 'act', '합참의장 승인 (illustrative)', 1,
     '지대지 탄도미사일로 적 발사지점/지휘소 타격. 현무-4 사거리 ~800km(공개보도 수치).'),
    ('kmpr-f35', 'kmpr', '대량응징보복(KMPR) - 타격',
     'F-35A 스텔스 전투기', 'act', '합참의장 승인 (illustrative)', 2,
     '스텔스 침투 타격. 적 핵·미사일 시설 정밀타격.'),
    ('kmpr-slbm', 'kmpr', '대량응징보복(KMPR) - 타격',
     '도산안창호급 SLBM', 'act', '대통령 승인 (illustrative)', 3,
     '잠수함 발사 탄도미사일로 보복타격. 2격 전력 보존.'),
]

# =========================================================
# 4) c2_authority — 보고/결재선
# =========================================================
C2_AUTHORITY = [
    # tier, authority, role, decision_threshold, reporting_chain
    (1, '국무회의 / 대통령',
     '최고 통수권자(국군통수권). 무력사용 최종 승인.',
     '전시(watchcon 1), KMPR 전면 타격, 선제타격 승인',
     'NSC 안보상황회의 소집 (illustrative: 즉시 소집)'),
    (2, '합동참모의장',
     '군사 작전 총괄지휘. 교전규칙(ROE) 해석/적용.',
     '심각(watchcon 2) 상향 결심, KMPR 제한타격 승인',
     '상황보고: watchcon 1-2 = 즉시, 3 = 1시간, 4-5 = 일일 (illustrative)'),
    (3, '작전사령관(지작/공작/해작)',
     '전구 작전 지휘. KAMD/LAMD 축 작전 통제.',
     '비상(watchcon 3) 발령, 요격자산 전개, 감시자산 가동',
     '상황보고: watchcon 2 이하 = 즉시, 3 = 1시간 (illustrative)'),
    (4, '군사령관 / 기능사(미사일방어사·방공관제사)',
     '축별 전술 지휘. 자산 가동/요격 집행.',
     '경계(watchcon 4) 자산 대기, 감시 강화',
     '상황보고: 실시간 전숫자료 전송 (illustrative)'),
]

# =========================================================
# 5) roe_categories — 교전규칙 카테고리 (데모용)
# =========================================================
ROE = [
    # category_id, name, allowed_actions, activation_watchcon, description
    ('roe-surveillance', '정찰·감시',
     '위성/ISR/SIGINT 감시, 조기경보기 감시비행, 보고',
     5,
     '평시 기본. 무력사용 금지. 정보수집과 보고만 허용.'),
    ('roe-readiness', '경계·대기',
     '요격자산 전개, 타격자산 대기, 감시 강화',
     4,
     '징후 단계. 무력사용 금지. 자산 전개와 태세전환 허용.'),
    ('roe-selfdefense', '자위권 발동',
     '요격(자위적 방위), 적 발사체 추적·격추',
     3,
     '적 공격 임박/진행 시 자위적 요격 허용.'),
    ('roe-limitedstrike', '제한타격',
     '격침지역/발사지점 정밀타격 (보복)',
     2,
     '심각 단계. 합참의장 승인 하 적 발사거점 타격.'),
    ('roe-fullretaliation', '전면대응(KMPR)',
     '대량응징보복 전면 타격, 전시작업권 행사',
     1,
     '전시 상황. 대통령 승인 하 KMPR 전면 발동.'),
]

# =========================================================
# 6) friendly_assets_doctrine — 아군 자산 교리 메타
# =========================================================
FRIENDLY_ASSETS = [
    # canonical_name, slug, pillar, asset_type, range_km, detection_range_km, readiness, current_watchcon, description
    ('피스아이(E-737)', 'peace-eye-e737', 'isr', 'sensor', None, 800, 'ready', 5,
     '공중 조기경보기. 부스트 단계 발사체 원거리 탐지.'),
    ('그린파인 레이더', 'green-pine-radar', 'isr', 'sensor', None, 500, 'ready', 5,
     '지상 탄도미사일 추적 레이더(공개보도 수치).'),
    ('현무-4', 'hyunmoo-4', 'kmpr', 'strike', 800, None, 'ready', 5,
     '지대지 탄도미사일(공개보도 수치). KMPR 핵심 자산.'),
    ('현무-2B', 'hyunmoo-2b', 'kmpr', 'strike', 500, None, 'ready', 5,
     '지대지 탄도미사일(공개보도 수치).'),
    ('L-SAM', 'l-sam', 'lamd', 'interceptor', 150, None, 'standby', 5,
     '장거리 고고도 요격체계(개발중, 공개보도 수치).'),
    ('철매-2(M-SAM)', 'm-sam-cheolmae', 'lamd', 'interceptor', 40, None, 'ready', 5,
     '중고도 요격체계(공개보도 수치).'),
    ('PAC-3', 'pac-3', 'lamd', 'interceptor', 20, None, 'ready', 5,
     '저고도 최종 요격(공개보도 수치).'),
    ('F-35A', 'f-35a', 'kmpr', 'fighter', 1100, None, 'ready', 5,
     '스텔스 전투기. 정밀타격 자산(작전반경 공개보도 수치).'),
    ('이지구축함(세종대왕급)', 'sejong-the-great-aegis', 'kamd', 'sensor', None, 500, 'ready', 5,
     '함정 SPY-1 레이더 탐지/추적(공개보도 수치).'),
]


def build_sql():
    lines = [
        '-- AUTO-GENERATED by build_doctrine_seed.py (gitignore). 재실행 멱등.',
        '-- 원천: 공개 교리 개념 (ROK MND 발표/공개 보도 수준). 실 운용 수치는 illustrative.',
        '',
        '-- watchcon_levels',
    ]
    for (level, name, en, meaning, act, posture) in WATCHCON:
        lines.append(
            "insert into watchcon_levels (level,name,english_name,meaning,activation_condition,recommended_posture) values ("
            f"{level},{qt(name)},{qt(en)},{qt(meaning)},{qt(act)},{qt(posture)}) "
            "on conflict (level) do update set name=excluded.name,english_name=excluded.english_name,"
            "meaning=excluded.meaning,activation_condition=excluded.activation_condition,"
            "recommended_posture=excluded.recommended_posture;"
        )

    lines.append('\n-- killchain_phases')
    for (phase, kor, ord_, ent, ex, desc) in KILLCHAIN:
        lines.append(
            "insert into killchain_phases (phase,korean_name,ordinal,entry_condition,exit_condition,description) values ("
            f"{qt(phase)},{qt(kor)},{ord_},{qt(ent)},{qt(ex)},{qt(desc)}) "
            "on conflict (phase) do update set korean_name=excluded.korean_name,ordinal=excluded.ordinal,"
            "entry_condition=excluded.entry_condition,exit_condition=excluded.exit_condition,description=excluded.description;"
        )

    lines.append('\n-- response_options')
    for (oid, pillar, pname, asset, trig, auth, prio, desc) in RESPONSE_OPTIONS:
        lines.append(
            "insert into response_options (option_id,pillar,pillar_name,asset,trigger_phase,authority_threshold,priority,description) values ("
            f"{qt(oid)},{qt(pillar)},{qt(pname)},{qt(asset)},{qt(trig)},{qt(auth)},{prio},{qt(desc)}) "
            "on conflict (option_id) do update set pillar=excluded.pillar,pillar_name=excluded.pillar_name,"
            "asset=excluded.asset,trigger_phase=excluded.trigger_phase,authority_threshold=excluded.authority_threshold,"
            "priority=excluded.priority,description=excluded.description;"
        )

    lines.append('\n-- c2_authority')
    for (tier, auth, role, thr, chain) in C2_AUTHORITY:
        lines.append(
            "insert into c2_authority (tier,authority,role,decision_threshold,reporting_chain) values ("
            f"{tier},{qt(auth)},{qt(role)},{qt(thr)},{qt(chain)}) "
            "on conflict (tier) do update set authority=excluded.authority,role=excluded.role,"
            "decision_threshold=excluded.decision_threshold,reporting_chain=excluded.reporting_chain;"
        )

    lines.append('\n-- roe_categories')
    for (cid, name, allowed, wc, desc) in ROE:
        lines.append(
            "insert into roe_categories (category_id,name,allowed_actions,activation_watchcon,description) values ("
            f"{qt(cid)},{qt(name)},{qt(allowed)},{wc if wc else 'NULL'},{qt(desc)}) "
            "on conflict (category_id) do update set name=excluded.name,allowed_actions=excluded.allowed_actions,"
            "activation_watchcon=excluded.activation_watchcon,description=excluded.description;"
        )

    lines.append('\n-- friendly_assets_doctrine')
    for (name, slug, pillar, atype, rng, det, ready, wc, desc) in FRIENDLY_ASSETS:
        lines.append(
            "insert into friendly_assets_doctrine (canonical_name,slug,pillar,asset_type,range_km,detection_range_km,readiness,current_watchcon,description) values ("
            f"{qt(name)},{qt(slug)},{qt(pillar)},{qt(atype)},{rng if rng else 'NULL'},{det if det else 'NULL'},"
            f"{qt(ready)},{wc if wc else 'NULL'},{qt(desc)}) "
            "on conflict (canonical_name) do update set slug=excluded.slug,pillar=excluded.pillar,"
            "asset_type=excluded.asset_type,range_km=excluded.range_km,detection_range_km=excluded.detection_range_km,"
            "readiness=excluded.readiness,current_watchcon=excluded.current_watchcon,description=excluded.description;"
        )

    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-apply', action='store_true')
    args = ap.parse_args()

    sql = build_sql()
    with open(SQL_OUT, 'w', encoding='utf-8') as f:
        f.write(sql)

    n = {
        'watchcon_levels': len(WATCHCON),
        'killchain_phases': len(KILLCHAIN),
        'response_options': len(RESPONSE_OPTIONS),
        'c2_authority': len(C2_AUTHORITY),
        'roe_categories': len(ROE),
        'friendly_assets_doctrine': len(FRIENDLY_ASSETS),
    }
    print(f"✅ 시드 SQL 생성 → {os.path.relpath(SQL_OUT, WEB_UI)}")
    for t, c in n.items():
        print(f"   {t}: {c}행")

    if args.no_apply:
        print('(--no-apply) 적재 생략')
        return
    print('[apply] 원격 적재...')
    r = subprocess.run(
        ['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
        cwd=WEB_UI, capture_output=True, text=True,
    )
    if r.returncode == 0:
        print('✅ 원격 적재 성공')
    else:
        print('❌ 적재 실패:\n' + (r.stderr or r.stdout))
        sys.exit(1)


if __name__ == '__main__':
    main()
