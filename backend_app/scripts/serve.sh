#!/usr/bin/env bash
# Start the DELPHI inference API (read-only, cache-based). No GPU/LLM needed.
# Usage: scripts/serve.sh [HOST] [PORT]   (defaults 0.0.0.0:8000)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HOST="${1:-0.0.0.0}"
PORT="${2:-8000}"

if [ ! -f "$ROOT/cache/belief_snapshot.jsonl" ]; then
  echo "[serve] no cache found at $ROOT/cache — run: python scripts/recache.py --reuse-abox" >&2
  exit 1
fi

echo "[serve] DELPHI API on http://$HOST:$PORT  (docs: /docs, health: /health)"
exec uvicorn app.main:app --host "$HOST" --port "$PORT" "${UVICORN_ARGS:-}"
