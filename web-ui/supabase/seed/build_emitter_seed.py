#!/usr/bin/env python3
"""
build_emitter_seed.py
방출원(emitter) 온톨로지 — emitters + emitter_aliases 시드.
목적: SIGINT observation 의 generic emitter_guess("방공 감시레이더 계열"/"텔레메트리 송신 계열"/
      "야전 무전망"/"미상"...) 을 정규 방출원 엔티티로 해석.
원천(공개 OSINT, 비밀 아님): GlobalSecurity / CSIS / IHS Jane's 공개 / Wikipedia / ROK 국방백서.
  - 제원(대역/PRI/PW)은 공개 OSINT 범위의 illustrative stub. 실 운용 수치·체계연동이 아님.
  - threat_relevance: launch_indicator(발사 징후) / air_defense(방공) / background(배경) / comms(통신).
canonical+alias 패턴 계승(missiles/missile_aliases, friendly_units/friendly_unit_aliases).
alias_type=signal_pattern: observation 의 generic 묘사 → 정규 emitter 매칭 다리(1:N 가능).
데이터 → 원격 supabase 직접 적재. 산출(gitignore): emitter_seed.sql.
"""
import argparse, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_UI = os.path.abspath(os.path.join(HERE, '..', '..'))
SQL_OUT = os.path.join(HERE, 'emitter_seed.sql')

SRC_GS = ('GlobalSecurity / 공개 OSINT', 'https://www.globalsecurity.org')
SRC_CSIS = ('CSIS Missile Defense Project', 'https://missilethreat.csis.org')
SRC_OPEN = ('공개 OSINT(IHS Jane\'s 공개/Wikipedia)', 'https://en.wikipedia.org')

