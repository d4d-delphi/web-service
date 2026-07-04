# NL-COP 데이터 사전

## 문서 목적

이 문서는 다중 출처 융합 및 자연어 지휘통제(NL COP) 시스템, **DELPHI/NL-COP**의 데이터 기준을 정리한다. 해커톤 설계 노트(로컬 전용 기획 문서: 데이터셋 설계, 프로젝트 요약, 발사 징후 마스터 타임라인)에서 도출된 5대 원천 데이터셋과, 실제 `web-ui/src/types`, `web-ui/src/data`, `web-ui/src/lib`, `web-ui/src/app/api`에 이미 구현된 정형화·추론·보고·시각화 계층 스키마를 함께 다룬다.

- 원천 데이터셋(영상/신호/추적/과거사례/공개첩보) 설계는 기획 문서에서 시작해 `web-ui/src/types/index.ts`의 TypeScript interface와 `web-ui/src/data/*.json` 정적 데이터로 이미 반영되어 있다.
- 발사 징후 마스터 타임라인(시설별 준비 단계, Rule-Base 매칭)은 기획 문서에만 존재하고 아직 코드/데이터로 구현되지 않았다. 이 문서에서는 목표 설계로 별도 정리한다.
- 이 문서는 `docs/DATASET-SCHEMA.md`(5개 원천 데이터셋의 요약 스키마)를 대체하지 않고, 파이프라인 전 계층(원천 → 정형화 → 추론 → 보고 → 시각화)과 물리/논리 필드, 상태, 관계까지 확장한 상세판이다.

## 설계 기준

- 모든 시간 필드는 ISO 8601(`YYYY-MM-DDTHH:mm:ssZ`)을 기준으로 하고, 필요한 경우에만 사람이 읽기 쉬운 범위 문자열(`2026-07-04 08:15 ~ 08:42`)을 예외로 허용한다.
- 좌표는 위경도(`Coordinates`) 또는 **MGRS(군사좌표참조체계)** 문자열 중 하나를 기준으로 하며, 두 표현이 동시에 필요한 자산(추적자산 등)은 별도 필드로 분리한다.
- 신호(SIGINT)는 기계가 자동 수집하는 **Raw** 데이터와 사람(또는 AI)이 종합한 **Processed** 데이터를 반드시 분리한다. Raw에는 식별 주체(사람)가 들어가지 않는다.
- 모든 판독/분석 데이터에는 **출처 및 책임 소재(Provenance)** — 분석 주체(판독관/부대) 또는 시스템 신뢰도(SPUQ confidence) — 를 함께 저장한다.
- 과거 도발 사례(`Provocation`)와 아군 대응/BDA(`FriendlyAction`)는 관계형으로 분리하고 `yearly_launch_seq` / `related_launch_seq`로 연결한다. OSINT도 동일한 키로 도발 사례에 연결한다.
- 정형화 계층(`ActionClass`)은 원천 데이터(IMINT/SIGINT/UAV/OSINT)의 원본을 `sourceData`로 참조하면서 SPUQ 기반 불확실성(신뢰도)을 함께 보관해, 원본을 잃지 않고 추론 계층에 재사용한다.
- 추론 계층(`Hypothesis`/`InferenceResult`)은 사전확률(prior)과 우도표(likelihoodMap)를 정적 데이터(`hypotheses.json`)로 관리하고, 실행 결과(posterior/uncertainty)는 요청마다 계산되는 비영속 결과로 취급한다.
- 현재 원천 데이터는 정적 JSON(`web-ui/src/data/*.json`)으로 관리하고, Supabase(`web-ui/src/lib/supabase.ts`)는 클라이언트만 구성되어 있고 실제 벡터 검색/영속 테이블은 아직 연결되지 않았다. RAG(`searchSimilarCases`)는 로컬 키워드 유사도로 폴백 동작한다.
- 시설/표적 마스터와 Rule-Base 매칭 테이블처럼 아직 코드화되지 않은 목표 설계는 향후 Supabase 테이블 전환 대상으로 별도 표시한다.

## 상태 구분

| 상태 | 의미 |
| --- | --- |
| 구현됨 | `web-ui/src/types/index.ts`에 TypeScript interface로 정의되어 있고 `web-ui/src/data/*.json` 또는 `web-ui/src/lib`, `web-ui/src/app/api`에서 실제 사용 중이다. |
| 설계 문서만 존재 | 로컬 기획 문서(데이터셋 설계, 발사 징후 타임라인)에는 있으나 아직 코드/데이터로 옮겨지지 않았다. |
| 목표 설계 | 해커톤 데모 이후 프로덕션/Supabase 전환에 필요하므로 미리 데이터사전에 둔다. |
| 미래 확장 | 데모 범위 밖이며, 실제 벡터 DB 연동·시설 마스터 자동 갱신 등 후속 확장에서 다룬다. |

## 목차

1. 데이터 계층 개요
2. 영상자산 (IMINT)
3. 신호자산 (SIGINT — Raw / Processed)
4. 추적자산 (UAV/FLIR Telemetry)
5. 과거사례 (Historical Case / Provocation / Friendly Action)
6. 공개첩보 (OSINT)
7. 표적·아군 자산 마스터 (Threat / Friendly Asset)
8. 시설 마스터 및 발사 징후 이벤트 (목표 설계)
9. 정형화 계층 (SPUQ / Action Class)
10. 추론 계층 (Hypothesis / Inference Result)
11. 보고 계층 (Briefing Result / Evidence Trace)
12. 시나리오·시각화 계층 (Scenario / Phase / Timeline Event)
13. AI 추론 Rule-Base — 발사 원점 ↔ 궤적 매칭 (목표 설계)
14. Physical / Storage Design
15. 공통 Enum
16. 구현 우선순위

---

# 1. 데이터 계층 개요

> NL-COP은 "원천 수집 → 정형화 → 추론 → 보고 → 시각화"의 5단계 파이프라인으로 구성된다. 아래 표는 각 계층의 대표 스키마와 구현 위치를 요약한다.

