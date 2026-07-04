# DELPHI — 백엔드 이후 로드맵 (Next Steps)

> 백엔드(Qwen LLM 온톨로지 변환 + deciban 확신도 엔진 + obs_id 역추적 + Redis 캐시)이 자리 잡으면서,
> 데모용 `web-ui/lib/bayesian.ts` 너머에 **"진짜 추론 엔진"** 이 생겼다. 로드맵의 핵심은 이 엔진을 데모 한가운데로 끌어오는 것.

## P0 — 프론트엔드 ↔ 백엔드 추론 엔진 연동 (가장 큰 레버)
현재 `web-ui`는 `lib/bayesian.ts`(데모 휴리스틱)로 추론. 백엔드 `GET /api/v1/inference`가 **obs_id로 역추적 가능한 정량 확률 + 기여도(contribution ledger)** 를 내놓는다.
- `web-ui/src/lib/inference_client.ts`(신규): 백엔드 `/inference?campaign_id&at&top_n&include_source` 호출 → `InferenceResult` 호환으로 변환.
- `api/brief`·`EnemyPanel`의 `runInference`를 **백엔드 우선, 실패 시 `bayesian.ts` 폴백**(`BACKEND_API_URL` env).
- 캠페인↔시나리오 매핑(scenario A = `unha3` 등), `/inference/series` 로 확률 곡선.
- **가치**: 심사위원이 보는 확률/근거가 "데모 코드"가 아니라 "실제 LLM + deciban 엔진 + Redis 캐시"에서 나온다 → 파트너가 강조한 "전장에 즉시 투입 가능"의 신뢰도 급상승.

## P1 — Redis 배포 (운용, 사용자 크레딜 필요)
- Upstash REST(supabase와 짝, 무료 티어) 또는 Redis 인스턴스 프로비전 → `UPSTASH_REDIS_REST_URL/TOKEN` 또는 `REDIS_URL`.
- `python scripts/recache.py --reuse-abox`(backend_dev A-Box) → 캐시 빌드 + Redis 적재(`publish_cache`).
- `scripts/serve.sh` 기동 → API가 Redis에서 읽는다(stateless).
- (코드는 env-gated로 구현됨 — `backend_app/app/cache_redis.py`. 남은 건 크레딜 설정 + 기동.)

## P1 — 전체 미러 재생성 묶음 ✅ 준비됨
`web-ui/supabase/seed/export_all_mirrors.sh` — 8종 평면 미러(`src/data/*.json`, gitignore)를 원격 DB(정본)에서 한 번에 재생성.
데모/배포 환경에서 한 줄이면 `/api/*`(orbat/blue/ontology/copilot/rag/doctrine/emitter)가 데이터를 갖는다.
```bash
cd web-ui && bash supabase/seed/export_all_mirrors.sh
```

## P2 — 코파일럿 e2e (실제 Claude 답)
`/api/copilot` + 백엔드 inference + `ANTHROPIC_API_KEY` 로 19 유스케이스 **실제 자연어 답** 검증.
현재는 컨텍스트 조립(+ 키 있으면 답)까지 됨 → 데모 전 핵심 3~5개 질의(발사임박성/ROE/교차검증) 답 품질 점검 + 프롬프트 튜닝.

## P2 — 근거추적(Evidence Trace) UI
백엔드의 obs_id 기여도(`hypothesis_contributions`/`launch_contributions`) → 지도/패널에서 "이 발사확률의 근거 observation top-N" 클릭 → 원본 `observation` 행까지 드릴다운.
`docs/PIPELINE.md` 핵심 가치(블랙박스 AI 거부 → 신뢰 = 의지). P0 의 자연스러운 후속.

## P3 — 보류/후속
- 방공 위험반경(SA-5 250km 등) 시각화 — "유효사거리 아니다"로 사용자가 미룸.
- emitter 위협반경/교차검증 시각화(D3 emitter 온톨로지 확장 연계).

---

## 추천 진행 순서
1. **P1** (미러 묶음 ✅ + Redis 배포) — 환경 세팅
2. **P0** (프론트-백엔드 추론 연동) — 데모 추론을 "진짜 엔진"으로 교체
3. **P2** (코파일럿 실제 답 + 근거추적 UI) — 마무리

## 현재 상태 (2026-07-05)
- **완료**: 적 ORBAT(좌표 정정, PR #42) · ROK 아군 전투서열(PR #43) · 사령부 명칭+마커 색 톤다운(PR #45) · emitter 온톨로지+코파일럿 SIGINT(PR #44) · 백엔드 Redis 캐시(PR #46) · 미러 묶음 스크립트.
- **대기**: Redis 크레딜/배포(사용자) → P0 연동 코드 가능.
