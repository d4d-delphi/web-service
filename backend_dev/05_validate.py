#!/usr/bin/env python3
"""DELPHI Stage1 / 05 — acceptance checks -> reports/validation.txt (+stdout). CPU-only.
Usage: python3 05_validate.py
"""
import json, glob
from rdflib import Graph, Namespace, RDF, RDFS, Literal
from rdflib.namespace import XSD
from collections import Counter

DLP = Namespace("https://delphi.kr/onto#")
ABOX = "abox/delphi_abox.ttl"
TBOX = "onto/delphi_tbox_v0.2.ttl"
OBS = "data/observations.jsonl"
RECDIR = "data/abox_json"
NOVELTY = "data/novelty.jsonl"
FAIL = "data/failures.jsonl"
REPORT = "reports/validation.txt"

out = []
def P(s=""):
    print(s); out.append(s)

tb = Graph(); tb.parse(TBOX, format="turtle")
DEFINED = {str(s) for s in set(tb.subjects()) if str(s).startswith(str(DLP))}
def closure(root):
    seen = set(); frontier = [DLP[root]]
    while frontier:
        n = frontier.pop()
        for c in tb.subjects(RDFS.subClassOf, n):
            if c not in seen:
                seen.add(c); frontier.append(c)
    return {str(x).replace(str(DLP), "") for x in seen}
FAC, MOB, ACT, EMI = closure("Facility"), closure("MobileObject"), closure("Activity"), closure("Emission")
OBJV = FAC | MOB

rows = [json.loads(l) for l in open(OBS, encoding="utf-8")]
src_ids = [r["obs_id"] for r in rows]
res = {}

P("=" * 68); P("DELPHI Stage 1 — A-Box acceptance report"); P("=" * 68)

# 1 parse
try:
    g = Graph(); g.parse(ABOX, format="turtle"); res[1] = (True, f"parse OK, {len(g):,} triples")
except Exception as e:
    g = Graph(); res[1] = (False, f"parse FAILED: {e}")
P(f"\n[1] valid Turtle parse        : {'PASS' if res[1][0] else 'FAIL'}  ({res[1][1]})")

# 2 observations + records
obs_nodes = list(g.subjects(RDF.type, DLP.Observation))
derived = [str(o) for _, _, o in g.triples((None, DLP.derivedFrom, None))]
recs = {json.load(open(p, encoding="utf-8"))["obs_id"]: json.load(open(p, encoding="utf-8"))
        for p in glob.glob(f"{RECDIR}/*.json")}
REQ = {"obs_id", "collected_at", "polarity", "reliability_grade", "collection_asset",
       "location", "observed_objects", "observed_signals", "observed_activities", "novelty"}
schema_bad = [k for k, v in recs.items() if set(v.keys()) != REQ]
c2 = (len(obs_nodes) == 712 and set(derived) == set(src_ids) and len(derived) == 712
      and len(recs) == 712 and not schema_bad)
res[2] = (c2, f"TTL Observations={len(obs_nodes)}, derivedFrom unique-cover={set(derived)==set(src_ids)}, "
              f"per-obs records={len(recs)}/712 full-schema={not schema_bad}")
P(f"[2] 712 obs + uniform records : {'PASS' if c2 else 'FAIL'}  ({res[2][1]})")

# 3 undefined refs + banned vocab
undef = {str(t) for s, p, o in g for t in (p, o) if str(t).startswith(str(DLP)) and str(t) not in DEFINED}
used = sorted({str(o).replace(str(DLP), "") for _, _, o in g.triples((None, RDF.type, None))
              if str(o).startswith(str(DLP))})
banned = [c for c in used if any(b in c.lower() for b in
          ["state", "hypothesis", "evidence", "intent", "launch", "prepar", "readiness", "missile"])]
