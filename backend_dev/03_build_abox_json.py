#!/usr/bin/env python3
"""DELPHI Stage1 / 03 — build UNIFORM full-schema A-Box JSON for ALL 712 observations (CPU-only, no model).

Every observation (baseline AND unusual) gets the SAME §5.2 record:
  {obs_id, collected_at, polarity, reliability_grade, collection_asset{type,platform}, location{named,mgrs},
   observed_objects[{type,count,spuq}], observed_signals[{type,spuq}], observed_activities[{type,spuq}], novelty[]}
- baseline (unusual=false): deterministic. observed_objects from structured jsonb via OBJ_MAP; signals/activities [].
- unusual  (unusual=true): from the LLM cache (data/llm_cache), validated against the T-Box controlled vocab.
All types re-validated against the T-Box here; anything out-of-vocab -> novelty (A-Box stays clean by construction).
Usage: python3 03_build_abox_json.py
"""
import json, os, glob
from rdflib import Graph, Namespace, RDFS

DLP = Namespace("https://delphi.kr/onto#")
OBS = "data/observations.jsonl"
LLM = "data/llm_cache"
TBOX = "onto/delphi_tbox_v0.2.ttl"
OUTDIR = "data/abox_json"
NOVELTY = "data/novelty.jsonl"

ASSET = {"SATELLITE_IMINT": "SatelliteIMINT", "AERIAL_IMINT": "AerialIMINT",
         "SIGINT": "SigintCollector", "UAV_FLIR": "UAVSensor", "OSINT": "OsintSource"}

# deterministic structured-type -> class table (baseline rows). Site-level sub-features -> novelty.
OBJ_MAP = {
    "test_stand": "EngineTestStand", "engine_test_stand": "EngineTestStand",
    "production_hall": "ProductionComplex", "construction_hall": "ProductionComplex",
    "gantry_tower": "GantryTower", "runway": "Airfield",
    "support_vehicle": "SupportVehicle", "security_vehicle": "SecurityVehicle",
    "trailer": "Trailer", "large_trailer": "Trailer", "long_train_formation": "RailCar",
}

# controlled-vocab sets from the T-Box (single source of truth)
tb = Graph(); tb.parse(TBOX, format="turtle")
def closure(root):
    seen = set(); frontier = [DLP[root]]
    while frontier:
        n = frontier.pop()
        for c in tb.subjects(RDFS.subClassOf, n):
            if c not in seen:
                seen.add(c); frontier.append(c)
    return {str(x).replace(str(DLP), "") for x in seen}
FACILITY, MOBILE = closure("Facility"), closure("MobileObject")
ACTIVITY, EMISSION = closure("Activity"), closure("Emission")
OBJ_VOCAB = FACILITY | MOBILE

def spuq(row):
    base = {5: 0.05, 4: 0.10, 3: 0.20, 2: 0.35, 1: 0.50}.get(row.get("reliability"), 0.25)
    ad = row.get("asset_detail") or {}
    if row.get("asset_type") == "SATELLITE_IMINT" and isinstance(ad, dict):
        base += min(0.2, (ad.get("cloud_cover_pct") or 0) / 1000.0)
    if row.get("asset_type") == "SIGINT" and isinstance(ad, dict) and ad.get("signal_strength") == "Low":
        base += 0.10
    return round(min(base, 0.9), 3)

rows = [json.loads(l) for l in open(OBS, encoding="utf-8")]
llm = {}
for p in glob.glob(f"{LLM}/*.json"):
    r = json.load(open(p, encoding="utf-8")); llm[r["obs_id"]] = r["llm"]

os.makedirs(OUTDIR, exist_ok=True)
all_novelty = []
stat = {"baseline": 0, "unusual": 0, "unusual_llm_missing": 0, "oo": 0, "os": 0, "oa": 0, "nov": 0}

for row in rows:
    oid = row["obs_id"]; sp = spuq(row); unusual = bool(row.get("unusual_flag"))
    rec = {
        "obs_id": oid,
        "collected_at": row.get("collected_at"),
        "polarity": row.get("polarity"),
        "reliability_grade": row.get("reliability"),
        "collection_asset": {"type": ASSET.get(row.get("asset_type")), "platform": row.get("platform")},
        "location": {"named": row.get("location_name"), "mgrs": row.get("mgrs")},
        "observed_objects": [], "observed_signals": [], "observed_activities": [], "novelty": [],
    }
    nov = rec["novelty"]

    if not unusual:
        stat["baseline"] += 1
        for so in (row.get("observed_objects") or []):
            raw_t = so.get("type"); cnt = so.get("count", 1)
            mapped = OBJ_MAP.get(raw_t)
            if mapped and mapped in OBJ_VOCAB:
                rec["observed_objects"].append({"type": mapped, "count": cnt, "spuq": sp})
            else:
                nov.append({"kind": "object", "raw": raw_t, "count": cnt})
    else:
        stat["unusual"] += 1
        cl = llm.get(oid)
        if cl is None:
            stat["unusual_llm_missing"] += 1
        else:
            for o in (cl.get("observed_objects") or []):
                t = o.get("type") if isinstance(o, dict) else None
                cnt = o.get("count", 1) if isinstance(o, dict) else 1
                if t in OBJ_VOCAB:
                    rec["observed_objects"].append({"type": t, "count": cnt, "spuq": sp})
                elif t:
                    nov.append({"kind": "object", "raw": t, "count": cnt})
            for t in (cl.get("observed_signals") or []):
                if t in EMISSION:
                    rec["observed_signals"].append({"type": t, "spuq": sp})
                elif t:
                    nov.append({"kind": "signal", "raw": t})
            for t in (cl.get("observed_activities") or []):
                if t in ACTIVITY:
                    rec["observed_activities"].append({"type": t, "spuq": sp})
                elif t:
                    nov.append({"kind": "activity", "raw": t})
            for n in (cl.get("novelty") or []):
                if n:
                    nov.append({"kind": "note", "raw": n})

    stat["oo"] += len(rec["observed_objects"]); stat["os"] += len(rec["observed_signals"])
    stat["oa"] += len(rec["observed_activities"]); stat["nov"] += len(nov)
    for n in nov:
        all_novelty.append({"obs_id": oid, **n})
    with open(f"{OUTDIR}/{oid}.json", "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False)

with open(NOVELTY, "w", encoding="utf-8") as f:
    for n in all_novelty:
        f.write(json.dumps(n, ensure_ascii=False) + "\n")

print(f"records {len(rows)} -> {OUTDIR}/  (baseline {stat['baseline']}, unusual {stat['unusual']}, "
      f"unusual LLM-missing {stat['unusual_llm_missing']})")
print(f"observed_objects {stat['oo']}  observed_signals {stat['os']}  observed_activities {stat['oa']}  "
      f"novelty {stat['nov']} -> {NOVELTY}")