| 계층 | 대표 스키마 | 구현 위치 | 상태 |
| --- | --- | --- | --- |
| 원천 수집 (Source) | `IMINTReport`, `SIGINTRaw`, `SIGINTProcessed`, `UAVTelemetry`, `OSINTReport`, `ProvocationCase`, `FriendlyActionCase` | `web-ui/src/types/index.ts`, `web-ui/src/data/*.json` | 구현됨 |
| 시설/표적 마스터 | `ThreatAsset`, `FriendlyAsset` | `web-ui/src/types/index.ts`, `web-ui/src/data/scenario-*.json` | 구현됨 |
| 시설 마스터(발사 징후) | 시설 마스터, 발사 징후 이벤트, Rule-Base | 로컬 기획 문서(발사 징후 마스터 타임라인) | 설계 문서만 존재 → 목표 설계 |
| 정형화 (Structuring) | `ActionClass`, `ActionClassType`, `SPUQResult` | `web-ui/src/types/index.ts`, `web-ui/src/lib/spuq.ts` | 구현됨 |
| 추론 (Inference) | `Hypothesis`, `HypothesisNode`, `InferenceResult` | `web-ui/src/types/index.ts`, `web-ui/src/lib/bayesian.ts`, `web-ui/src/data/hypotheses.json` | 구현됨 |
| 보고 (Reporting) | `BriefingResult`, `EvidenceTrace` | `web-ui/src/types/index.ts`, `web-ui/src/lib/claude.ts`, `web-ui/src/app/api/brief` | 구현됨 |
| 시각화 (Visualization) | `Scenario`, `ScenarioPhase`, `TimelineEvent`, `Coordinates` | `web-ui/src/types/index.ts`, `web-ui/src/data/scenario-a.json`, `web-ui/src/data/scenario-b.json` | 구현됨 |

---

# 2. 영상자산 (IMINT)

## `IMINTReport` (구현됨)

> 위성/항공기 영상에서 추출한 판독 결과다. `web-ui/src/types/index.ts`에 정의되어 있고, 현재는 독립 파일이 아니라 `scenario-a.json` / `scenario-b.json`의 `TimelineEvent.imintData`에 이벤트별로 내장되어 있다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `timestamp_captured` | 촬영 일시 | String (ISO 8601) | 영상 자산 촬영 일시 | Not Null |
| `timestamp_analyzed` | 판독 완료 일시 | String (ISO 8601) | 판독관 분석 완료 일시 | Not Null |
| `sensor_type` | 센서 종류 | Enum | `EO`(광학) / `SAR`(합성개구레이더) / `IR`(적외선) | Not Null |
| `source_platform` | 수집 플랫폼 | Text | 다목적실용위성(Arirang), 군사정찰위성(425위성), 상용위성 등 | Not Null |
| `MGRS_coordinate` | MGRS 좌표 | Text | 군사좌표참조체계 기준 위치, 예: `52S CG 9876 5432` | Not Null |
| `location_name` | 대상 지역/시설 명칭 | Text | 예: 원산 갈마 해안가, 동창리 서해위성발사장 | Not Null |
| `detected_objects` | 탐지 객체 및 수량 | Array `{type, count}` | 식별된 장비/차량/건물/인원 종류와 카운팅 | Not Null, 배열 |
| `unusual_activity_flag` | 특이 동향 여부 | Boolean | 일상적(Routine) 활동인지 특이(Unusual) 활동인지 | Not Null |
| `semantic_analysis` | 판독관 텍스트 분석 | Text | 활동의 군사적 목적/동향에 대한 자연어 서술 | Not Null |
| `confidence_level` | 영상 신뢰 등급 | Number (1~5) | 기상/구름 차폐율/촬영 각도를 종합한 판독 신뢰도 | Not Null |
| `analyst_name` | 판독관 이름 | Text | 예: 김판독 대위 | Not Null |
| `analyst_unit` | 판독관 소속 부대 | Text | 국방정보본부(정보사), 공군 항공정보단(AFIC) 등 | Not Null |

> 관계: 이 report는 별도 PK 없이 `TimelineEvent.imintData`에 1:1로 내장된다. 독립 데이터셋으로 승격 시 `imint_report_id`(UUID) PK와 `event_id`(FK)를 추가해야 한다(목표 설계).

---

# 3. 신호자산 (SIGINT — Raw / Processed)

## `SIGINTRaw` (구현됨)

> 체계(기계)가 자동 수집하는 원천 데이터다. 식별 주체(사람)가 없고 수초~수분 단위로 산발적으로 생성된다. `scenario-*.json`의 `TimelineEvent.sigintRaw` 배열에 내장된다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `timestamp` | 포착 순간(TOI) | String (ISO 8601) | Time of Intercept, 신호 포착 순간 | Not Null |
| `receiving_system` | 수집 체계/플랫폼 | Text | 예: `RF-16(청매)`, `777사령부 수집체계` | Not Null |
| `estimated_MGRS` | 추정 좌표 | Text | MGRS 또는 오차반경 포함 추정 위치 | Not Null |
| `frequency_band` | 주파수 대역 | Enum | `UHF` / `HF` / `VHF` / `X-Band` / `S-Band` / `L-Band` | Not Null |
| `signal_characteristics` | 신호 특성 | Object `{PRI?, PW?, Scan?}` | 펄스 반복 주기(PRI), 펄스 폭(PW), 스캔 패턴 등 | Optional 필드 포함 |
| `raw_emitter_guess` | 체계 1차 추정 방출원 | Text | 예: `Unidentified_Tracking_Radar` | Not Null |
| `signal_strength` | 신호 세기(SNR) | Enum | `Weak` / `Moderate` / `High` | Not Null |

## `SIGINTProcessed` (구현됨)

> 병사(수집/분석병) 또는 AI가 산발적인 Raw 데이터를 "누가, 언제부터 언제까지, 어디서, 무엇을 켰다"로 종합한 정형 데이터다. `TimelineEvent.sigintData`에 내장된다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `time_start` | 가동 시작 시간 | String (ISO 8601) | 신호원 가동 시작 시각 | Not Null |
| `time_end` | 가동 종료 시간 | String (ISO 8601) | 신호원 가동 종료 시각 | Not Null |
| `facility_name` | 신호 발생 기지/지역명 | Text | 예: 원산 방공기지, 마양도 잠수함기지 | Not Null |
| `emitter_identified` | 확정 식별 장비명 | Text | 예: `SA-2 표적추적레이더(Fan Song)` | Not Null |
| `integrated_sources` | 융합 사용 출처 | Array\<Text\> | 예: `["RF-16", "777사령부"]` | Not Null, 배열 |
| `human_summary` | 병사 작성 텍스트 요약 | Text | 예: "14:10~14:45 원산 방공기지 SA-2 표적레이더 가동 식별됨." | Not Null |
| `ew_environment` | 전자전 환경 | Enum | `Normal`(정상 수집) / `Jammed`(교란) | Not Null |