c3 = (len(undef) == 0 and not banned)
res[3] = (c3, f"undefined={len(undef)}, banned-vocab={banned or 'none'}")
P(f"[3] no undefined/intent vocab : {'PASS' if c3 else 'FAIL'}  ({res[3][1]})")
P(f"      classes used: {used}")

# 4 observed types in controlled vocab
viol = []
for s in obs_nodes:
    for pr, vocab in [(DLP.observedObject, OBJV), (DLP.observedSignal, EMI), (DLP.observedActivity, ACT)]:
        for _, _, node in g.triples((s, pr, None)):
            for t in g.objects(node, RDF.type):
                if str(t).replace(str(DLP), "") not in vocab:
                    viol.append(str(t))
c4 = len(viol) == 0
res[4] = (c4, f"violations {len(viol)}" + (f" {viol[:5]}" if viol else ""))
P(f"[4] observed types in vocab   : {'PASS' if c4 else 'FAIL'}  ({res[4][1]})")

# 5 routing integrity (via records)
def cnt(r):
    return (len(r["observed_objects"]), len(r["observed_signals"]), len(r["observed_activities"]))
nov_by = Counter(json.loads(l)["obs_id"] for l in open(NOVELTY, encoding="utf-8")) if glob.glob(NOVELTY) else Counter()
base_leak = [k for k, r in recs.items() if not next(x for x in rows if x["obs_id"] == k).get("unusual_flag")
             and (r["observed_signals"] or r["observed_activities"])]
unusual = [r for r in rows if r.get("unusual_flag")]
lost = [r["obs_id"] for r in unusual if sum(cnt(recs[r["obs_id"]])) == 0 and nov_by.get(r["obs_id"], 0) == 0]
base_with_obj = sum(1 for k, r in recs.items()
                    if not next(x for x in rows if x["obs_id"] == k).get("unusual_flag") and r["observed_objects"])
c5 = (not base_leak and not lost)
res[5] = (c5, f"baseline activity/signal leak={len(base_leak)}, unusual content-lost={len(lost)}, "
              f"baseline-with-standing-facility={base_with_obj}")
P(f"[5] routing integrity         : {'PASS' if c5 else 'FAIL'}  ({res[5][1]})")

# 6 ABSENT preserved
absent = [r for r in rows if r.get("polarity") == "ABSENT"]
ok = [r["obs_id"] for r in absent if any(
      (O, DLP.polarity, Literal("ABSENT", datatype=XSD.string)) in g
      for O in g.subjects(DLP.derivedFrom, Literal(r["obs_id"], datatype=XSD.string)))]
c6 = len(ok) == len(absent) and len(absent) >= 1
res[6] = (c6, f"source ABSENT {len(absent)} -> preserved {len(ok)}")
P(f"[6] polarity=ABSENT preserved : {'PASS' if c6 else 'FAIL'}  ({res[6][1]})")

# 7 novelty report
nov = [json.loads(l) for l in open(NOVELTY, encoding="utf-8")] if glob.glob(NOVELTY) else []
kc = Counter(n.get("kind") for n in nov)
res[7] = (True, f"novelty {len(nov)} {dict(kc)}")
P(f"[7] novelty report            : REPORT  ({res[7][1]})")
raws = Counter(n.get("raw") for n in nov if n.get("kind") == "object")
if raws:
    P(f"      top unmapped observed objects: {dict(raws.most_common(10))}")
nf = len(open(FAIL, encoding="utf-8").readlines()) if glob.glob(FAIL) else 0
P(f"\n  LLM parse failures quarantined: {nf}")

hard = [1, 2, 3, 4, 5, 6]
P("\n" + "=" * 68)
P(f"SUMMARY: hard checks (1-6) {'ALL PASS' if all(res[i][0] for i in hard) else 'HAS FAILURES'} | 7=novelty")
P("=" * 68)
open(REPORT, "w", encoding="utf-8").write("\n".join(out) + "\n")
print(f"\n-> wrote {REPORT}")
