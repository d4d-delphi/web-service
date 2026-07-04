"""DELPHI inference backend API (FastAPI, read-only, cache-based).

Serves the Stage-2 cache (belief_snapshot + contribution ledger + source observations). No GPU/LLM:
every response is query + join + sort over the pre-computed cache, so it runs on a plain server.
Spec: API_SPEC_stage3.md.  Base: /api/v1.
"""
import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from datetime import datetime

from app import settings as S
from app.store import store

app = FastAPI(title="DELPHI inference API", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
P = S.API_PREFIX


@app.get("/health")
def health():
    return {"status": "ok", "cache": store.meta.get("recached_at"),
            "mode": store.meta.get("mode"), "campaigns": list(store.snaps.keys()),
            "snapshots": store.meta.get("n_snapshots"), "ledger": store.meta.get("n_ledger")}


@app.post(P + "/admin/reload")
def reload_cache():
    """Hot-reload the cache after a recache run (no server restart)."""
    store.reload()
    return {"reloaded": True, "cache": store.meta.get("recached_at")}


@app.get(P + "/campaigns")
def campaigns():
    return {"campaigns": store.campaigns()}


@app.get(P + "/inference")
def inference(
    campaign_id: str = Query(..., description="e.g. unha3"),
    at: str = Query(..., description="ISO datetime; returns latest snapshot at/before this time"),
    top_n: int = Query(8, ge=1, le=100),
    include_source: bool = Query(True),
):
    if not store.has_campaign(campaign_id):
        raise HTTPException(404, f"unknown campaign_id '{campaign_id}'")
    try:
        datetime.fromisoformat(at)
    except ValueError:
        raise HTTPException(422, f"invalid 'at' datetime: {at}")
    r = store.inference(campaign_id, at, top_n=top_n, include_source=include_source)
    if r is None:
        raise HTTPException(404, f"no snapshot at/before {at} for '{campaign_id}'")
    return r


@app.get(P + "/inference/series")
def inference_series(
    campaign_id: str = Query(...),
    from_: str = Query(None, alias="from"),
    to: str = Query(None),
    fields: str = Query("p_launch,hypotheses"),
):
    if not store.has_campaign(campaign_id):
        raise HTTPException(404, f"unknown campaign_id '{campaign_id}'")
    flist = [f.strip() for f in fields.split(",") if f.strip()]
    return {"campaign_id": campaign_id, "series": store.series(campaign_id, from_, to, flist)}


@app.get(P + "/observations/{obs_id}")
def observation(obs_id: str):
    row = store.observation(obs_id)
    if row is None:
        raise HTTPException(404, f"unknown obs_id '{obs_id}'")
    return row


# demo frontend (proves the belief-timeline graph is buildable purely from the API)
_FRONTEND = os.path.join(S.ROOT, "frontend")
if os.path.isdir(_FRONTEND):
    app.mount("/ui", StaticFiles(directory=_FRONTEND, html=True), name="ui")