> **AI 자동 가공 포인트:** 국지도발(전시) 상황에서 Raw 데이터가 폭주해 병사의 가공이 지연될 경우, AI가 `estimated_MGRS`와 `frequency_band`/`signal_characteristics`를 실시간 군집화하여 `human_summary`를 자동 생성하는 것을 데모 킬러 기능으로 설계한다(현재 `web-ui/src/lib`에 자동 군집화 로직은 미구현, 목표 설계).

---

# 4. 추적자산 (UAV/FLIR Telemetry)

## `UAVTelemetry` (구현됨)

> 무인기(헤론, MQ-9)가 초 단위로 송신하는 상태/지향점(Telemetry) 스트리밍 데이터다. 영상 픽셀 자체가 아니라 좌표/추적 상태 메타데이터다. `TimelineEvent.uavData`에 내장된다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `timestamp` | 수신 시간 | String (ISO 8601) | 스트리밍 수신 시각 | Not Null |
| `task_id` | 임무 번호 | Text | 예: `TASK-202607-ISR-01` | Not Null |
| `asset_name` | 추적 플랫폼 명칭 | Text | `Heron`(헤론), `MQ-9` | Not Null |
| `sensor_mode` | 센서 구동 모드 | Enum | `FLIR_WhiteHot` / `FLIR_BlackHot` / `EO_DayTV` / `IR_MidWave` | Not Null |
| `platform_MGRS` | 아군(플랫폼) 위치 | Text | 무인기의 현재 체공 좌표(MGRS) | Not Null |
| `crosshair_MGRS` | 표적(에임) 위치 | Text | 카메라 십자선이 꽂힌 지상 좌표(MGRS) | Not Null |
| `slant_range_km` | 경사 거리 | Number (km) | 무인기~표적 간 경사(직선) 거리 | Not Null |
| `tracking_status` | 추적 상태 | Enum | `Searching`(탐색) / `Lock-on`(추적) / `Lost`(추적 소실) | Not Null |
| `linked_target_id` | 추적 표적 ID | Text | 에임이 가리키는 표적의 고유 ID, 예: `SA2_Site_01` | Not Null, `ThreatAsset.id`와 논리적 연결 |

---

# 5. 과거사례 (Historical Case / Provocation / Friendly Action)

## `ProvocationCase` (구현됨)

> 미사일 도발 사례 원장이다. `yearly_launch_seq`를 키로 영상/신호 징후 배열을 함께 보관한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `yearly_launch_seq` | 연도별 발사 순번 | Text | **[Key]** 해당 연도 n번째 발사, 예: `2026-04` | Unique, Not Null |
| `launch_time` | 발사 일시 | Text | 단발: `2026-07-04 08:15`, 다발: `2026-07-04 08:15 ~ 08:42` | Not Null |
| `launch_count` | 발사 발수 | Number | 발사한 미사일 수 | Not Null |
| `weapon_class` | 무기체계 분류 | Enum | `SRBM` / `MRBM` / `IRBM` / `ICBM` / `SLBM` / `CM` / `HGV` | Not Null |
| `kn_designation` | 한미 연합 식별 번호 | Text | 예: `KN-23` | Not Null |
| `visual_indicators` | 영상 징후 배열 | Array `{date, time, location, activity}` | 발사 전 위성/영상으로 포착된 징후 타임라인 | Not Null, 배열 |
| `signal_indicators` | 신호 징후 배열 | Array `{date, time, location, activity}` | 발사 전 신호(SIGINT)로 포착된 징후 타임라인 | Not Null, 배열 |

## `FriendlyActionCase` (구현됨)

> 도발 사례와 분리하여, 아군의 표적 처리/대응/BDA를 관계형으로 연결한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `related_launch_seq` | 매칭 도발 순번 | Text | **[FK]** `ProvocationCase.yearly_launch_seq` 참조 | Not Null, FK |
| `targeting_process` | 표적 처리 과정 | Text | 감시/추적 자산 운용, 표적 융합 경과 | Not Null |
| `response_action` | 아군 대응 행동 | Text | 무력시위/요격/타격 내용 | Not Null |
| `bda_result` | 전투피해평가 결과 | Text | 타격/대응 이후 사후 분석 결과 | Not Null |

## `HistoricalCase` (구현됨 — Legacy/RAG 호환)

> `web-ui/src/data/historical-cases.json`의 실제 저장 단위다. RAG 검색(`searchSimilarCases`) 호환을 위한 평면 요약 필드에 `provocation`/`friendlyAction` 중첩 객체를 함께 보관한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 사례 ID | Text | 예: `case-2026-04` | PK, Not Null |
| `date` | 사례 일자 | Text | 발생 일자 | Not Null |
| `title` | 사례 제목 | Text | 예: "KN-23 SRBM 2발 발사 (원산 갈마)" | Not Null |
| `missileType` | 무기체계 표기 | Text | 예: "SRBM (KN-23)" | Not Null |
| `indicators` | 징후 키워드 배열 | Array\<Text\> | RAG 키워드 유사도 계산에 사용 | Not Null, 배열 |
| `outcome` | 결과 요약 | Text | 발사/대응 결과 한 줄 요약 | Not Null |
| `description` | 상세 설명 | Text | 사례 전체 서술 | Not Null |
| `similarity` | 유사도 점수 | Number (0~1) | 질의 시점에 계산되는 RAG 유사도 | Optional, 비영속(런타임 계산값) |
| `provocation` | 도발 사례 상세 | `ProvocationCase` | 영상/신호 징후 타임라인 포함 중첩 객체 | Optional |
| `friendlyAction` | 아군 대응 상세 | `FriendlyActionCase` | 표적처리/대응/BDA 중첩 객체 | Optional |

> 관계: `provocation.yearly_launch_seq` ⇔ `friendlyAction.related_launch_seq` ⇔ `OSINTReport.related_launch_seq`가 동일한 발사 순번으로 묶인다.

---

# 6. 공개첩보 (OSINT)

## `OSINTReport` (구현됨)

