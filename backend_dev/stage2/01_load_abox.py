#!/usr/bin/env python3
"""DELPHI Stage2 / 01 — load Stage-1 A-Box output -> sorted observation dicts + campaign routing summary.
Usage: python3 01_load_abox.py
"""
import json, collections
from delphi_inference_engine import Engine, load_abox_observations

ABOX = "../data/abox_json/*.json"
eng = Engine("delphi_config.yaml")
recs = load_abox_observations(ABOX)
recs.sort(key=lambda x: x["collected_at"])

route = collections.Counter(eng.campaign_of(r["loc"]) for r in recs)
sig = collections.Counter(eng.campaign_of(r["loc"]) for r in recs
                          if eng.observation_to_event(r)["types"] != ["NoChange"])
print(f"loaded {len(recs)} observations  ({recs[0]['collected_at'][:10]} -> {recs[-1]['collected_at'][:10]})")
print("\ncampaign routing (all / signal-bearing):")
for c in ["unha3", "sinpo", "punggye", "other"]:
    print(f"  {c:8} {route.get(c,0):4}  (signal {sig.get(c,0)})")

with open("loaded_obs.jsonl", "w", encoding="utf-8") as f:
    for r in recs:
        f.write(json.dumps({**r, "campaign": eng.campaign_of(r["loc"])}, ensure_ascii=False) + "\n")
print("\n-> loaded_obs.jsonl")
