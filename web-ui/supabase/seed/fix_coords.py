#!/usr/bin/env python3
"""
fix_coords.py
observation.mgrs 좌표 이상치 수정 (원격 Supabase 적재).

사유: 시드 생성 시 MGRS 위도 밴드/100km 사각식 식별자 오류로 일부 관측 좌표가
실제 시설에서 수백 km(또는 십수 km) 이격된 위치로 변환됨.
  - 풍계리 핵실험장: "52S EH …" → 밴드 S(32~40N)로 인해 38.45N(일본해 해저) 변환.
    실제 41.27N. 밴드 T(40~48N) + 올바른 100km 사각형(EL) 필요.
  - 신포 남조선소: "52S DG …" → 37.45N 변환. 실제 40.04N. 밴드 T + DK 필요.
  - 잠진/순안: 밴드는 맞으나 100km 오프셋 또는 저정밀도로 17~18km 이격 →
    정규 시설 OSINT 공개 좌표로 MGRS 재계산하여 정렬.

수정 방식: 정규 시설 OSINT 공개 좌표(lat,lng)에서 toMGRS 로 재계산한 값으로 UPDATE.
멱등: WHERE mgrs = '<잘못된값>' 조건이므로 재실행 시 이미 수정된 행은 영향 없음.

사용: python3 fix_coords.py
"""
import os, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_SQL = os.path.join(os.path.dirname(__file__), 'fix_coords_seed.sql')

# (잘못된 MGRS, 수정할 MGRS, 설명, 기준 OSINT 좌표)
FIXES = [
    # 풍계리 핵실험장 — 38 North 공개 갱도 좌표
    ('52S EH 1350 5600', '52T EL 05861 70064',
     '풍계리 북/서 갱도 (West/North Portal)', (41.282, 129.070)),
    ('52S EH 1400 5550', '52T EL 07371 68178',
     '풍계리 남측 갱도/지휘소 (South Portal)', (41.265, 129.088)),
    # 신포 남조선소 잠수함 기지
    ('52S DG 4700 4500', '52T DK 30048 32851',
     '신포 남조선소 잠수함 기지', (40.043, 128.180)),
    # 잠진 기계공장/엔진시험장 (남포 인근) — 정규 시설 좌표 정렬
    ('51S YD 11588 14896', '51S YD 27785 18957',
     '잠진 기계공장/엔진시험장 (남포)', (38.99, 125.63)),
    # 순안 비행장 (평양 국제공항) — 정규 시설 좌표 정렬
    ('51S YD 4500 3200', '51S YD 30845 42393',
     '순안 비행장 (평양 국제공항)', (39.200159, 125.673256)),
]


def build_sql():
    lines = ['-- observation.mgrs 좌표 이상치 수정 (fix_coords.py 생성)',
             '-- 각 UPDATE 는 WHERE mgrs = 잘못된값 조건으로 멱등.',
             'begin;']
    total = 0
    for bad, good, desc, (lat, lng) in FIXES:
        lines.append(f'-- {desc}: {bad} → {good} (OSINT {lat}, {lng})')
        lines.append(f"update observation set mgrs = '{good}' where mgrs = '{bad}';")
        total += 1
    lines.append('commit;')
    lines.append('')
    with open(OUT_SQL, 'w') as f:
        f.write('\n'.join(lines))
    return total


def main():
    n = build_sql()
    print(f'수정 항목 {n}개 → {OUT_SQL} 작성')
    print('원격 적재 중...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', OUT_SQL],
                       cwd=WEB_UI, capture_output=True, text=True)
    out = r.stdout or ''
    if r.returncode != 0 or '"_tag":"Error"' in out:
        sys.exit('적재 실패:\n' + (r.stderr or out))
    # UPDATE 적재는 rows 없는 빈 응답이 정상
    print('적재 완료 ✓')
    print(out.strip().splitlines()[-1] if out.strip() else '(응답 본문 없음 — UPDATE 정상)')

    # 영향 행 수 사후 확인
    print('\n수정 후 행 수 확인:')
    chk = subprocess.run(
        ['npx', 'supabase', 'db', 'query', '--linked',
         "select count(*) as remaining_bad from observation where mgrs in ("
         + ",".join(f"'{b}'" for b, *_ in FIXES) + ");"],
        cwd=WEB_UI, capture_output=True, text=True)
    print(chk.stdout.strip().splitlines()[-3] if chk.stdout else '(확인 실패)')


if __name__ == '__main__':
    main()
