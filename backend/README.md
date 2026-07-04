# NL-COP/DELPHI Backend (FastAPI)

프론트엔드(`web-ui`, Next.js)와 같은 Supabase 프로젝트("Delphi")를 공유하는 백엔드 API 서버입니다.
DB 스키마는 새로 만들지 않으며, `web-ui/supabase/migrations/`에 정의된 테이블을 그대로 사용합니다.

## 요구 사항

- Python 3.11+

## 시작하기

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt   # 개발 (테스트/린트 포함)
# 또는: pip install -r requirements.txt  (운영/최소 의존성)

cp .env.example .env
# .env에 SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 채워넣기
# (Dashboard > Project Settings > API 에서 확인)

uvicorn app.main:app --reload --port 8000
```

- API 문서(Swagger): http://localhost:8000/docs
- Health check: http://localhost:8000/health

## 구조

```
backend/
  app/
    main.py            # FastAPI 앱 엔트리포인트
    core/config.py     # 환경변수 기반 설정
    db/supabase_client.py  # Supabase 클라이언트 (anon / service_role)
    api/routes/         # 라우터 (health, scenarios, ...)
    schemas/            # Pydantic 모델 (DB 테이블과 1:1 매핑)
  tests/
  requirements.txt
  requirements-dev.txt
  .env.example
```

## 참고 문서

- 데이터 사전(앱 데이터 모델 부록): `../docs/DATASET-SCHEMA.md`
- DB 스키마(마이그레이션): `../web-ui/supabase/migrations/20260704071600_init_nl_cop_schema.sql`
