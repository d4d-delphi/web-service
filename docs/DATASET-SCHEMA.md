# NL-COP 데이터셋 스키마 정의

## 개요

5개 도메인의 데이터셋 스키마를 정의합니다:
1. 영상자산 (IMINT) - 위성/항공기
2. 신호자산 (SIGINT) - RF/레이더/ELINT
3. 과거사례 (Historical Cases) - 미사일 도발 + 아군 대응
4. 추적자산 (UAV/FLIR) - 헤론/MQ-9 실시간 스트리밍
5. 공개첩보 (OSINT) - 노동신문/KCNA 등

---

## 1. 영상자산 (IMINT)

### 추출 가능한 핵심 데이터
- **시간 정보:** 촬영 일시 + 판독(분석) 일시
- **공간 정보:** 위경도 + MGRS 좌표
- **센서 제원:** EO/SAR/IR, 기상, 촬영 각도 → 영상 품질/신뢰도
- **탐지 객체:** 장비/차량/건물/인원 종류 + 정확한 카운팅
- **활동 성격:** Routine vs Unusual
- **분석 주체:** 판독관 신원/소속 (Provenance)
- **전술적 의미:** 군사적 목적/동향 서술형 분석

### 스키마

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `timestamp_captured` | 영상 촬영 일시 | ISO 8601 |
| `timestamp_analyzed` | 판독관 분석 완료 일시 | ISO 8601 |
| `sensor_type` | 센서 종류 | `EO` / `SAR` / `IR` |
| `source_platform` | 수집 플랫폼 | 다목적실용위성, 군사정찰위성(425), 상용위성 등 |
| `MGRS_coordinate` | MGRS 좌표 | `51S UU 12345 67890` |
| `location_name` | 대상 지역/시설 명칭 | 동창리 서해위성발사장 등 |
| `detected_objects` | 탐지 객체 + 수량 | `[{"type": "vehicle", "count": 4}]` |
| `unusual_activity_flag` | 특이동향 여부 | boolean |
| `semantic_analysis` | 판독관 텍스트 분석 | string (자연어) |
| `confidence_level` | 영상 신뢰 등급 (1~5) | number |
| `analyst_name` | 판독관 이름/ID | string |
| `analyst_unit` | 판독관 소속 | 정보사, 공군 항공정보단 등 |

---

## 2. 신호자산 (SIGINT)

### 2-1. 신호 로우 데이터 (Raw)

체계가 자동 수집하는 원천 데이터. 수초~수분 단위 산발적 생성.

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `timestamp` | 신호 포착 순간 (TOI) | ISO 8601 |
| `receiving_system` | 수집 체계/플랫폼 | `RF-16(청매)`, `777사령부` 등 |
| `estimated_MGRS` | 추정 좌표 (오차반경 포함) | MGRS string |
| `frequency_band` | 주파수 대역 | `UHF`/`HF`/`VHF`/`X-Band`/`S-Band` |
| `signal_characteristics` | PRI, PW, Scan 패턴 등 | `{"PRI": 1050, "PW": 2.5, "Scan": "Circular"}` |
| `raw_emitter_guess` | 체계 1차 추정 방출원 | string |
| `signal_strength` | 신호 세기 (SNR) | `Weak`/`Moderate`/`High` |

### 2-2. 신호 가공 데이터 (Processed)

병사/분석관이 산발적 raw를 종합한 "누가, 언제~언제, 어디서, 무엇을 켰다" 요약.

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `time_start` | 가동 시작 시간 | ISO 8601 |
| `time_end` | 가동 종료 시간 | ISO 8601 |
| `facility_name` | 신호 발생 기지/지역명 | string |
| `emitter_identified` | 확정 식별 장비명 | `SA-2 Fan Song` 등 |
| `integrated_sources` | 융합 사용 출처들 | string[] |
| `human_summary` | 병사 작성 텍스트 요약 | string |
| `ew_environment` | 전파 방해 환경 | `Normal`/`Jammed` |

