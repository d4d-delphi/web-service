#!/usr/bin/env python3
"""DELPHI Stage1 / 01 — Supabase observation 712행을 data/observations.jsonl로 내린다.
읽기 전용. REST + service_role. 멱등(덮어쓰기).
용법: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 01_fetch_observations.py
"""
import os, json, sys, requests

BASE = os.environ.get("SUPABASE_URL", "https://jahosulejxmqjyjkvhno.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not KEY:
    sys.exit("SUPABASE_SERVICE_KEY 미설정 — export 후 재실행")

H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
OUT = "data/observations.jsonl"

rows, step, off = [], 1000, 0
while True:
    r = requests.get(
        f"{BASE}/rest/v1/observation",
        headers={**H, "Range-Unit": "items", "Range": f"{off}-{off+step-1}"},
        params={"select": "*", "order": "collected_at.asc"},
        timeout=60,
    )
    r.raise_for_status()
    batch = r.json()
    rows += batch
    print(f"  fetched {off}-{off+len(batch)-1} (+{len(batch)})", flush=True)
    if len(batch) < step:
        break
    off += step

os.makedirs("data", exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    for x in rows:
        f.write(json.dumps(x, ensure_ascii=False) + "\n")

print(f"\nfetched {len(rows)} rows -> {OUT}")
if rows:
    print("컬럼:", sorted(rows[0].keys()))