> 북한 선전매체 원문(과장/선전 포함)을 정보사 공개정보단이 군사적 팩트로 필터링·요약한 결과다. `web-ui/src/data/osint.json`에 저장된다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `osint_id` | OSINT 보고서 고유 번호 | Text | 예: `OSINT-20260705-01` | PK, Not Null |
| `published_time` | 매체 최초 보도 일시 | String (ISO 8601) | 북한 매체 보도 시각 | Not Null |
| `processed_time` | 분석/전파 일시 | String (ISO 8601) | 정보사 분석 완료 시각 | Not Null |
| `source_media` | 출처 매체 | Text | 노동신문, 조선중앙통신(KCNA), 조선중앙TV 등 | Not Null |
| `media_type` | 보도 형태 | Enum(느슨) | `Text` / `Photo` / `Video` (실 데이터에는 `Text & Photo` 등 복합값 존재) | Not Null |
| `original_title` | 매체 원문 제목 | Text | 북한 매체 원문 그대로 | Not Null |
| `key_entities` | 주요 인물/장비/장소 | Array\<Text\> | 예: `["김정은", "신형전술유도무기", "원산"]` | Not Null, 배열 |
| `dia_analytical_summary` | 정보사 팩트 요약 | Text | **[핵심]** 선전 문구를 제거한 군사적 사실 요약 | Not Null |
| `strategic_intent` | 전략적 의도 분석 | Text | 대내 결속, 무력 시위, 경고 메시지 등 분석 | Not Null |
| `related_launch_seq` | 매칭 도발 순번 | Text | **[FK]** `ProvocationCase.yearly_launch_seq` 참조 | Not Null, FK |

---

# 7. 표적·아군 자산 마스터 (Threat / Friendly Asset)

## `ThreatAsset` (구현됨)

> 지도(Cesium) 시각화에 표출되는 적 자산이다. `web-ui/src/data/scenario-a.json` / `scenario-b.json`의 `threats` 배열에 저장된다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 자산 ID | Text | 예: `t-sam-kaesong` | PK, Not Null |
| `name` | 자산 명칭 | Text | 예: "개성 SA-2 기지" | Not Null |
| `type` | 자산 유형 | Enum | `SAM` / `TEL` / `RADAR` / `MISSILE_BASE` / `COMMAND` | Not Null |
| `position` | 위치 | `Coordinates {lat, lng, alt?}` | 지도 표출 좌표 | Not Null |
| `status` | 상태 | Enum | `active` / `destroyed` / `relocating` / `unknown` | Not Null |
| `threatRadius` | 위협 반경(km) | Number | SAM 사거리 등 위협망 반경 표출용 | Optional |
| `details` | 상세 설명 | Text | 예: "SA-2 Guideline, Fan Song 레이더" | Optional |

## `FriendlyAsset` (구현됨)

> 아군 대응 자산이다. `scenario-*.json`의 `friendlies` 배열에 저장된다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 자산 ID | Text | 예: `f-f15k-1` | PK, Not Null |
| `name` | 자산 명칭 | Text | 예: "F-15K 편대" | Not Null |
| `type` | 자산 유형 | Enum | `MISSILE` / `FIGHTER` / `ISR` / `SHIP` / `COMMAND` / `UAV` | Not Null |
| `position` | 위치 | `Coordinates {lat, lng, alt?}` | 지도 표출 좌표 | Not Null |
| `status` | 상태 | Enum | `ready` / `engaged` / `returning` / `standby` | Not Null |
| `capability` | 능력/무장 | Text | 예: "AGM-84H(슬램이알) 공대지 미사일" | Optional |
| `details` | 상세 설명 | Text | 부가 설명 | Optional |

> 관계: `UAVTelemetry.linked_target_id`는 `ThreatAsset.id`를 논리적으로 참조한다(코드상 강제 FK 아님, 목표 설계에서 명시적 FK로 승격 권장).

---

# 8. 시설 마스터 및 발사 징후 이벤트 (목표 설계)

> 발사 징후 마스터 타임라인(로컬 기획 문서)에서 다룬 "시설별 사전 준비 단계"를 정규화한 목표 스키마다. 현재는 `ProvocationCase.visual_indicators` / `signal_indicators`에 문자열로만 녹아 있고, 별도 테이블로 분리되어 있지 않다.

## `facilities` (목표 설계)

> 잠진 기계공장, 만포 은하화학공장, 함흥 제17호 공장 등 발사 준비와 연관된 시설 원장. 시설별 연료 유형·역할을 정규화해 AI가 "어떤 공장의 가동률 증가가 무엇을 의미하는지" 규칙적으로 추론하게 한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `facility_id` | 시설 ID | UUID | 시설 row 식별자 | PK, Not Null |
| `facility_name` | 시설 명칭 | Text | 예: "자강도 만포 은하화학공장", "함흥 제17호 공장" | Not Null |
| `region` | 지역 | Text | 예: "자강도 만포", "함경남도 함흥" | Not Null |
| `fuel_type` | 연료 유형 | Enum | `liquid`(액체) / `solid`(고체) / `common`(공통) | Not Null |
| `facility_role` | 시설 역할 | Text | 산화제/추진제 생산, 동체 조립, TEL 차대 제작, 엔진 시험 등 | Not Null |
| `related_weapon_class` | 연관 무기체계 | Text | 예: `KN-23`, `IRBM/ICBM` | Nullable |
| `first_observed_phase` | 최초 관측 단계 | Enum | `pre_phase` / `phase1` ~ `phase4` (§13 Enum 참고) | Not Null |
| `notes` | 비고 | Text | 위장/기만 여부 등 추가 메모 | Nullable |

## `launch_indicator_events` (목표 설계)

> 발사 징후 마스터 타임라인의 Phase 1~6 이벤트를 개별 row로 정규화한 테이블이다. `ProvocationCase.visual_indicators`/`signal_indicators` 배열을 대체하거나 이를 채우는 원천으로 사용할 수 있다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `event_id` | 이벤트 ID | UUID | 징후 이벤트 row 식별자 | PK |
| `related_launch_seq` | 매칭 도발 순번 | Text | `ProvocationCase.yearly_launch_seq` 참조 | FK, Nullable(사전 단계는 미확정 가능) |
| `facility_id` | 관련 시설 ID | UUID | `facilities.facility_id` 참조 | FK, Nullable |
| `phase` | 단계 | Enum | `pre_phase`, `phase1_fuel_prep`, `phase2_movement`, `phase3_vip`, `phase4_imminent`, `phase5_custody`, `phase6_osint_verify` | Not Null |
| `indicator_type` | 징후 유형 | Enum | `visual`(영상) / `signal`(신호) / `vip`(VIP 동향) / `osint`(공개출처) | Not Null |
| `event_time` | 이벤트 일시 | String (ISO 8601) | 징후 관측 시각 | Not Null |
| `location_name` | 위치 명칭 | Text | 예: "신포 일대", "동창리 발사장 인근 해상" | Not Null |
| `activity` | 활동 내용 | Text | 예: "김정은 전용열차 사라짐", "바지선 해안가 이동" | Not Null |
| `launch_probability_estimate` | 발사 확률 추정치 | Number (0~1) | 해당 단계까지 누적된 발사 확률(예: Phase2 = 0.5) | Nullable |