### AI 자동 가공 (Killer Point)
> 국지도발(전시) 상황에서 Raw 데이터 폭주 시, AI가 MGRS+주파수 특성을 실시간 군집화하여
> `human_summary`를 병사 대신 수 초 만에 자동 작성.

---

## 3. 과거사례 (Historical Cases)

### 3-1. 미사일 도발 사례 DB

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `yearly_launch_seq` | **[PK]** 연도 n번째 발사 | `2026-04` |
| `launch_time` | 발사 일시 (다발 시 범위) | string |
| `launch_count` | 발사 발수 | number |
| `weapon_class` | 무기체계 분류 | `SRBM`/`ICBM`/`CM` 등 |
| `kn_designation` | KN 식별번호 | `KN-23` 등 |
| `visual_indicators` | **[영상 징후 배열]** | `[{date, time, location, activity}]` |
| `signal_indicators` | **[신호 징후 배열]** | `[{date, time, location, activity}]` |

### 3-2. 아군 대응 및 BDA DB

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `related_launch_seq` | **[FK]** 매칭 도발 | `2026-04` |
| `targeting_process` | 표적 처리 과정 | string |
| `response_action` | 아군 대응 행동 | string |
| `bda_result` | 전투피해평가 결과 | string |

---

## 4. 추적자산 (UAV/FLIR)

무인기 실시간 텔레메트리 스트리밍 데이터 (초 단위).

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `timestamp` | 수신 시간 | ISO 8601 |
| `task_id` | 임무 번호 | `TASK-202607-ISR-01` |
| `asset_name` | 플랫폼 명칭 | `Heron`/`MQ-9` |
| `sensor_mode` | 센서 모드 | `FLIR_WhiteHot`/`EO_DayTV` |
| `platform_MGRS` | 무인기 현재 좌표 | MGRS |
| `crosshair_MGRS` | 카메라 에임 지상 좌표 | MGRS |
| `slant_range_km` | 무인기~표적 경사거리 | number (km) |
| `tracking_status` | 추적 상태 | `Searching`/`Lock-on` |
| `linked_target_id` | 추적 표적 ID | string |

---

## 5. 공개첩보 (OSINT)

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `osint_id` | 보고서 고유 번호 | `OSINT-20260705-01` |
| `published_time` | 북한 매체 보도 일시 | ISO 8601 |
| `processed_time` | 정보사 분석/전파 일시 | ISO 8601 |
| `source_media` | 출처 매체 | 노동신문/KCNA/조선중앙TV |
| `media_type` | 보도 형태 | `Text`/`Photo`/`Video` |
| `original_title` | 매체 원문 제목 | string |
| `key_entities` | 주요 인물/장비/장소 | string[] |
| `dia_analytical_summary` | 정보사 팩트 요약 | string |
| `strategic_intent` | 전략적 의도 분석 | string |
| `related_launch_seq` | **[FK]** 매칭 도발 | string |

---

## 시나리오별 데이터 흐름

### 시나리오 A (평시: 탄도미사일 징후 탐지)
1. **IMINT**: 위성이 TEL 전개 포착 → 영상 데이터
2. **SIGINT Raw**: 통제소 무전 급증, 드론 텔레메트리 포착
3. **SIGINT Processed**: 병사(또는 AI)가 요약 생성
4. **UAV/FLIR**: 헤론이 적 SA-2 기지 감시 Lock-on
5. **베이지안 추론**: 징후 융합 → "발사 확률 95%" 산출
6. **OSINT** (발사 후): 노동신문 보도로 무기체계 최종 확인

### 시나리오 B (전시: SEAD + BDA)
1. **SIGINT**: 적 SA-5 레이더 가동 포착
2. **IMINT**: 위성으로 SA-5 진지 좌표 확인
3. **타격 결심**: AI 최적 타격순서 도출
4. **타격 후 SIGINT**: 레이더 신호 소실 확인
5. **UAV/FLIR**: MQ-9 북상, 타격 지점 BDA Lock-on
6. **BDA 완료**: 위협 반경 소멸, 안전 비행회랑 확보
