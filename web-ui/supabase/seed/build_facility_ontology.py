#!/usr/bin/env python3
"""
build_facility_ontology.py
facilities + facility_aliases (시설 온톨로지 + 위치 매칭) 시드.

구성:
  1) launch_facilities(49) → facilities 로 INSERT...SELECT (영문 canonical, launch_facility_id 연결)
  2) 큐레이션 추가 시설: observation에 나오나 launch site가 아닌 시설(엔진시험장/공장/화학공장/VIP/핵실험장) + 주요 미사일 공장
  3) facility_aliases: launch_facilities 영문명 + 한국어/별칭 + observation의 location_name 19개(정규 시설로 핸드-매핑)

산출(gitignore): supabase/seed/facility_ontology_seed.sql → 원격 적재.
"""
import argparse, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'facility_ontology_seed.sql')

# launch site 가 아닌 정규 시설 (observation에 등장 + 주요 미사일 관련 시설)
# (canonical_name, slug, type, region, lat, lng, fuel_type, role, description)
NEW_FACILITIES = [
    ('잠진 기계공장/엔진시험장', 'chamjin', 'test_stand', '남포 인근', 38.99, 125.63, 'liquid',
     '대출력 액체엔진 지상 분출·수직 시험대', '남포 인근 잠진. 액체엔진 시험.'),
    ('동창리 고체모터 시험장', 'sohae-solid', 'motor_test', '평안북도 동창리', 39.63, 124.72, 'solid',
     '신형 고체연료 모터 연소 시험장', '동창리 서해위성발사장 인근 고체모터 시험.'),
    ('산음동 미사일 연구·생산단지', 'saneumdong', 'factory', '평양 산음동', None, None, 'common',
     '미사일 동체 대형 생산홀', '평양 인근. 대형 생산홀 + 유개트럭 다수 식별.'),
    ('은하화학공장 (만포)', 'manpo-galaxy', 'chemical_plant', '자강도 만포', None, None, 'liquid',
     '산화제·특수화학물질(액체연료 원료) 생산', '자강도 만포 은하화학공장(만포운하공장).'),
    ('평양 룡성 지도부 전용역', 'ryongseong-station', 'vip', '평양 룡성', None, None, 'common',
     '김정은 전용열차 승강장 (발사 참관 VIP)', '룡성. 발사 참관용 VIP 열차 정차.'),
    ('풍계리 핵실험장', 'punggyeri', 'nuclear_site', '함경북도 길주', 41.29, 129.07, 'common',
     '지하 핵실험 갱도 (남측/북측/서측)', '길주 풍계리. 갱도별 핵실험.'),
    ('함흥 제17호 공장', 'hamhung-17', 'factory', '함경남도 함흥', None, None, 'solid',
     '고체연료 배합·충전·연소관 주조', '함흥 화학공업단지 인근.'),
    ('함흥 제11호 공장 (룡성기계)', 'hamhung-11', 'factory', '함경남도 함흥', None, None, 'solid',
     '고체연료 미사일(KN-23 계열) 동체 조립 라인', '룡성 기계연합기업소 내부.'),
    ('평성 1.18 기계공장', 'pyongseong-118', 'factory', '평안남도 평성', None, None, 'common',
     '대형 이동식 발사대(TEL) 차대·특수구조물 제작', '신리 시설.'),
    ('함흥 2.8 비날론 연합기업소', 'hamhung-vinalon', 'chemical_plant', '함경남도 함흥', None, None, 'liquid',
     'UDMH 액체연료 배합·정밀화학원료 합성', '흥남 비날론 공장.'),
    ('순천화학공장', 'suncheon-chem', 'chemical_plant', '평안남도 순천', None, None, 'liquid',
     'UDMH 분산 생산', '액체연료 원료.'),
    ('청수화학공장', 'chongsu-chem', 'chemical_plant', '평안북도 청수', None, None, 'liquid',
     'UDMH 분산 생산', '액체연료 원료.'),
]