> 참고(발사 확률 참고값 — 마스터 타임라인 기준): Phase1 30% → Phase2 50% → Phase3 70% → Phase4 95~100%.

---

# 9. 정형화 계층 (SPUQ / Action Class)

## `ActionClass` (구현됨)

> 원천 데이터(비정형 판독 보고 포함)를 표준 액션 클래스로 정형화한 결과다. `web-ui/src/lib/spuq.ts`의 `structureReport`가 생성하고, `web-ui/src/app/api/infer`, `web-ui/src/app/api/brief`에서 소비한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 액션 ID | Text | 액션 클래스 고유 식별자 | PK, Not Null |
| `classType` | 액션 클래스 유형 | Enum(`ActionClassType`) | `IMINT`/`HUMINT`/`SIGINT`/`GEOINT`/`OSINT`/`MASINT`/`CYBINT`/`WXINT`/`UAV` | Not Null |
| `timestamp` | 발생 시각 | String (ISO 8601) | 원본 이벤트/보고 시각 | Not Null |
| `source` | 출처 | Text | 원본 보고 출처(부대/체계) | Not Null |
| `rawReport` | 원본 텍스트 | Text | 정형화 이전 원문 보고 | Not Null |
| `confidence` | 분류 확신도 | Number (0~1) | SPUQ 기반 클래스 분류 확신도 | Not Null |
| `fieldUncertainty` | 필드별 불확실성 | `Record<string, number>` | 필드 단위 불확실성 맵 | Not Null |
| `analystConfidence` | 판독관 원 확신도 | Number (0~1) | 사람이 부여한 원래 확신도 | Not Null |
| `fields` | 정형화된 필드 | `Record<string, any>` | 추출된 키-값(예: `object:TEL`, `activity:연료주입`) | Not Null |
| `sourceData` | 원본 데이터 참조 | `IMINTReport \| SIGINTRaw \| SIGINTProcessed \| UAVTelemetry \| OSINTReport` | 정형화 이전 원본 레코드 | Optional |
| `scenarioId` | 시나리오 ID | Text | `scenario-a` / `scenario-b` | Optional |
| `phaseId` | 시나리오 단계 ID | Number | `ScenarioPhase.id` 참조 | Optional |

## `SPUQResult` (구현됨)

> Sampling-based Predictive Uncertainty Quantification. 동일 입력을 N회 샘플링해 클래스 분류의 불확실성을 정량화한 런타임 결과다(영속 저장하지 않음).

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `classDistribution` | 클래스 분포 | `Record<ActionClassType, number>` | 각 클래스로 분류된 샘플 비율 | Not Null |
| `selectedClass` | 최종 선택 클래스 | Enum(`ActionClassType`) | 최다 투표 클래스 | Not Null |
| `classConfidence` | 클래스 확신도 | Number (0~1) | 최다 투표 비율 | Not Null |
| `fieldResults` | 필드별 결과 | `Record<string, {value, uncertainty, samples}>` | 필드별 샘플링 값/불확실성/샘플 목록 | Not Null |
| `numSamples` | 샘플링 횟수 | Number | 기본 10회 | Not Null |

---

# 10. 추론 계층 (Hypothesis / Inference Result)

## `Hypothesis` (구현됨)

> 베이지안 추론의 사전 지식(가설 DB)이다. `web-ui/src/data/hypotheses.json`에 정적으로 저장되고 `web-ui/src/lib/bayesian.ts`가 소비한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 가설 ID | Text | 예: `h-liquid-long` | PK, Not Null |
| `name` | 가설 명칭 | Text | 예: "액체연료 장거리 미사일 발사" | Not Null |
| `category` | 가설 카테고리 | Text | 예: `missile_launch` | Not Null |
| `subHypotheses` | 하위 가설 | Array\<`Hypothesis`\> | 계층형 가설 트리 구성 | Optional |
| `priorProbability` | 사전 확률 | Number (0~1) | 베이지안 추론의 prior | Not Null |
| `likelihoodMap` | 우도표 | `Record<string, number>` | 증거 키(`object:TEL`, `activity:연료주입` 등)별 우도 | Not Null |
| `description` | 설명 | Text | 가설 상세 설명 | Not Null |

## `HypothesisNode` (구현됨 — 추론 실행 결과)

> `runInference` 실행 시 계산되는 사후확률 트리 노드다(비영속, 요청마다 재계산).

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 가설 ID | Text | `Hypothesis.id`와 매칭 | Not Null |
| `name` | 가설 명칭 | Text | 표시용 명칭 | Not Null |
| `category` | 카테고리 | Text | 가설 분류 | Not Null |
| `prior` | 사전 확률 | Number (0~1) | 추론 이전 확률 | Not Null |
| `posterior` | 사후 확률 | Number (0~1) | 증거 반영 이후 확률 | Not Null |
| `uncertainty` | 불확실성 | Number (0~1) | 사후확률의 불확실성 | Not Null |
| `evidenceChain` | 증거 체인 | Array\<Text\> | 사후확률에 기여한 증거 키 목록 | Not Null, 배열 |
| `children` | 하위 노드 | Array\<`HypothesisNode`\> | 하위 가설 결과 트리 | Optional |

## `InferenceResult` (구현됨)

> `runInference`의 최종 반환값이며 `web-ui/src/app/api/infer`, `web-ui/src/app/api/brief`가 그대로 응답에 포함한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `hypotheses` | 가설 목록 | Array\<`HypothesisNode`\> | 사후확률 순 정렬된 가설 트리 | Not Null |
| `topHypothesis` | 최상위 가설 | `HypothesisNode \| null` | 사후확률 최고 가설 | Nullable |
| `overallConfidence` | 종합 신뢰도 | Number (0~1) | 추론 결과 전체 신뢰도 | Not Null |
| `updatedAt` | 갱신 시각 | String (ISO 8601) | 추론 실행 시각 | Not Null |
| `evidenceCount` | 증거 수 | Number | 추론에 사용된 `ActionClass` 개수 | Not Null |

