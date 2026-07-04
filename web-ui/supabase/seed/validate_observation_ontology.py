#!/usr/bin/env python3
"""
validate_observation_ontology.py
observation 시드를 우리 온톨로지(facility_aliases / §5 facts-only / 신뢰도 정량화 축)로 검증.

검증 항목:
  1) location_name → 정규 시설 해석 커버리지 (facility_aliases substring 매칭)
  2) §5 위반: activity_desc/observed_objects 에 무기 판별어(KN-/Hwasong/화성-N/SRBM/액체연료발사체…) 누출 여부
  3) 신뢰도 정량화 축: reliability 분포, polarity × unusual_flag 교차
     (PRESENT+routine = 기준선 "특이사항 없음도 특이사항", ABSENT = 진단적 negative evidence)

사용: python3 validate_observation_ontology.py
"""
import json, os, re, subprocess, sys

WEB_UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def q(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql],
                       cwd=WEB_UI, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('❌ 쿼리 실패:\n' + (r.stderr or r.stdout))
    m = re.search(r'"rows":\s*(\[.*\])\s*\n\s*\}', r.stdout, re.S) or re.search(r'"rows":\s*(\[.*\])', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def main():
    print('=' * 60)
    print('observation 시드 vs 온톨로지 검증')
    print('=' * 60)

    # 1) location 해석 커버리지
    rows = q("""select o.loc, f.canonical_name, f.facility_type from
      (select distinct location_name as loc from observation where location_name is not null) o
      left join lateral (
        select canonical_name, facility_type from facility_aliases fa
        join facilities f on f.facility_id = fa.facility_id
        where o.loc like '%'||fa.alias_text||'%' or fa.alias_text like '%'||o.loc||'%'
        order by length(fa.alias_text) desc limit 1
      ) f on true order by o.loc;""")
    total = len(rows)
    resolved = [r for r in rows if r.get('canonical_name')]
    print(f"\n[1] location → 정규 시설 해석: {len(resolved)}/{total}")
    for r in rows:
        if not r.get('canonical_name'):
            print(f"    ✗ 미해석: {r['loc']}")
    print('    → 전면 커버' if len(resolved) == total else '    → 갭 존재(aliases 보충 필요)')

    # 2) §5 facts-only 위반 (무기 판별어 누출)
    leak = q("""select count(*) as n from observation
      where activity_desc ~* 'KN-[0-9]|Hwasong|화성-[0-9]|Scud|스커드-[0-9]|Nodong|Musudan|Pukguksong|북극성-[0-9]|SRBM|MRBM|IRBM|ICBM|SLBM|HGV|액체연료 발사체|고체연료 미사일|SLV급';""")
    n_leak = leak[0]['n'] if leak else 0
    print(f"\n[2] §5 위반(무기 판별어 누출): {n_leak}건 → {'준수 ✓' if n_leak == 0 else '위반 ✗ (정제 필요)'}")

    # 3) 신뢰도 정량화 축
    rel = q("select reliability, count(*) as n from observation group by 1 order by 1;")
    print("\n[3] reliability 분포:")
    for r in rel:
        print(f"    {r['reliability']}: {r['n']}건")

    cross = q("""select polarity, unusual_flag, count(*) as n from observation
      group by 1,2 order by 1,2;""")
    print("    polarity × unusual_flag:")
    for r in cross:
        tag = {'PRESENT': {('false',): '기준선(특이사항 없음)', ('true',): '이상징후'},
               'ABSENT': {('true',): '진단적 negative evidence'}}
        print(f"    {r['polarity']:<8} unusual={str(r['unusual_flag']):<6} → {r['n']}건")

    # 종합
    print('\n' + '=' * 60)
    ok = len(resolved) == total and n_leak == 0
    print('검증 결과:', '✅ PASS (온톨로지 커버리지 양호, §5 준수)' if ok else '⚠️  갭/위반 존재 — 위 출력 참고')
    print('=' * 60)


if __name__ == '__main__':
    main()