# (canonical_name, slug, designation, emitter_type, band, nato_name, associated_system,
#  platform, role, frequency_params{dict}, threat_relevance, source tuple, description,
#  aliases[(text,type)])  — source tuple = (ref,url)
EMITTERS = [
    # ── 발사 징후 (launch_indicator): 텔레메트리/추적 ──
    ('우주발사체 텔레메트리(S-Band PCM/FM)', 'slv-telemetry-sband-pcmfm',
     'SLV/LV 텔레메트리 송신기(S-Band, PCM/FM)', 'TELEMETRY', 'S-Band', None,
     '우주발사체/장거리 로켓(은하/화성-SLV)', '지상(발사대→추적국)', '발사체 비행 원격측정 텔레메트리 하향링크',
     {'modulation': 'PCM/FM', 'carrier_mhz': 2280, 'bandwidth_khz': 1500, 'pattern': 'continuous_stream'},
     'launch_indicator', SRC_OPEN,
     '발사체 비행중 실시간 상태(속도·자세·계기판) 송출 텔레메트리. PCM/FM 변조·S-Band 협대역 연속 방출이 '
     '부스트/비행 단계의 강력한 발사 징후. 동창리 SLV 발사 감시에서 핵심 SIGINT 지표.',
     [('텔레메트리 송신 계열', 'signal_pattern'), ('텔레메트리', 'korean'),
      ('PCM/FM', 'signal_pattern'), ('telemetry', 'english'),
      ('SLV telemetry', 'english'), ('텔레메트리 송신', 'signal_pattern')]),

    # ── 방공 (air_defense): 사격통제/탐색 레이더 ──
    ('Fan Song(사격통제, SA-2)', 'fan-song-sa2',
     'Fan Song 사격통제 레이더(SA-2/S-75)', 'FIRE_CONTROL', 'G-H', 'Fan Song',
     'SA-2(S-75 Dvina/Pegasus)', '지상(차량)', 'SA-2 지대공미사일 사격통제/유도',
     {'bands': ['G', 'H'], 'role': 'engage_guidance'},
     'air_defense', SRC_GS,
     'SA-2(S-75) 체계 사격통제/유도 레이더. DPRK가 SA-2(국명 Pegasus)를 운용. 방공뿐 아니라 '
     '공격측 항로 위협 평가에 활용.',
     [('Fan Song', 'nato'), ('SA-2 레이더', 'korean'), ('S-75 radar', 'english'),
      ('사격통제 레이더', 'signal_pattern'), ('사격통제', 'signal_pattern')]),

    ('Straight Flush(탐색/사격, SA-6)', 'straight-flush-sa6',
     'Straight Flush 획득/사격통제 레이더(SA-6/2K12 Kub)', 'SEARCH_FIRE', 'G-H', 'Straight Flush',
     'SA-6(2K12 Kub)', '지상(차량)', 'SA-6 표적 획득+사격통제(결합)',
     {'bands': ['G', 'H'], 'role': 'acquisition_fire_control'},
     'air_defense', SRC_GS,
     'SA-6(2K12 Kub) 자행식 방공체계의 획득/사격통제 결합 레이더. DPRK 운용. 기계식 스캔.',
     [('Straight Flush', 'nato'), ('SA-6 레이더', 'korean'), ('2K12 Kub radar', 'english'),
      ('획득 레이더', 'signal_pattern')]),

    ('Square Pair(사격통제, SA-5)', 'square-pair-sa5',
     'Square Pair 사격통제 레이더(SA-5/S-200)', 'FIRE_CONTROL', 'G-H', 'Square Pair',
     'SA-5(S-200 Angara/Vega)', '지상(고정/반고정)', 'SA-5 장거리 요격 유도',
     {'bands': ['G', 'H'], 'role': 'engage_guidance'},
     'air_defense', SRC_GS,
     'SA-5(S-200) 장거리 지대공미사일 사격통제 레이더. 고고도 장거리 위협.',
     [('Square Pair', 'nato'), ('SA-5 레이더', 'korean'), ('S-200 radar', 'english')]),

    ('Tin Shield(획득, SA-5)', 'tin-shield-sa5',
     'Tin Shield 획득 레이더(SA-5 체계 획득)', 'SEARCH', 'E-F', 'Tin Shield',
     'SA-5(S-200) 획득', '지상(고정)', 'SA-5 체계 장거리 표적 획득',
     {'bands': ['E', 'F'], 'role': 'early_acquisition'},
     'air_defense', SRC_GS,
     'SA-5 체계 장거리 획득 레이더. Square Pair 사격통제로 표적 인계.',
     [('Tin Shield', 'nato'), ('SA-5 획득 레이더', 'korean')]),

    ('Big Bird(탐색, SA-10/SA-20)', 'big-bird-s300',
     'Big Bird 획득/탐색 레이더(S-300/SA-10/SA-20 계열)', 'EARLY_WARNING', 'S-Band', 'Big Bird',
     'S-300/SA-10/SA-20(PMU/PMU2)', '지상(차량)', 'S-300 체계 장거리 획득/탐색',
     {'scan': 'mechanical', 'role': 'volume_search'},
     'air_defense', SRC_GS,
     'S-300(PMU/PMU2) 계열 획득/탐색 레이더. DPRK가 S-300 계열 획득 시도 보도. 기계식 원형스캔 S-Band 감시.',
     [('Big Bird', 'nato'), ('방공 감시레이더 계열', 'signal_pattern'),
      ('S-300 탐색 레이더', 'korean'), ('감시레이더', 'signal_pattern'),
      ('S-Band 감시', 'signal_pattern'), ('방공 감시레이더', 'signal_pattern')]),

    ('Flap Lid(사격통제, S-300)', 'flap-lid-s300',
     'Flap Lid 사격통제 레이더(S-300/SA-10)', 'FIRE_CONTROL', 'X', 'Flap Lid',
     'S-300/SA-10', '지상(차량)', 'S-300 체계 표적 추적/유도(전자주사)',
     {'scan': 'phased_array', 'role': 'engage_guidance'},
     'air_defense', SRC_GS,
     'S-300 체계 다기능 사격통제 레이더(전자주사). 획득(Big Bird)→추적/유도(Flap Lid) 체계연동.',
     [('Flap Lid', 'nato'), ('S-300 사격통제', 'korean'), ('Tomb Stone', 'nato')]),

    ('P-15/Spoon Rest(조기경보, VHF)', 'spoon-rest-vhf',
     'Spoon Rest(P-15) VHF 조기경보 레이더', 'EARLY_WARNING', 'VHF', 'Spoon Rest',
     'DPRK 방공 조기경보망', '지상(고정/이동)', '장거리 조기경보(2차원)',
     {'scan': 'mechanical', 'role': 'early_warning'},
     'air_defense', SRC_GS,
     'VHF 대역 장거리 조기경보 레이더. DPRK 방공망의 최전단 경보 자산. 저해상도이나 탐지거리 길다.',
     [('Spoon Rest', 'nato'), ('P-15', 'nato'), ('조기경보 레이더', 'signal_pattern'),
      ('VHF 조기경보', 'signal_pattern')]),

    ('Bar Lock(감시, VHF/E-band)', 'bar-lock-surveillance',
     'Bar Lock(P-35) 감시 레이더', 'SEARCH', 'VHF', 'Bar Lock',
     'DPRK 방공 감시', '지상(고정)', '공중 표적 감시/식별',
     {'scan': 'mechanical', 'role': 'surveillance'},
     'air_defense', SRC_GS,
     'VHF/E-band 기계식 감시 레이더. DPRK 방공 감시망 구성 요소.',
     [('Bar Lock', 'nato'), ('P-35', 'nato'), ('방공 감시레이더', 'signal_pattern')]),

    # ── 미식별 방출원(placeholder) ──
    ('미식별 추적/감시 방출원', 'unidentified-tracking-emitter',
     '미식별(Unidentified) 추적/감시 계열 방출원', 'UNKNOWN', 'S-Band', None,
     '미상(추적/감시 추정)', '지상(추정)', '미식별 방출원(추적/감시 가능성)',
     {'scan': 'unknown', 'role': 'unidentified'},
     'unknown', SRC_OPEN,
     'SIGINT에서 방출원 미식별("미상")인 케이스의 정규 placeholder. 신호 파라미터(PRI/PW/Scan) 누적 시 '
     '구체 emitter 로 재해석 필요. 단일 소스 신뢰도 낮음 — 교차검증(IMINT/UAV) 권고.',
     [('미상', 'signal_pattern'), ('방출원 미식별', 'signal_pattern'),
      ('Unidentified Tracking Radar', 'signal_pattern'),
      ('unidentified emitter', 'english')]),

    # ── 통신 (comms/background) ──
    ('야전 지휘통신망(UHF/VHF FM)', 'field-comms-uhf-vhf-fm',
     '야전 전술 무전망(UHF/VHF, FM 변조)', 'COMMS', 'UHF/VHF', None,
     '야전/전술 지휘통신', '지상(이동/야전)', '단속적 다중노드 지휘통신(교신 급증 지표)',
     {'modulation': 'FM', 'traffic_pattern': 'multi-node intermittent'},
     'comms', SRC_OPEN,
     '야전 전술 무전망. 복수 송수신 노드 간 단속 교신 패턴. 교신 급증(surge)은 부대 이동/전개 지표.'
     '발사 직전 통신 증가 징후와 연계 가능.',
     [('야전 무전망', 'signal_pattern'), ('야전 교신', 'signal_pattern'),
      ('전술 무전망', 'korean'), ('field comms', 'english'),
      ('VHF 교신', 'signal_pattern'), ('UHF 교신', 'signal_pattern'),
      ('VHF 급증', 'signal_pattern'), ('UHF 급증', 'signal_pattern'),
      ('교신 급증', 'signal_pattern'), ('무전 급증', 'signal_pattern')]),

    ('배경/산업 통신(VHF)', 'background-industrial-comms-vhf',
     '정형 배경/산업시설 통신망(VHF, FM)', 'COMMS', 'VHF', None,
     '민수/산업 배경 통신', '지상(고정)', '정형(루틴) 배경 통신',
     {'modulation': 'FM', 'traffic_pattern': 'nominal_elevated'},
     'background', SRC_OPEN,
     '정형 배경 통신(산업시설/민수 통신망). routine 수준 신호로 발사 징후와 직접 연관 낮음 — '
     'negative evidence(정상 배경)로 활용 가능.',
     [('정형 배경 통신', 'signal_pattern'), ('산업시설 통신망', 'signal_pattern'),
      ('배경 통신', 'signal_pattern'), ('background comms', 'english')]),

    ('지휘/데이터링크(전술)', 'tactical-datalink',
     '전술 데이터링크(지휘/체계연동)', 'DATALINK', 'UHF', None,
     '방공/지휘 체계연동', '지상/공중', '방공 자산·지휘소 간 전술 데이터링크',
     {'role': 'tactical_datalink'},
     'comms', SRC_OPEN,
     '방공 체계(탐색→사격통제)·지휘소 간 전술 데이터링크. 체계연동/교전 준비 지표.',
     [('데이터링크', 'korean'), ('datalink', 'english'), ('전술 데이터링크', 'korean')]),
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

    import json
    lines = ['-- AUTO-GENERATED by build_emitter_seed.py (gitignore). 공개 OSINT 기반 방출원 온톨로지.', '']

    # emitters
    lines.append('-- emitters')
    for e in EMITTERS:
        (cn, slug, des, etype, band, nato, system, plat, role, fparams, threat,
         (sref, surl), desc, _aliases) = e
        lines.append(
            "insert into emitters (canonical_name,slug,designation,emitter_type,band,nato_name,"
            "associated_system,platform,role,frequency_params,threat_relevance,source_ref,source_url,description) values ("
            f"{qt(cn)},{qt(slug)},{qt(des)},{qt(etype)},{qt(band)},{qt(nato)},"
            f"{qt(system)},{qt(plat)},{qt(role)},{qt(json.dumps(fparams, ensure_ascii=False))},"
            f"{qt(threat)},{qt(sref)},{qt(surl)},{qt(desc)}) "
            "on conflict (canonical_name) do update set "
            "designation=excluded.designation,emitter_type=excluded.emitter_type,band=excluded.band,"
            "nato_name=excluded.nato_name,associated_system=excluded.associated_system,"
            "platform=excluded.platform,role=excluded.role,frequency_params=excluded.frequency_params,"
            "threat_relevance=excluded.threat_relevance,source_ref=excluded.source_ref,"
            "source_url=excluded.source_url,description=excluded.description;")

    # emitter_aliases
    lines.append('\n-- emitter_aliases')
    for e in EMITTERS:
        cn = e[0]
        aliases = e[-1]
        asrc = e[11][0]  # source tuple 첫 번째 요소(source_ref)
        for atext, atype in aliases:
            lines.append(
                "insert into emitter_aliases (emitter_id,alias_text,alias_type,source) values "
                f"((select emitter_id from emitters where canonical_name={qt(cn)}),"
                f"{qt(atext)},{qt(atype)},{qt(asrc)}) "
                "on conflict (emitter_id,alias_text,alias_type) do nothing;")

    open(SQL_OUT, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    n = len(EMITTERS)
    na = sum(len(e[-1]) for e in EMITTERS)
    print(f'✅ emitters={n}, aliases={na} → {os.path.relpath(SQL_OUT, WEB_UI)}')

    if args.no_apply:
        print('(--no-apply) 적재 생략'); return
    print('[apply] 원격 적재...')
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '-f', os.path.relpath(SQL_OUT, WEB_UI)],
                       cwd=WEB_UI, capture_output=True, text=True)
    print('✅ 적재 성공' if r.returncode == 0 else '❌ ' + (r.stderr or r.stdout))


if __name__ == '__main__':
    main()