---

# 11. 보고 계층 (Briefing Result / Evidence Trace)

## `BriefingResult` (구현됨)

> 대형 LLM(Claude) 또는 추론 엔진 폴백으로 생성되는 지휘관용 종합 브리핑이다. `web-ui/src/app/api/brief`가 반환한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `summary` | 요약 | Text | 브리핑 핵심 요약 | Not Null |
| `threatAssessment` | 위협 평가 | Text | 상위 가설 기반 위협 평가 문구 | Not Null |
| `confidence` | 신뢰도 | Number (0~100) | 브리핑 신뢰도(%) | Not Null |
| `recommendations` | 건의 사항 | Array\<Text\> | 지휘 결심 건의 목록 | Not Null, 배열 |
| `historicalCases` | 유사 과거 사례 | Array\<`HistoricalCase`\> | RAG로 검색된 유사 사례 목록 | Not Null, 배열 |
| `launchProbability` | 발사 확률 | Number (0~100) | `missile_launch` 카테고리 최고 가설의 사후확률(%) | Optional |
| `inferenceResult` | 추론 결과 | `InferenceResult` | 추론 계층 결과 원본 첨부 | Optional |
| `evidenceTrace` | 증거 추적 | Array\<`EvidenceTrace`\> | 결론에 기여한 증거별 가중치 | Optional |

## `EvidenceTrace` (구현됨)

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `actionId` | 액션 ID | Text | `ActionClass.id` 참조 | FK, Not Null |
| `actionClass` | 액션 클래스 유형 | Enum(`ActionClassType`) | 증거의 출처 클래스 | Not Null |
| `contribution` | 기여 내용 | Text | 해당 증거가 결론에 기여한 내용 서술 | Not Null |
| `weight` | 가중치 | Number | 결론 기여 가중치 | Not Null |

---

# 12. 시나리오·시각화 계층 (Scenario / Phase / Timeline Event)

## `Coordinates` (구현됨)

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `lat` | 위도 | Number | 위도 값 | Not Null |
| `lng` | 경도 | Number | 경도 값 | Not Null |
| `alt` | 고도(m) | Number | Cesium 카메라/자산 고도 | Optional |

## `TimelineEvent` (구현됨)

> Cesium 지도/타임라인 UI에 표출되는 이벤트 단위. 원천 데이터셋(IMINT/SIGINT/UAV/OSINT)을 이벤트에 내장해 시각화와 원본 데이터를 함께 제공한다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 이벤트 ID | Text | 이벤트 고유 식별자 | PK, Not Null |
| `time` | 표시 시각 | Text | UI 표시용 시각 문자열 | Not Null |
| `timestamp` | 경과 초 | Number | 시나리오 시작 대비 경과 초(재생 타임라인 기준) | Not Null |
| `title` | 제목 | Text | 이벤트 제목 | Not Null |
| `description` | 설명 | Text | 이벤트 상세 설명 | Not Null |
| `type` | 이벤트 유형 | Enum | `intel` / `movement` / `launch` / `strike` / `bda` / `alert` | Not Null |
| `relatedAssets` | 관련 자산 ID | Array\<Text\> | `ThreatAsset.id` / `FriendlyAsset.id` 참조 | Optional, 배열 |
| `threatLevel` | 위협 수준 | Number | 이벤트 시점 위협 수준 스코어 | Optional |
| `actionClass` | 액션 클래스 유형 | Enum(`ActionClassType`) | 정형화 계층 연동용 클래스 | Optional |
| `actionId` | 액션 ID | Text | `ActionClass.id` 참조 | Optional, FK |
| `imintData` | 영상 원본 | `IMINTReport` | 내장된 영상 원본 데이터 | Optional |
| `sigintData` | 신호 가공 원본 | `SIGINTProcessed` | 내장된 신호 가공 데이터 | Optional |
| `sigintRaw` | 신호 원시 원본 | Array\<`SIGINTRaw`\> | 내장된 신호 Raw 데이터 목록 | Optional, 배열 |
| `uavData` | 추적 원본 | `UAVTelemetry` | 내장된 UAV 텔레메트리 데이터 | Optional |
| `osintData` | 공개첩보 원본 | `OSINTReport` | 내장된 OSINT 데이터 | Optional |

## `ScenarioPhase` (구현됨)

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 단계 ID | Number | 시나리오 내 단계 순번 | PK, Not Null |
| `name` | 단계명 | Text | 예: "발사 준비", "타격 및 BDA" | Not Null |
| `startTime` | 시작 초 | Number | 시나리오 재생 기준 시작 시각(초) | Not Null |
| `endTime` | 종료 초 | Number | 시나리오 재생 기준 종료 시각(초) | Not Null |
| `description` | 설명 | Text | 단계 설명 | Not Null |
| `cameraTarget` | 카메라 타겟 | `Coordinates & {range?}` | 해당 단계에서 카메라가 포커스할 좌표/거리 | Optional |
| `threatUpdates` | 위협 자산 갱신 | Array\<`Partial<ThreatAsset>`\> | 단계 진입 시 반영할 위협 자산 변경분 | Optional, 배열 |
| `friendlyUpdates` | 아군 자산 갱신 | Array\<`Partial<FriendlyAsset>`\> | 단계 진입 시 반영할 아군 자산 변경분 | Optional, 배열 |

## `Scenario` (구현됨)

