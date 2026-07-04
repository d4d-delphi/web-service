# DELPHI / NL-COP

Multi-source intelligence-fusion **natural-language command-and-control (NL-COP)** dashboard.
Next.js 14 (App Router) + React 18 + CesiumJS 2D map, with a Bayesian inference pipeline
over Layer-1 source intel (`observation`) stored in Supabase.

- `web-ui/` — the live Next.js app (package `nl-cop`). **Run from here.**
- `backend/` — optional FastAPI service. No longer required for the map/feed.
- `docs/` — dataset schema (`DATASET-SCHEMA.md`) and pipeline notes (`PIPELINE.md`).

## Getting started

```bash
cd web-ui
cp .env.example .env.local   # then fill in the Supabase keys (see below)
npm install
npm run dev                  # http://localhost:3000 (auto-picks a free port)
```

## Data flow

Source-intel **events** come from the Supabase `observation` table (Layer 1). The Next.js
API route **`web-ui/src/app/api/events`** reads it directly (server-side) and maps each
observation to a timeline event — **parsing its MGRS coordinate to lat/lng so it plots on
the Cesium map**. The frontend (`app/page.tsx`) fetches `/api/events` and uses these to
drive the intel feed, the Bayesian forecast, and the map markers, replacing the previous
static mock JSON (which remains as an offline fallback).

> The old path went through FastAPI (`backend/`). Events now bypass it entirely.

## Environment variables

Supabase credentials **moved from `backend/.env` to `web-ui/.env.local`** (gitignored).
Copy `web-ui/.env.example` → `web-ui/.env.local` and fill in:

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Browser-safe anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Used by `/api/events` to read `observation`; never shipped to the browser |
| `NEXT_PUBLIC_API_BASE_URL` | public | Legacy FastAPI base URL (optional) |

Never commit `.env.local`. The `backend/.env.example` remains only for anyone still
running the optional FastAPI service.
