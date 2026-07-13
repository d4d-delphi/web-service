"""Smoke test: the API boots and /health returns ok.

Robust to an empty cache (CI has no cache/ files and no Redis env), so it only
asserts the contract that always holds regardless of data state.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