> `web-ui/src/data/scenario-a.json`(평시: 발사 징후 탐지), `scenario-b.json`(전시: SEAD/BDA)의 최상위 컨테이너다.

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `id` | 시나리오 ID | Enum(`ScenarioId`) | `scenario-a` / `scenario-b` | PK, Not Null |
| `name` | 시나리오명 | Text | 예: "탄도미사일 발사 징후 포착" | Not Null |
| `description` | 설명 | Text | 시나리오 개요 | Not Null |
| `startTime` | 시작 시각 | String (ISO 8601) | 시나리오 시작 시각 | Not Null |
| `duration` | 재생 시간(초) | Number | 전체 재생 길이 | Not Null |
| `cameraPosition` | 초기 카메라 위치 | `Coordinates & {heading?, pitch?, range?}` | Cesium 초기 카메라 설정 | Not Null |
| `threats` | 위협 자산 목록 | Array\<`ThreatAsset`\> | 시나리오 내 적 자산 | Not Null, 배열 |
| `friendlies` | 아군 자산 목록 | Array\<`FriendlyAsset`\> | 시나리오 내 아군 자산 | Not Null, 배열 |
| `timeline` | 타임라인 이벤트 목록 | Array\<`TimelineEvent`\> | 시간순 이벤트 목록 | Not Null, 배열 |
| `phases` | 단계 목록 | Array\<`ScenarioPhase`\> | 시나리오 단계 구성 | Not Null, 배열 |

---

# 13. AI 추론 Rule-Base — 발사 원점 ↔ 궤적 매칭 (목표 설계)

> 발사 징후 마스터 타임라인 문서의 "AI 추론용 Rule-Base" 절을 정규화한 목표 스키마다. `Hypothesis.likelihoodMap`이 통계적 우도 기반이라면, 이 테이블은 결정론적 규칙(if-then) 기반 보조 판정 테이블로 별도 관리한다.

## `launch_classification_rules` (목표 설계)

| 필드명(물리) | 필드명(논리) | 데이터 타입 | 설명 | 제약사항 |
| --- | --- | --- | --- | --- |
| `rule_id` | 규칙 ID | UUID | 규칙 row 식별자 | PK |
| `launch_site_pattern` | 발사 원점 패턴 | Text | 예: "동창리(서해)", "순안(평양)", "평양 인근" | Not Null |
| `notification_pattern` | 국제 통보 패턴 | Enum | `notified`(일본 등 사전 통보) / `not_notified` | Not Null |
| `trajectory_pattern` | 궤적 패턴 | Text | 예: "필리핀 방향", "동해 고각 발사", "알섬 타격" | Not Null |
| `collateral_indicator` | 부가 징후 | Text | 예: "바지선 밀착", "신포 차량 집결", "함흥 17호/11호 사전 가동" | Nullable |
| `concluded_fuel_type` | 판정 연료 유형 | Enum | `liquid` / `solid` | Not Null |
| `concluded_weapon_class` | 판정 무기체계 | Enum | `space_launch_vehicle`(우주발사체) / `ICBM_IRBM` / `SRBM` 등 | Not Null |
| `confidence_hint` | 판정 신뢰 힌트 | Number (0~1) | 규칙 매칭 시 기본 신뢰도 | Not Null |

> 참고 규칙(마스터 타임라인 기준):
> 1. 동창리(서해) + 일본 통보 + 필리핀 방향 + 바지선 밀착 → 액체연료 우주발사체(정찰위성)
> 2. 순안(평양) + 통보 없음 + 동해 고각 발사 + 신포 차량 집결 → 액체연료 중장거리 탄도미사일(ICBM/IRBM)
> 3. 평양 인근 + 통보 없음 + 동해 고각 발사 + 신포 차량 집결 + 함흥(17호/11호) 사전 가동 → 고체연료 중장거리 탄도미사일(IRBM/ICBM)
> 4. 평양/전방 + 알섬 타격 궤적 + 신포 차량 없음 + TEL 단독 기동 → 고체연료 단거리 탄도미사일(SRBM: KN-23/24/25)

---

# 14. Physical / Storage Design

## 현재 저장 방식

| 항목 | 기준 |
| --- | --- |
| 원천 데이터 저장소 | `web-ui/src/data/*.json` 정적 파일 (`osint.json`, `historical-cases.json`, `hypotheses.json`, `scenario-a.json`, `scenario-b.json`) |
| IMINT/SIGINT/UAV 저장 방식 | 독립 파일 없이 `scenario-*.json`의 `TimelineEvent` 내부에 중첩 저장 |
| DB 클라이언트 | `web-ui/src/lib/supabase.ts`에 `supabase`(anon)/`supabaseAdmin`(service role) 클라이언트 구성만 존재, 실제 테이블/쿼리 미연결 |
| RAG 검색 | `searchSimilarCases`가 Supabase 벡터 검색을 시도한다는 주석은 있으나, 현재 구현은 로컬 키워드 유사도(`calculateSimilarity`)로만 동작 |
| 추론 결과 저장 | `InferenceResult`, `BriefingResult`는 API 응답에서만 존재하는 비영속(요청-응답) 데이터 |

## Supabase 전환 시 테이블 매핑 (목표 설계)

| 목표 테이블 | 원본 스키마 | 비고 |
| --- | --- | --- |
| `imint_reports` | `IMINTReport` | `TimelineEvent`에서 분리, `event_id` FK 추가 |
| `sigint_raw` | `SIGINTRaw` | 대량 스트리밍 대비 파티셔닝 후보(시간 기준) |
| `sigint_processed` | `SIGINTProcessed` | `sigint_raw`와 시간 범위로 논리 연결 |
| `uav_telemetry` | `UAVTelemetry` | 초 단위 적재 대비 파티셔닝 후보 |
| `provocation_cases` | `ProvocationCase` | `yearly_launch_seq` UNIQUE |
| `friendly_actions` | `FriendlyActionCase` | `related_launch_seq` FK |
| `osint_reports` | `OSINTReport` | `related_launch_seq` FK |
| `facilities` | 신규(§8) | 발사 징후 마스터 타임라인 정규화 |
| `launch_indicator_events` | 신규(§8) | `facilities`, `provocation_cases` FK |
| `launch_classification_rules` | 신규(§13) | Rule-Base 판정 테이블 |
| `action_classes` | `ActionClass` | `sourceData`는 원본 테이블 참조 방식(다형 FK)으로 재설계 필요 |
| `hypotheses` | `Hypothesis` | 정적 시드 데이터, 관리자 편집 UI 고려 |
| `inference_runs` | `InferenceResult` | 감사/재현을 위해 영속화할 경우 신규 |
| `historical_case_embeddings` | `HistoricalCase.indicators` | pgvector 임베딩으로 전환 시 RAG 실제 벡터 검색 지원 |

## 파티셔닝/보존 후보

| 테이블 | 기준 |
| --- | --- |
| `sigint_raw` | 시간(일/시간) 단위 range partition, 단기 보존 후 archive |
| `uav_telemetry` | 임무(`task_id`) 또는 시간 단위 partition |
| `inference_runs` | 월별 range partition (감사 목적) |

