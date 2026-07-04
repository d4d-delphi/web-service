# Layer 1 스키마 명세 — `observation`

DELPHI 파이프라인의 원천 첩보 계층(Layer 1) 데이터 모델 명세.

---

## 1. Layer 1의 정의와 경계

**Layer 1 한 행 = 인간 판독관 1인이 감시 자산 1개에서 얻은, 하나의 액션 단위 관측 + 그 출처·신뢰도.**

이 정의에서 세 가지 경계가 나온다.

- **단일 자산, 단일 관측.** 한 위성영상 · 한 UAV 세션 · 한 판독병의 한 신호 식별 · 한 매체 보도. 여러 자산을 엮은 것은 Layer 1이 아니다.
- **확인되는 사실만.** 판독관은 판단·추론을 하지 않고, 관측으로 확인되는 사실만 보고한다. "무엇이 몇 개, 어떤 형태·치수·상태로 보이는가"까지가 Layer 1이다. "이것이 무슨 무기용인가 / 어느 가설을 지지하는가 / 무슨 의도인가"는 제외한다. (§7 판독관 보고 원칙)
- **원천 그대로, 정규화 이전.** 액션 클래스 분류, 단계(phase) 태깅, likelihood, 시나리오 소속 등은 이후 계층이 붙인다. Layer 1은 그 입력일 뿐이다.

모든 감시 자산을 단일 `observation` 테이블로 통합하고, 자산 종류는 `asset_type` 컬럼으로, 자산별 원천 필드는 `asset_detail` jsonb로 담는다. (소비 주체가 LLM이므로 jsonb 규약 기반이 적합.)

---

## 2. 테이블 DDL

```sql
create table observation (
  obs_id          uuid primary key default gen_random_uuid(),

  -- ── 관측 정체 ──
  asset_type      text not null
    check (asset_type in ('SATELLITE_IMINT','AERIAL_IMINT','SIGINT','UAV_FLIR','OSINT')),
  polarity        text not null default 'PRESENT'
    check (polarity in ('PRESENT','ABSENT')),      -- negative evidence
  collected_at    timestamptz not null,            -- 촬영/포착/보도 일시 (정본 시간축)

  -- ── 공간 ──
  mgrs            text,                             -- 대상 위치 (군사좌표)
  location_name   text,                             -- 판독관이 쓴 시설/지역명 (자유텍스트)

  -- ── 판독관이 본 것 (액션 단위 핵심) ──
  observed_objects jsonb not null default '[]',     -- [{type(자유텍스트, 중립), count}]
  activity_desc   text not null,                    -- 판독관 관측 사실 서술 (판단 제외)
  unusual_flag    boolean not null default false,   -- routine vs unusual

  -- ── 출처 · 신뢰도 (Provenance) ──
  platform        text not null,                    -- 자산명 (425위성, 헤론, RF-16, 노동신문)
  analyst_id      text,                             -- 판독관 ID (SIGINT raw는 null)
  analyst_unit    text,                             -- 소속 부대
  reliability     smallint not null                 -- 판독 신뢰 등급
    check (reliability between 1 and 5),

  -- ── 자산별 상세 (원천 필드) ──
  asset_detail    jsonb not null default '{}',

  -- ── 원본 참조 ──
  source_ref      text,                             -- 원 아티클 URL / 파일 포인터
  image_urls      jsonb not null default '[]',      -- [{url, caption, license}]
  created_at      timestamptz not null default now()
);

create index on observation (collected_at);
create index on observation (asset_type);
```

---

## 3. 필드 명세

