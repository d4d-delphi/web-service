"""Paths & settings for the DELPHI backend. All overridable by env."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # backend_app/

CONFIG_PATH = os.environ.get("DELPHI_CONFIG", os.path.join(ROOT, "config", "delphi_config.yaml"))
TBOX_PATH = os.environ.get("DELPHI_TBOX", os.path.join(ROOT, "config", "delphi_tbox_v0.2.ttl"))

CACHE_DIR = os.environ.get("DELPHI_CACHE_DIR", os.path.join(ROOT, "cache"))
ABOX_DIR = os.path.join(CACHE_DIR, "abox_json")
SNAPSHOTS = os.path.join(CACHE_DIR, "belief_snapshot.jsonl")
LEDGER = os.path.join(CACHE_DIR, "ledger.jsonl")
OBSERVATIONS = os.path.join(CACHE_DIR, "observations.jsonl")
META = os.path.join(CACHE_DIR, "meta.json")

# Stage-1 source (Supabase) — only used by recache in full (GPU) mode
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://jahosulejxmqjyjkvhno.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

# where the already-computed Stage-1 A-Box lives, for --reuse-abox (no LLM rerun)
DEV_DATA_DIR = os.environ.get("DELPHI_DEV_DATA",
                              os.path.join(os.path.dirname(ROOT), "backend_dev", "data"))

API_PREFIX = "/api/v1"
