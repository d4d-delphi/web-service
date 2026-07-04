"""Stage 2 (cache build) — replay A-Box per campaign -> belief_snapshot.jsonl + ledger.jsonl + meta.json.
CPU-only (no GPU/LLM). Called by scripts/recache.py after Stage 1 has produced abox_json.
"""
import os, json, glob
from app.contrib import ContribEngine
from app.engine import load_abox_observations
from app import settings as S


def build_cache(abox_dir=None, cache_dir=None, config_path=None):
    abox_dir = abox_dir or S.ABOX_DIR
    cache_dir = cache_dir or S.CACHE_DIR
    config_path = config_path or S.CONFIG_PATH
    os.makedirs(cache_dir, exist_ok=True)

    eng = ContribEngine(config_path)
    recs = load_abox_observations(os.path.join(abox_dir, "*.json"))
    campaigns = list(eng.cfg["campaigns"].keys())

    snap_f = open(os.path.join(cache_dir, "belief_snapshot.jsonl"), "w", encoding="utf-8")
    ledg_f = open(os.path.join(cache_dir, "ledger.jsonl"), "w", encoding="utf-8")
    meta = {"campaigns": {}, "n_observations": len(recs), "n_snapshots": 0, "n_ledger": 0}

    for camp in campaigns:
        snaps, ledger = eng.replay_with_ledger(recs, camp)
        for s in snaps:
            s["campaign_id"] = camp
            snap_f.write(json.dumps(s, ensure_ascii=False) + "\n")
        for e in ledger:
            e["campaign_id"] = camp
            ledg_f.write(json.dumps(e, ensure_ascii=False) + "\n")
        meta["n_snapshots"] += len(snaps)
        meta["n_ledger"] += len(ledger)
        meta["campaigns"][camp] = {
            "label": eng.cfg["campaigns"][camp].get("label", camp),
            "observation_count": len(snaps),
            "time_range": {"start": snaps[0]["ts"], "end": snaps[-1]["ts"]} if snaps else None,
        }
        print(f"  {camp:8} -> {len(snaps)} snapshots, {len(ledger)} ledger entries")
    snap_f.close(); ledg_f.close()

    json.dump(meta, open(os.path.join(cache_dir, "meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"stage2: {meta['n_snapshots']} snapshots, {meta['n_ledger']} ledger entries -> {cache_dir}")
    return meta