| 필드 | 타입 | Null | 설명 |
|---|---|---|---|
| `obs_id` | uuid | no | PK, 자동생성 |
| `asset_type` | text (enum) | no | 감시 자산 종류. 5종 중 하나 |
| `polarity` | text (enum) | no | `PRESENT`=관측됨 / `ABSENT`=예상됐으나 부재(negative evidence). 기본 `PRESENT` |
| `collected_at` | timestamptz | no | 촬영·포착·보도 일시. **정본 시간축** (추론 엔진이 이 값으로 시계열 정렬) |
| `mgrs` | text | yes | 관측 대상 위치 (군사좌표참조체계) |
| `location_name` | text | yes | 판독관이 참조한 시설/지역명. 자유텍스트, 시설 마스터 FK 아님 |
| `observed_objects` | jsonb | no | `[{type, count}]`. `type`은 **중립 명칭**(형태·치수 기반, 용도 판별 금지). `ABSENT`이면 빈 배열 |
| `activity_desc` | text | no | 판독관이 **관측으로 확인한 사실만** 서술. 판별·추정·의도 금지. `ABSENT`이면 "무엇이 관측되지 않았는지" 사실 기술 |
| `unusual_flag` | boolean | no | 일상적(false) vs 특이(true). `polarity`와 직교하는 별개 축 |
| `platform` | text | no | 수집 자산/플랫폼 명칭 |
| `analyst_id` | text | yes | 판독관 ID. SIGINT 기계 원신호(`is_raw`)는 null |
| `analyst_unit` | text | yes | 판독관 소속 부대 |
| `reliability` | smallint | no | 판독 신뢰 등급 1~5 (기상·화질·각도 등 종합) |
| `asset_detail` | jsonb | no | 자산별 원천 필드. §4 규약 |
| `source_ref` | text | yes | 원 아티클 URL / 원본 파일 포인터 |
| `image_urls` | jsonb | no | `[{url, caption, license}]`. S3 업로드 또는 외부 참조 링크 |
| `created_at` | timestamptz | no | 레코드 생성 시각 (감사용) |

### 두 직교 축: `polarity` × `unusual_flag`

| | `PRESENT` | `ABSENT` |
|---|---|---|
| `unusual_flag=false` | 일상적 활동 관측 | 일상적 부재 (평소에도 없음) |
| `unusual_flag=true` | 특이 활동 관측 | **예상됐는데 부재** (진단적 negative evidence) |

---

## 4. `asset_detail` jsonb 규약

DB 제약은 걸리지 않으나 LLM이 읽는 규약이므로 명세로 고정한다.

### SATELLITE_IMINT / AERIAL_IMINT
```jsonc
{ "sensor_type": "EO",        // EO | SAR | IR
  "look_angle_deg": 23,
  "cloud_cover_pct": 10 }
```

### SIGINT  (`is_raw`로 원신호/판독 구분)
```jsonc
{ "is_raw": true,             // true=기계 원신호(analyst 없음), false=판독병 식별
  "frequency_band": "VHF",    // UHF | HF | VHF | X-Band | S-Band | L-Band
  "signal_params": { "PRI": 1050, "PW": 2.5, "Scan": "Circular" },  // 관측된 신호 파라미터
  "emitter_guess": "미상",     // 방출원 미식별 시 "미상". 단일 관측의 1차 형태 식별까지만
  "signal_strength": "Moderate",       // Weak | Moderate | High
  "ew_status": "Normal" }              // Normal | Jammed
```

### UAV_FLIR
```jsonc
{ "sensor_mode": "FLIR_WhiteHot",          // FLIR_WhiteHot | FLIR_BlackHot | EO_DayTV | IR_MidWave
  "platform_mgrs": "52S CG 1200 1200",     // 아군 UAV 체공 위치
  "slant_range_km": 42.5,
  "tracking_status": "Lock-on" }           // Searching | Lock-on | Lost
```

### OSINT  (매체 원문 사실까지만)
```jsonc
{ "source_media": "노동신문",
  "media_type": "Text",       // Text | Photo | Video
  "original_title": "...",
  "key_entities": ["김정은", "원산"] }
```

---

## 5. Layer 1 경계 — 명시적 제외 목록

아래 항목은 Layer 1에 **두지 않는다**. 이후 계층이 생성·부여한다.

| 항목 | 실제 소속 계층 | 이유 |
|---|---|---|
| 판별·의도 서술 (연료타입, 발사체 계열, "~용", "~정황") | Layer 2+ (추론) | 판독관은 사실만 보고. 판별은 방출표 기반 추론의 산물 |
| `emitter_identified`(확정), `integrated_sources` | Layer 2 (융합) | 다중 소스 융합 판단. Layer 1은 `emitter_guess`(단일 관측 형태 식별)까지만 |
| `action_class`, `phase_no`, `field_uncertainty` | Layer 2 (정형화) | 추출층이 관측을 정형 클래스로 변환한 산물 |
| `strategic_intent`, `dia_analytical_summary` | Layer 2+ (추론) | 의도·의미 추론 |
| `related_launch_seq`, 사례 매칭 | Layer 2+ (연관) | 과거 사례와의 매칭 결과 |
| `threat_level`, `launch_probability` | 추론 산출 | 베이지안 추론 결과 |
| `likelihood_map`, `prior_probability` | 사전지식 계층 | 방출표·사전 |
| `scenario_id` / 사건 소속 | 파이프라인 (데이터 연관) | 어느 사건에 속하는지는 트랙 게이팅이 추론. Layer 1에 태그하면 추론 우회(치팅) |
| 시설 마스터 FK | Layer 2 (지오코딩) | `location_name` 자유텍스트만 두고, 시설 매칭은 이후 |

