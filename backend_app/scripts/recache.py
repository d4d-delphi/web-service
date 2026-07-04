#!/usr/bin/env python3
"""DELPHI recache — rebuild ALL cached data when the source DB updates.

Full pipeline (GPU box):   observation DB --Stage1(LLM)--> A-Box --Stage2--> belief_snapshot + ledger
  python scripts/recache.py                 # fetch + classify(LLM) + build A-Box + inference + ledger

Reuse mode (no GPU / testing):  reuse an already-computed A-Box, run only Stage 2.
  python scripts/recache.py --reuse-abox [SRC_DATA_DIR]
     copies <SRC>/abox_json + <SRC>/observations.jsonl into cache/, then runs Stage 2 only.
     Default SRC = backend_dev/data (the A-Box already produced there). NEVER re-runs the local LLM.

Emits cache/{observations.jsonl, abox_json/, belief_snapshot.jsonl, ledger.jsonl, meta.json}.
"""
import os, sys, shutil, json, argparse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app import settings as S           # noqa: E402
from pipeline import stage2             # noqa: E402


def reuse_abox(src_dir):
    src_abox = os.path.join(src_dir, "abox_json")
    src_obs = os.path.join(src_dir, "observations.jsonl")
    if not os.path.isdir(src_abox):
        sys.exit(f"[recache] no A-Box at {src_abox} — cannot reuse")
    os.makedirs(S.CACHE_DIR, exist_ok=True)
    if os.path.abspath(src_abox) != os.path.abspath(S.ABOX_DIR):
        if os.path.isdir(S.ABOX_DIR):
            shutil.rmtree(S.ABOX_DIR)
        shutil.copytree(src_abox, S.ABOX_DIR)
    if os.path.exists(src_obs):
        shutil.copy(src_obs, S.OBSERVATIONS)
    n = len(os.listdir(S.ABOX_DIR))
    print(f"[recache] reused A-Box: {n} records from {src_abox} (no LLM run)")


def full_pipeline():
    from pipeline import stage1
    print("[recache] Stage 1: fetch -> classify(LLM) -> build A-Box")
    stage1.fetch_observations()
    stage1.classify_unusual()
    stage1.build_abox_json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse-abox", nargs="?", const=S.DEV_DATA_DIR, default=None,
                    metavar="SRC_DATA_DIR",
                    help="skip Stage-1 LLM; reuse an existing A-Box (default: backend_dev/data)")
    args = ap.parse_args()

    t0 = datetime.now(timezone.utc)
    if args.reuse_abox is not None:
        print(f"[recache] REUSE mode (no GPU/LLM), src={args.reuse_abox}")
        reuse_abox(args.reuse_abox)
    else:
        print("[recache] FULL mode (needs GPU + SUPABASE_SERVICE_KEY)")
        full_pipeline()

    print("[recache] Stage 2: inference + contribution ledger")
    meta = stage2.build_cache()
    meta["recached_at"] = t0.isoformat()
    meta["mode"] = "reuse-abox" if args.reuse_abox is not None else "full"
    json.dump(meta, open(S.META, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[recache] DONE ({meta['mode']}) at {meta['recached_at']} -> {S.CACHE_DIR}")


if __name__ == "__main__":
    main()