# observation.location_name 19개 → (정규 시설 canonical_name, alias_type)
OBS_LOCATION_MAP = {
    '동창리 서해위성발사장 - 발사대': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 서해위성발사장 - 발사대 및 추진제 저장동': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 서해위성발사장 - 수평조립건물 지원구역': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 모터 시험장': ('동창리 고체모터 시험장', 'official'),
    '동창리 발사장 일대': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 발사장 남측 능선 계측지': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 발사장 방향': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 남서 방면 방공지대': ('Sohae Satellite Launching Station', 'sub_area'),
    '동창리 발사 궤적 / 필리핀·일본 항로': ('Sohae Satellite Launching Station', 'sub_area'),
    '산음동 미사일 연구·생산단지 (평양 인근)': ('산음동 미사일 연구·생산단지', 'official'),
    '순안 비행장': ('Pyongyang International Airport', 'colloquial'),
    '신포 남조선소 잠수함 기지': ('Sinpo Shipyard', 'official'),
    '은하화학공장 (자강도 만포)': ('은하화학공장 (만포)', 'official'),
    '잠진 기계공장 수직 엔진시험대': ('잠진 기계공장/엔진시험장', 'sub_area'),
    '잠진 기계공장 엔진시험장 (남포 인근)': ('잠진 기계공장/엔진시험장', 'official'),
    '평양 룡성 지도부 전용역': ('평양 룡성 지도부 전용역', 'official'),
    '풍계리 핵실험장 - 남측 갱도/지휘소': ('풍계리 핵실험장', 'sub_area'),
    '풍계리 핵실험장 - 북측 갱도 근접': ('풍계리 핵실험장', 'sub_area'),
    '풍계리 핵실험장 - 북측/서측 갱도': ('풍계리 핵실험장', 'sub_area'),
}