---

## 6. 설계 결정 기록

확정된 결정과 근거.

1. **단일 테이블 + jsonb** (자산별 테이블 분리 안 함) — 소비 주체가 LLM이고, 자산별 테이블 분리는 "중구난방"으로 회귀할 위험.
2. **SIGINT 기계 원신호를 SIGINT 관측에 흡수** — 별도 테이블 대신 `asset_detail.is_raw` 플래그로 구분.
3. **`collected_at` 정본, `analyzed_at` 드랍** — 추론 시간축은 사건 발생 시각. 판독 완료 시각은 불필요.
4. **신뢰도 1축(`reliability`)** — Layer 1에서 판독관이 줄 수 있는 것은 판독 품질뿐. 소스신뢰도×내용확신도 2축 분리는 Layer 2에서.
5. **`observed_objects.type` 자유텍스트·중립** — 원천 보존. 형태·치수 기반 중립 명칭만, 용도 판별 금지. 정형 클래스 변환은 추출층 몫.
6. **negative evidence를 `polarity` enum으로** — "예상됐는데 부재"도 판독관이 실제로 보고하는 관측이므로 Layer 1에 포함.
7. **`scenario_id` 드랍** — 사건 소속은 파이프라인이 추론. Layer 1은 순수 관측만.
8. **판독관 보고 = 사실만 (군 장교 출신 팀원 피드백 반영)** — 실제 판독관 보고는 판단을 하지 않고 확인되는 사실만 기술한다. `activity_desc`·`observed_objects` 모두 이 원칙을 따른다. (§7)

---

## 7. 판독관 보고 원칙 (작성 규칙)

`activity_desc`와 `observed_objects` 작성 시 반드시 따른다. Layer 1의 무결성이 여기 달려 있다 — 판별이 원천 데이터에 섞이면 추론 엔진이 우회되고, 시스템이 "판독관이 이미 적어둔 답을 읽는" 것으로 전락한다.

### 써도 되는 것 (관측 사실)
- 객체의 **형태·치수·수량·색상·위치·상태**: "3m 연료통", "7m 유개트럭 8대", "대형 트레일러 2대", "상부 원통형 적재물"
- 시계열 **변화 사실**: "4일·6일 영상에는 미관측, 금일 출현", "제자리 확인"
- **미상 표기**: 식별 안 되면 "미상", "방출원 미식별"
- **부재 사실** (ABSENT): "타이어 자국·그을림 미관측"

### 쓰면 안 되는 것 (판단·추론)
- **용도·계열 판별**: "액체연료 발사체", "고체 시험대", "추진제 저장동", "SLV급"
- **행위 의도 추정**: "~하기 위해 이동", "주입 준비 정황", "재가동 관련 통신으로 추정"
- **가설 언급**: "ICBM 배제", "negative evidence", "발사 임박"
- **융합 판단**: "SA-2 Fan Song 확정" (단일 관측으로 확정 불가)

### 판별은 사라지는 게 아니라 이동한다
"추진제 저장동이 있으니 액체다"라는 판별은 **삭제**가 아니라 **추론 엔진(Layer 2+)으로 이관**된다. 판독관은 "건물 2동 + 차량 3대 활동"이라는 사실만 남기고, 방출표를 가진 추론 엔진이 그로부터 "액체 계열"을 도출한다. 이 분리가 시스템의 핵심 가치다.

---

## 8. 샘플 레코드

판독관 보고 원칙(§7)을 따른 예시. 모두 사실만 기술하고 판별을 배제한다.

