# DELPHI inference backend (`backend_app`)

Read-only FastAPI backend that serves the DELPHI inference pipeline output to the frontend. The heavy work
(LLM ontology translation + inference) happens in a **recache** step; the **API server** only reads the
pre-computed cache, so it runs on a plain box **without a GPU**.

```
 source DB (Supabase observation)
        │  ┌─────────────── recache (rebuild when DB updates) ───────────────┐
        ▼  │                                                                 │
   Stage 1 │ fetch → Qwen LLM (unusual only) → A-Box JSON  [GPU]             │
   Stage 2 │ config inference engine → belief_snapshot + contribution ledger │  [CPU]
        │  └─────────────────────────────────────────────────────────────────┘
        ▼
   cache/ (belief_snapshot.jsonl, ledger.jsonl, observations.jsonl, abox_json/, meta.json)
        ▼
   API server (FastAPI)  ── /api/v1 ──▶  frontend      [CPU only, no LLM]
        (query + join + reverse-attribution over the cache)
```

Cross-stage join key is `obs_id` end to end (source row → A-Box → deciban contribution), so every
probability is traceable back to the raw observation that caused it.

## Quickstart (serve from an already-built cache, no GPU)
```bash
cd backend_app
pip install -r requirements.txt
python scripts/recache.py --reuse-abox     # build cache/ from backend_dev A-Box (no LLM)
scripts/serve.sh 127.0.0.1 8000            # start API
```
Then open:
- **`http://127.0.0.1:8000/ui/`** — demo frontend: the belief-timeline graph built live from the API (campaign tabs, crosshair, click a signal event → contribution drilldown).
- **`http://127.0.0.1:8000/docs`** — Swagger UI (try every endpoint in-browser).
- **`http://127.0.0.1:8000/health`** — cache status / freshness.

## Two operational scripts

### 1. Recache (run when the source DB updates)
Rebuilds ALL cached data. On a GPU box (full pipeline incl. LLM):
```bash
export SUPABASE_SERVICE_KEY=...        # source DB
TRITON_PTXAS_PATH=/usr/local/cuda-13.0/bin/ptxas python scripts/recache.py
```
On a box **without** a GPU, or to rebuild only the inference layer from an already-computed A-Box
(never re-runs the local LLM):
```bash
python scripts/recache.py --reuse-abox            # default src: ../backend_dev/data
python scripts/recache.py --reuse-abox /path/to/data
```
After a recache, either restart the server or hot-reload: `POST /api/v1/admin/reload`.

### 2. Serve (start the API — no GPU/LLM)
```bash
pip install -r requirements.txt        # server deps only; torch/transformers NOT needed
scripts/serve.sh 0.0.0.0 8000          # → http://…:8000  (Swagger at /docs)
```

## API (`/api/v1`, see `../API_SPEC_stage3.md`)

| method | path | purpose |
|---|---|---|
| GET | `/campaigns` | campaign list + counts + time ranges |
| GET | `/inference` | ★ one timestamp → probabilities + per-obs contributions (+ source) |
| GET | `/inference/series` | snapshot sequence for probability curves |
| GET | `/observations/{obs_id}` | raw observation row (evidence drilldown) |
| GET | `/health`, POST `/admin/reload` | ops |

`/inference?campaign_id=unha3&at=<ISO>&top_n=8&include_source=true` returns `hypotheses`, `p_launch`,
`hypothesis_contributions` (static-axis deciban per obs, sign per hypothesis) and `launch_contributions`
(stage residual = `db · decay_per_day^(Δdays)` discounted to the query time). Contributions are attributed
to `obs_id` and joined to the source row. Responses are UTF-8 (`ensure_ascii=false`).

## Calling the API — examples

> ⚠️ **URL-encode the `at` timestamp.** The `+00:00` offset contains a `+`, which a raw query string reads
> as a space → 422. Use `curl -G --data-urlencode` (below) or percent-encode `+` as `%2B`.

```bash
BASE=http://127.0.0.1:8000/api/v1

# campaign list
curl -s "$BASE/campaigns"

# ★ inference at a timestamp — probabilities + reverse-attributed contributions + source
curl -s -G "$BASE/inference" \
  --data-urlencode "campaign_id=unha3" \
  --data-urlencode "at=2026-07-15T00:46:00+00:00" \
  --data-urlencode "top_n=6"
# add --data-urlencode "include_source=false" for obs_id + db only (lighter)

# probability curve (what the /ui graph fetches) — pick the fields you plot
curl -s -G "$BASE/inference/series" \
  --data-urlencode "campaign_id=unha3" \
  --data-urlencode "fields=p_launch,p_activity,s1_early,s2_pad,s3_imminent,fuel,range,hypotheses"
# optional: --data-urlencode "from=2026-07-01T00:00:00+00:00" --data-urlencode "to=..."

# raw observation drilldown (evidence)
curl -s "$BASE/observations/24f455dd-ac68-4c4d-8d08-4f91475ff2dc"

# ops: after a recache, hot-reload the cache without restarting
curl -s -X POST "$BASE/admin/reload"
```
Errors: `404` (unknown campaign / no snapshot at-or-before `at` / unknown obs_id), `422` (bad params).

## What the backend returns (field reference)