# 한국어/영문/별칭 → (canonical_name, alias_type, source)
CURATED_ALIASES = [
    # launch sites (canonical=영문 launch_facility name)
    ('Sohae Satellite Launching Station', '서해위성발사장', 'colloquial', 'kr'),
    ('Sohae Satellite Launching Station', '동창리 발사장', 'colloquial', 'kr'),
    ('Sohae Satellite Launching Station', 'Tongchang-ri', 'english', 'en'),
    ('Sohae Satellite Launching Station', 'Sohe', 'english', 'en'),
    ('Pyongyang International Airport', '평양 국제공항', 'colloquial', 'kr'),
    ('Pyongyang International Airport', '순안', 'colloquial', 'kr'),
    ('Pyongyang International Airport', 'Sunam', 'english', 'en'),
    ('Sinpo Shipyard', '신포 남조선소', 'colloquial', 'kr'),
    ('Sinpo Shipyard', 'Sinpo', 'english', 'en'),
    ('Sinpo Shipyard', '고래 (Gorae, SLBM 테스트함)', 'colloquial', 'press'),
    ('Tonghae Satellite Launching Ground', '동해 위성발사장', 'colloquial', 'kr'),
    ('Tonghae Satellite Launching Ground', '무단봉', 'colloquial', 'kr'),
    # new facilities
    ('잠진 기계공장/엔진시험장', 'Chamjin', 'english', 'en'),
    ('잠진 기계공장/엔진시험장', '잠진 엔진시험장', 'colloquial', 'kr'),
    ('풍계리 핵실험장', 'Punggye-ri', 'english', 'en'),
    ('풍계리 핵실험장', '길주 핵실험장', 'colloquial', 'kr'),
    ('은하화학공장 (만포)', '만포 운하공장', 'colloquial', 'kr'),
    ('은하화학공장 (만포)', 'Manpo', 'english', 'en'),
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

    lines = ['-- AUTO-GENERATED by build_facility_ontology.py (gitignore). 재실행 멱등.', '']

    # 1) launch_facilities(49) → facilities (영문 canonical + launch_facility_id)
    lines.append('-- launch_facilities → facilities (launch site/airbase/naval)')
    lines.append("""insert into facilities (canonical_name, slug, facility_type, region, lat, lng, launch_facility_id)
select facility_name,
       trim(both '-' from lower(regexp_replace(facility_name, '[^A-Za-z0-9]+', '-', 'g'))),
       case when facility_name ilike '%airport%' or facility_name ilike '%airbase%' then 'airbase'
            when facility_name ilike '%shipyard%' then 'naval_base'
            when facility_name ilike '%unknown%' then 'other'
            else 'launch_site' end,
       region, lat, lng, facility_id
from launch_facilities
on conflict (canonical_name) do update
  set launch_facility_id = excluded.launch_facility_id, region = excluded.region,
      lat = excluded.lat, lng = excluded.lng;""")

    # launch_facilities 공식명 alias
    lines.append('\n-- launch_facilities 공식명 → facility_aliases(official)')
    lines.append("""insert into facility_aliases (facility_id, alias_text, alias_type, source)
select f.facility_id, lf.facility_name, 'official', 'CNS'
from launch_facilities lf join facilities f on f.canonical_name = lf.facility_name
on conflict (facility_id, alias_text, alias_type) do nothing;""")

    # 2) 큐레이션 추가 시설
    lines.append('\n-- 큐레이션 추가 시설 (엔진시험장/공장/화학공장/VIP/핵실험장)')
    for canon, slug, ftype, region, lat, lng, fuel, role, desc in NEW_FACILITIES:
        lines.append(
            "insert into facilities (canonical_name,slug,facility_type,region,lat,lng,fuel_type,role,description) values ("
            f"{qt(canon)},{qt(slug)},{qt(ftype)},{qt(region)},{qt(lat)},{qt(lng)},{qt(fuel)},{qt(role)},{qt(desc)}"
            ") on conflict (canonical_name) do update set slug=excluded.slug,facility_type=excluded.facility_type,"
            "fuel_type=excluded.fuel_type,role=excluded.role,description=excluded.description,"
            "lat=coalesce(excluded.lat,facilities.lat),lng=coalesce(excluded.lng,facilities.lng);")
        lines.append(
            "insert into facility_aliases (facility_id,alias_text,alias_type,source) values "
            f"((select facility_id from facilities where canonical_name={qt(canon)}),{qt(canon)},'official','curated') "
            "on conflict (facility_id,alias_text,alias_type) do nothing;")

    # 3) 큐레이션 별칭
    lines.append('\n-- 큐레이션 한국어/영문/별칭')
    for canon, alias, atype, src in CURATED_ALIASES:
        lines.append(
            "insert into facility_aliases (facility_id,alias_text,alias_type,source) values "
            f"((select facility_id from facilities where canonical_name={qt(canon)}),{qt(alias)},{qt(atype)},{qt(src)}) "
            "on conflict (facility_id,alias_text,alias_type) do nothing;")

    # 4) observation location_name 19개 매핑
    lines.append('\n-- observation.location_name → 정규 시설 매핑 (위치 매칭 테이블)')
    for loc_name, (canon, atype) in OBS_LOCATION_MAP.items():
        lines.append(
            "insert into facility_aliases (facility_id,alias_text,alias_type,source) values "
            f"((select facility_id from facilities where canonical_name={qt(canon)}),{qt(loc_name)},{qt(atype)},'observation') "
            "on conflict (facility_id,alias_text,alias_type) do nothing;")

    with open(SQL_OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'✅ facilities(49 launch + {len(NEW_FACILITIES)} curated), aliases(curated+{len(OBS_LOCATION_MAP)} obs)  → {os.path.relpath(SQL_OUT, WEB_UI)}')

    if args.no_apply:
        print('(--no-apply) 적재 생략'); return
    print('[apply] 원격 적재...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
                       cwd=WEB_UI, capture_output=True, text=True)
    print('✅ 적재 성공' if r.returncode == 0 else '❌ ' + (r.stderr or r.stdout))


if __name__ == '__main__':
    main()
