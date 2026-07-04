"""Stage 1 (cache build) — Supabase observation -> A-Box JSON.

fetch_observations()  : Supabase REST -> cache/observations.jsonl               (network, no GPU)
classify_unusual()    : unusual rows -> LLM (Qwen) -> cache/llm_cache/           (GPU, few-shot)
build_abox_json()     : deterministic 712 uniform §5.2 records -> cache/abox_json (CPU)

Only classify_unusual() needs a GPU. The recache --reuse-abox path skips ALL of Stage 1 and copies the
already-computed backend_dev A-Box instead (never re-runs the local LLM).
"""
import os, sys, json, glob, hashlib
from app import settings as S

ASSET = {"SATELLITE_IMINT": "SatelliteIMINT", "AERIAL_IMINT": "AerialIMINT",
         "SIGINT": "SigintCollector", "UAV_FLIR": "UAVSensor", "OSINT": "OsintSource"}
OBJ_MAP = {
    "test_stand": "EngineTestStand", "engine_test_stand": "EngineTestStand",
    "production_hall": "ProductionComplex", "construction_hall": "ProductionComplex",
    "gantry_tower": "GantryTower", "runway": "Airfield",
    "support_vehicle": "SupportVehicle", "security_vehicle": "SecurityVehicle",
    "trailer": "Trailer", "large_trailer": "Trailer", "long_train_formation": "RailCar",
}


def _sha(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]


def _spuq(row):
    base = {5: 0.05, 4: 0.10, 3: 0.20, 2: 0.35, 1: 0.50}.get(row.get("reliability"), 0.25)
    ad = row.get("asset_detail") or {}
    if row.get("asset_type") == "SATELLITE_IMINT" and isinstance(ad, dict):
        base += min(0.2, (ad.get("cloud_cover_pct") or 0) / 1000.0)
    if row.get("asset_type") == "SIGINT" and isinstance(ad, dict) and ad.get("signal_strength") == "Low":
        base += 0.10
    return round(min(base, 0.9), 3)


def fetch_observations(out_path=None):
    import requests
    out_path = out_path or S.OBSERVATIONS
    if not S.SUPABASE_SERVICE_KEY:
        sys.exit("SUPABASE_SERVICE_KEY unset — export it or use --reuse-abox")
    H = {"apikey": S.SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {S.SUPABASE_SERVICE_KEY}"}
    rows, step, off = [], 1000, 0
    while True:
        r = requests.get(f"{S.SUPABASE_URL.rstrip('/')}/rest/v1/observation",
                         headers={**H, "Range-Unit": "items", "Range": f"{off}-{off+step-1}"},
                         params={"select": "*", "order": "collected_at.asc"}, timeout=60)
        r.raise_for_status(); batch = r.json(); rows += batch
        if len(batch) < step:
            break
        off += step
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        for x in rows:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    print(f"stage1.fetch: {len(rows)} observations -> {out_path}")
    return rows


def classify_unusual(obs_path=None, cache_dir=None, batch=8):
    import pipeline.qwen_client as qc
    obs_path = obs_path or S.OBSERVATIONS
    cache_dir = cache_dir or os.path.join(S.CACHE_DIR, "llm_cache")
    os.makedirs(cache_dir, exist_ok=True)
    rows = [json.loads(l) for l in open(obs_path, encoding="utf-8")]
    pending = [r for r in rows if r.get("unusual_flag")
               and not os.path.exists(os.path.join(cache_dir, r["obs_id"] + ".json"))]
    print(f"stage1.classify: {len(pending)} unusual rows to LLM (GPU)")
    for i in range(0, len(pending), batch):
        chunk = pending[i:i+batch]
        results, _ = qc.classify_batch(chunk)
        for r, out in zip(chunk, results):
            if out is not None:
                json.dump({"obs_id": r["obs_id"], "llm": out},
                          open(os.path.join(cache_dir, r["obs_id"] + ".json"), "w", encoding="utf-8"),
                          ensure_ascii=False)


def build_abox_json(obs_path=None, llm_dir=None, abox_dir=None):
    obs_path = obs_path or S.OBSERVATIONS
    llm_dir = llm_dir or os.path.join(S.CACHE_DIR, "llm_cache")
    abox_dir = abox_dir or S.ABOX_DIR
    os.makedirs(abox_dir, exist_ok=True)
    rows = [json.loads(l) for l in open(obs_path, encoding="utf-8")]
    llm = {json.load(open(p, encoding="utf-8"))["obs_id"]: json.load(open(p, encoding="utf-8"))["llm"]
           for p in glob.glob(os.path.join(llm_dir, "*.json"))}
    from rdflib import Graph, Namespace, RDFS
    DLP = Namespace("https://delphi.kr/onto#")
    tb = Graph(); tb.parse(S.TBOX_PATH, format="turtle")
    def closure(root):
        seen = set(); frontier = [DLP[root]]
        while frontier:
            n = frontier.pop()
            for c in tb.subjects(RDFS.subClassOf, n):
                if c not in seen:
                    seen.add(c); frontier.append(c)
        return {str(x).replace(str(DLP), "") for x in seen}
    OBJV = closure("Facility") | closure("MobileObject")
    ACT, EMI = closure("Activity"), closure("Emission")

    n = 0
    for row in rows:
        oid = row["obs_id"]; sp = _spuq(row); rec = {
            "obs_id": oid, "collected_at": row.get("collected_at"), "polarity": row.get("polarity"),
            "reliability_grade": row.get("reliability"),
            "collection_asset": {"type": ASSET.get(row.get("asset_type")), "platform": row.get("platform")},
            "location": {"named": row.get("location_name"), "mgrs": row.get("mgrs")},
            "observed_objects": [], "observed_signals": [], "observed_activities": [], "novelty": []}
        if not row.get("unusual_flag"):
            for so in (row.get("observed_objects") or []):
                m = OBJ_MAP.get(so.get("type"))
                if m and m in OBJV:
                    rec["observed_objects"].append({"type": m, "count": so.get("count", 1), "spuq": sp})
                else:
                    rec["novelty"].append({"kind": "object", "raw": so.get("type"), "count": so.get("count", 1)})
        else:
            cl = llm.get(oid) or {}
            for o in cl.get("observed_objects", []):
                t = o.get("type") if isinstance(o, dict) else None
                if t in OBJV:
                    rec["observed_objects"].append({"type": t, "count": o.get("count", 1), "spuq": sp})
                elif t:
                    rec["novelty"].append({"kind": "object", "raw": t, "count": o.get("count", 1)})
            for t in cl.get("observed_signals", []):
                (rec["observed_signals"].append({"type": t, "spuq": sp}) if t in EMI
                 else rec["novelty"].append({"kind": "signal", "raw": t}))
            for t in cl.get("observed_activities", []):
                (rec["observed_activities"].append({"type": t, "spuq": sp}) if t in ACT
                 else rec["novelty"].append({"kind": "activity", "raw": t}))
            for nv in cl.get("novelty", []):
                if nv:
                    rec["novelty"].append({"kind": "note", "raw": nv})
        json.dump(rec, open(os.path.join(abox_dir, oid + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
        n += 1
    print(f"stage1.build_abox: {n} records -> {abox_dir}")