All responses are UTF-8 JSON (`ensure_ascii=false`, Korean verbatim). Timestamps are ISO-8601
(`2026-07-15T00:46:00+00:00`). **Contribution unit = deciban** (10·log₁₀ likelihood-ratio): **positive
supports** the claim, **negative refutes** it. `+10 dB` ≈ 10× more likely; `+3 dB` ≈ 2×.

### `GET /campaigns`
```json
{"campaigns":[
  {"campaign_id":"unha3","label":"동창리(은하-3)","observation_count":563,
   "time_range":{"start":"2026-03-01T01:00:00+00:00","end":"2026-07-15T00:46:00+00:00"}}
]}
```
`observation_count` = observations routed to this campaign (= number of snapshots). `time_range` spans
first→last observation.

### `GET /inference` ★
The full belief state at `at` plus **why** (reverse-attribution to source observations).
```json
{
  "campaign_id": "unha3",
  "timestamp": "2026-07-15T00:46:00+00:00",   // actual snapshot time (latest at/before `at`)
  "seq": 563,                                  // snapshot index within the campaign (1-based)

  "hypotheses": {                              // joint P(H) over the config axes — sums to 1.0
    "액체·장거리": 0.9214, "고체·장거리": 0.0766,
    "액체·단거리": 0.0018, "고체·단거리": 0.0001
  },
  "p_launch": 0.9976,                          // launch imminence (output expr in config)

  "hypothesis_contributions": {                // per hypothesis: which observations argue FOR it
    "액체·장거리": [
      { "obs_id": "101845d7-…",
        "contribution_db": 10.8,               // deciban this obs adds to THIS hypothesis
        "source": { …see below… } }            // (sign flips across the 4 labels: +for 액체, −for 고체)
    ],
    "고체·장거리": [ … ], "액체·단거리": [ … ], "고체·단거리": [ … ]
  },

  "launch_contributions": [                    // what is still pushing P(launch) at this moment
    { "obs_id": "24f455dd-…",
      "residual_db": 27.0,                     // stage evidence discounted by decay to `timestamp`
      "stages": ["s2_pad","s3_imminent"],      // which stage integrator(s) this obs fed
      "source": { …see below… } }
  ]
}
```
Field meaning:
| field | meaning |
|---|---|
| `hypotheses` | the 4 joint hypotheses (fuel × range axes) and their probabilities; argmax = current best call |
| `p_launch` | `s3_imminent · (1−(1−s1_early)(1−s2_pad))` — imminent signal AND campaign progression |
| `hypothesis_contributions[label]` | observations ranked by their deciban push toward `label` (static axes, **no decay** → permanent). Sorted desc, `top_n` each |
| `launch_contributions` | observations ranked by **residual** deciban still alive in the stages: `db · decay_per_day^(Δdays)`, Δ = snapshot−obs. A telemetry hit yesterday counts more than a comms surge last month |
| `stages` | which leaky stages the obs contributed to (`s1_early`/`s2_pad`/`s3_imminent`) |

`source` object (raw observation, `obs_id`-joined; omit with `include_source=false`):
```json
{"obs_id":"…","collected_at":"…","asset_type":"SATELLITE_IMINT",
 "location_name":"잠진 기계공장 엔진시험장 (남포 인근)",
 "activity_desc":"…3m 연료통 1기…","reliability":4,
 "platform":"Pleiades (CNES/Airbus DS)","analyst_unit":"국방정보본부 영상판독대"}
```

### `GET /inference/series`
Lightweight snapshot sequence for drawing curves. Each item carries the requested `fields` plus, on
signal-bearing observations, `is_signal:true` and the `items` that fired:
```json
{"campaign_id":"unha3","series":[
  {"timestamp":"2026-03-17T02:30:00+00:00","seq":51,"p_launch":0.0282,
   "hypotheses":{"액체·장거리":0.8393, …},
   "is_signal":true,"items":["PropellantVehicle","SupportVehicle","PersonnelActivity","ObjectMovement"]}
]}
```
Requestable `fields`: `p_launch`, `p_activity`, `hypotheses`, and any stage (`s1_early`,`s2_pad`,
`s3_imminent`) or axis (`fuel`,`range`). Non-signal points (baseline decay) omit `is_signal`/`items`.

### `GET /observations/{obs_id}`
The full source observation row (evidence download). Keys:
`obs_id, asset_type, polarity, collected_at, mgrs, location_name, observed_objects, activity_desc,
unusual_flag, platform, analyst_id, analyst_unit, reliability, asset_detail, source_ref, image_urls,
created_at`. (`asset_detail` holds sensor/signal metadata, e.g. SIGINT `emitter_guess`/`signal_params`.)

### `GET /health`
`{"status":"ok","cache":"<recached_at>","mode":"reuse-abox","campaigns":[…],"snapshots":667,"ledger":46}`

## Layout
```
config/   delphi_config.yaml (hypotheses/stages/campaigns), delphi_tbox_v0.2.ttl
app/      engine.py, contrib.py (ledger+query), store.py (cache loader), main.py (FastAPI), settings.py
pipeline/ stage1.py (fetch/LLM/A-Box), qwen_client.py (Qwen few-shot), stage2.py (inference+ledger)
frontend/ index.html — demo graph served at /ui/ (reference for the real frontend)
scripts/  recache.py, serve.sh
cache/    generated artifacts (produced by recache)
```
All model/hypothesis tuning is in `config/delphi_config.yaml` — the engine code is unchanged when adding
a hypothesis axis, stage, or campaign.
