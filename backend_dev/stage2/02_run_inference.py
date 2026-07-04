#!/usr/bin/env python3
"""DELPHI Stage2 / 02 — per-campaign replay -> belief_snapshot.jsonl (per-timestamp cache).
Usage: python3 02_run_inference.py
"""
import json
from delphi_inference_engine import Engine, load_abox_observations

eng = Engine("delphi_config.yaml")
recs = load_abox_observations("../data/abox_json/*.json")

n = 0
with open("belief_snapshot.jsonl", "w", encoding="utf-8") as f:
    for camp in eng.cfg["campaigns"]:
        snaps, _ = eng.replay(recs, camp)
        for s in snaps:
            s["campaign_id"] = camp
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
            n += 1
        print(f"  {camp:8} -> {len(snaps)} snapshots")
print(f"\ntotal {n} snapshots -> belief_snapshot.jsonl")