## 관계 요약

| 관계 | 기준 |
| --- | --- |
| `ProvocationCase.yearly_launch_seq` ↔ `FriendlyActionCase.related_launch_seq` | 1:1 (도발 사례 ↔ 아군 대응) |
| `ProvocationCase.yearly_launch_seq` ↔ `OSINTReport.related_launch_seq` | 1:N (도발 사례 ↔ 사후 공개보도) |
| `ActionClass.sourceData` → `IMINTReport`/`SIGINTRaw`/`SIGINTProcessed`/`UAVTelemetry`/`OSINTReport` | 다형(polymorphic) 참조 |
| `EvidenceTrace.actionId` → `ActionClass.id` | N:1 |
| `TimelineEvent.actionId` → `ActionClass.id` | N:1 |
| `UAVTelemetry.linked_target_id` → `ThreatAsset.id` | N:1 (논리적 참조) |
| `launch_indicator_events.facility_id` → `facilities.facility_id` | N:1 (목표 설계) |
| `launch_indicator_events.related_launch_seq` → `provocation_cases.yearly_launch_seq` | N:1 (목표 설계) |

---

# 15. 공통 Enum

## 원천 데이터

| Enum | 값 |
| --- | --- |
| `sensor_type` (IMINT) | `EO`, `SAR`, `IR` |
| `frequency_band` (SIGINT) | `UHF`, `HF`, `VHF`, `X-Band`, `S-Band`, `L-Band` |
| `signal_strength` (SIGINT) | `Weak`, `Moderate`, `High` |
| `ew_environment` (SIGINT) | `Normal`, `Jammed` |
| `weapon_class` | `SRBM`, `MRBM`, `IRBM`, `ICBM`, `SLBM`, `CM`, `HGV` |
| `sensor_mode` (UAV) | `FLIR_WhiteHot`, `FLIR_BlackHot`, `EO_DayTV`, `IR_MidWave` |
| `tracking_status` (UAV) | `Searching`, `Lock-on`, `Lost` |
| `media_type` (OSINT) | `Text`, `Photo`, `Video` (복합 표기 `Text & Photo` 등 허용) |

## 자산/시각화

| Enum | 값 |
| --- | --- |
| `ThreatAsset.type` | `SAM`, `TEL`, `RADAR`, `MISSILE_BASE`, `COMMAND` |
| `ThreatAsset.status` | `active`, `destroyed`, `relocating`, `unknown` |
| `FriendlyAsset.type` | `MISSILE`, `FIGHTER`, `ISR`, `SHIP`, `COMMAND`, `UAV` |
| `FriendlyAsset.status` | `ready`, `engaged`, `returning`, `standby` |
| `TimelineEvent.type` | `intel`, `movement`, `launch`, `strike`, `bda`, `alert` |
| `ScenarioId` | `scenario-a`, `scenario-b` |

## 정형화/추론

| Enum | 값 |
| --- | --- |
| `ActionClassType` | `IMINT`, `HUMINT`, `SIGINT`, `GEOINT`, `OSINT`, `MASINT`, `CYBINT`, `WXINT`, `UAV` |
| `Hypothesis.category` | `missile_launch` 등 (도메인 확장에 따라 카테고리 추가 가능) |

## 목표 설계(시설/규칙)

| Enum | 값 |
| --- | --- |
| `facilities.fuel_type` | `liquid`, `solid`, `common` |
| `launch_indicator_events.phase` | `pre_phase`, `phase1_fuel_prep`, `phase2_movement`, `phase3_vip`, `phase4_imminent`, `phase5_custody`, `phase6_osint_verify` |
| `launch_indicator_events.indicator_type` | `visual`, `signal`, `vip`, `osint` |
| `launch_classification_rules.notification_pattern` | `notified`, `not_notified` |
| `launch_classification_rules.concluded_fuel_type` | `liquid`, `solid` |

---

# 16. 구현 우선순위

## 해커톤 데모 필수 (구현됨 — 유지/보강)

| 우선순위 | 스키마 | 이유 |
| --- | --- | --- |
| 1 | `IMINTReport`, `SIGINTRaw`, `SIGINTProcessed`, `UAVTelemetry` | 시나리오 A/B 실시간 융합 탐지 데모의 핵심 원천 데이터 |
| 2 | `ActionClass`, `SPUQResult` | 비정형 보고를 정형화해 추론 계층에 공급하는 필수 연결고리 |
| 3 | `Hypothesis`, `InferenceResult` | "발사 확률 95%" 같은 핵심 어필 포인트를 산출하는 베이지안 추론 |
| 4 | `ProvocationCase`, `FriendlyActionCase`, `HistoricalCase` | 과거 유사 사례 매칭(RAG) 데모의 핵심 |
| 5 | `OSINTReport` | 다음 날 노동신문 교차검증으로 올소스 인텔리전스를 완성하는 마무리 데이터 |
| 6 | `BriefingResult`, `EvidenceTrace` | 지휘관 자연어 브리핑 최종 출력 |

## 데모 이후 보강 (설계 문서만 존재 → 목표 설계)

| 우선순위 | 스키마 | 이유 |
| --- | --- | --- |
| 1 | `facilities`, `launch_indicator_events` | 발사 징후 마스터 타임라인을 정규화해 Phase별 확률 추정 근거를 데이터로 관리 |
| 2 | `launch_classification_rules` | Rule-Base 판정을 `Hypothesis.likelihoodMap`과 병행 검증하는 결정론적 보조 로직 |
| 3 | `imint_reports`, `sigint_raw`, `sigint_processed`, `uav_telemetry` 독립 테이블화 | `TimelineEvent` 내장 구조에서 분리해 재사용성/조회 성능 확보 |

## 프로덕션 전환 (미래 확장)

| 범위 | 항목 |
| --- | --- |
| Supabase 실 연동 | `supabaseAdmin` 기반 실제 테이블 생성, `searchSimilarCases`의 pgvector 임베딩 검색 전환 |
| 대량 스트리밍 저장 | `sigint_raw`, `uav_telemetry`의 파티셔닝/보존 정책 수립 |
| 감사/재현성 | `inference_runs` 영속화로 추론 결과 이력 관리 |
| 시설 마스터 자동 갱신 | OSINT/영상 자산 갱신 시 `facilities.first_observed_phase` 자동 업데이트 파이프라인 |