### 예 1 — PRESENT, 특이 (발사대 활동)
```json
{
  "asset_type": "SATELLITE_IMINT",
  "polarity": "PRESENT",
  "collected_at": "2026-07-08T05:15:00Z",
  "mgrs": "51S XD 46261 91410",
  "location_name": "동창리 서해위성발사장 - 발사대 인접 건물군",
  "observed_objects": [
    {"type": "building", "count": 2},
    {"type": "vehicle", "count": 3}
  ],
  "activity_desc": "발사대 인접 건물 양측에서 인원·차량 활동 식별. 발사대 표면에 차량 3대 식별.",
  "unusual_flag": true,
  "platform": "DigitalGlobe",
  "analyst_id": "Analyst_A",
  "analyst_unit": "국방정보본부",
  "reliability": 4,
  "asset_detail": { "sensor_type": "EO", "look_angle_deg": 18, "cloud_cover_pct": 5 },
  "source_ref": "https://www.38north.org/2012/03/tongchang0329/",
  "image_urls": [
    {"url": "https://.../figure1-94.jpg", "caption": "동창리 발사대 - 건물 양측 활동 및 차량", "license": "DigitalGlobe / 38 North"}
  ]
}
```

### 예 2 — ABSENT, 특이 (예상 징후 부재 = negative evidence)
```json
{
  "asset_type": "SATELLITE_IMINT",
  "polarity": "ABSENT",
  "collected_at": "2026-03-24T02:30:00Z",
  "mgrs": "51S YD 11588 14896",
  "location_name": "잠진 기계공장 수직 엔진시험대",
  "observed_objects": [],
  "activity_desc": "수직 시험대 서비스타워 및 지지구조물 제자리 확인. 배기 편향판 및 진입로에 중차량 타이어 자국·그을림 미관측.",
  "unusual_flag": true,
  "platform": "DigitalGlobe",
  "analyst_id": "Analyst_A",
  "analyst_unit": "국방정보본부",
  "reliability": 4,
  "asset_detail": { "sensor_type": "EO", "look_angle_deg": 15, "cloud_cover_pct": 5 },
  "source_ref": "https://www.38north.org/2018/06/testsites061518/",
  "image_urls": []
}
```

### 예 3 — SIGINT 판독 (방출원 미식별)
```json
{
  "asset_type": "SIGINT",
  "polarity": "PRESENT",
  "collected_at": "2026-04-18T05:00:00Z",
  "mgrs": "52T BL 72762 59866",
  "location_name": "은하화학공장 (자강도 만포)",
  "observed_objects": [],
  "activity_desc": "은하화학공장 일대 VHF 대역 통신 교신 트래픽 급증 포착. 야간 시간대 지속. 방출원 미식별.",
  "unusual_flag": true,
  "platform": "777사령부 수집체계",
  "analyst_id": "SIGINT_Analyst_B",
  "analyst_unit": "777사령부",
  "reliability": 3,
  "asset_detail": {
    "is_raw": false,
    "frequency_band": "VHF",
    "signal_params": { "modulation": "FM", "traffic_level": "elevated" },
    "emitter_guess": "미상",
    "signal_strength": "Moderate",
    "ew_status": "Normal"
  },
  "source_ref": "synthetic: master-timeline S1",
  "image_urls": []
}
```

### 예 4 — OSINT (매체 원문 사실)
```json
{
  "asset_type": "OSINT",
  "polarity": "PRESENT",
  "collected_at": "2026-07-08T09:00:00Z",
  "mgrs": "51S XD 46261 91410",
  "location_name": "동창리 발사 궤적 / 필리핀·일본 항로",
  "observed_objects": [],
  "activity_desc": "북한 항행경보(NOTAM) 발행 확인. 1·2단 낙탄구역을 발사지 정남 480km·2500km 지점으로 명시. 발사창 및 남서 방향 궤적 통보.",
  "unusual_flag": true,
  "platform": "공개출처 (항행경보 NOTAM)",
  "analyst_id": "OSINT_Analyst_C",
  "analyst_unit": "정보사 공개정보단",
  "reliability": 5,
  "asset_detail": {
    "source_media": "항행경보 (NOTAM)",
    "media_type": "Text",
    "original_title": "NAVIGATIONAL WARNING - stage impact zones 480km/2500km south",
    "key_entities": ["낙탄구역 480km", "낙탄구역 2500km", "남서 궤적", "동창리"]
  },
  "source_ref": "https://www.astronautix.com/u/unha-3.html",
  "image_urls": []
}
```