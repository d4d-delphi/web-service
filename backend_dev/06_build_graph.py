#!/usr/bin/env python3
"""DELPHI Stage1 / 05 — build viewer-friendly merged RDF (T-Box + A-Box instances) with rdfs:label.

Outputs (graph/):
  delphi_full.ttl / .rdf    T-Box + ALL 712 observations + instances, human-readable labels
  delphi_sample.ttl / .rdf  T-Box + the 20 unusual observations only (clean first look in a graph viewer)
Labels are added ONLY in these viewer files; the canonical abox/delphi_abox.ttl stays label-free.
Usage: python3 05_build_graph.py
"""
import json, os
from rdflib import Graph, Namespace, Literal, URIRef, RDF, RDFS

DLP = Namespace("https://delphi.kr/onto#")
DLA = Namespace("https://delphi.kr/abox/")
TBOX = "onto/delphi_tbox_v0.2.ttl"
ABOX = "abox/delphi_abox.ttl"
OBS = "data/observations.jsonl"
OUTDIR = "graph"

by_id = {json.loads(l)["obs_id"]: json.loads(l) for l in open(OBS, encoding="utf-8")}

def local(u):
    return str(u).replace(str(DLP), "").replace(str(DLA), "")

def short_date(s):
    return (s or "")[:10]

def build(observation_filter=None):
    """observation_filter: set of obs_id to keep (None = all). Returns a labeled Graph (T-Box + selected)."""
    g = Graph(); g.parse(TBOX, format="turtle")
    a = Graph(); a.parse(ABOX, format="turtle")
    g.bind("dlp", DLP); g.bind("dla", DLA)

    # which Observation subjects to keep
    keep_obs = []
    for O in a.subjects(RDF.type, DLP.Observation):
        oid = str(O).replace(str(DLA) + "obs_", "")
        if observation_filter is None or oid in observation_filter:
            keep_obs.append((O, oid))

    kept_subjects = set()
    for O, oid in keep_obs:
        kept_subjects.add(O)
        # copy the Observation's own triples, and one hop out (asset, location, observed nodes)
        for p, o in a.predicate_objects(O):
            g.add((O, p, o))
            if isinstance(o, URIRef) and str(o).startswith(str(DLA)):
                kept_subjects.add(o)
                for p2, o2 in a.predicate_objects(o):
                    g.add((o, p2, o2))
                    if isinstance(o2, URIRef) and str(o2).startswith(str(DLA)):  # location -> cell
                        kept_subjects.add(o2)
                        for p3, o3 in a.predicate_objects(o2):
                            g.add((o2, p3, o3))

    # ── labels for readability ──
    for O, oid in keep_obs:
        r = by_id.get(oid, {})
        loc = r.get("location_name") or r.get("mgrs") or "?"
        lab = f"OBS · {r.get('asset_type','?')} · {loc} · {short_date(r.get('collected_at'))}"
        if r.get("polarity") == "ABSENT":
            lab = "[ABSENT] " + lab
        g.add((O, RDFS.label, Literal(lab)))

    for s in kept_subjects:
        if (s, RDFS.label, None) in g:
            continue
        types = [local(t) for t in g.objects(s, RDF.type)]
        if not types:
            continue
        t = types[0]
        plat = list(g.objects(s, DLP.platform))
        mg = list(g.objects(s, DLP.mgrs))
        cnt = list(g.objects(s, DLP["count"]))
        if plat:
            lab = f"{t} · {plat[0]}"
        elif mg:
            lab = f"MGRS · {mg[0]}"
        elif cnt:
            lab = f"{t} ×{cnt[0]}"
        else:
            lab = t
        g.add((s, RDFS.label, Literal(lab)))
    return g

os.makedirs(OUTDIR, exist_ok=True)

full = build(None)
full.serialize(destination=f"{OUTDIR}/delphi_full.ttl", format="turtle")
full.serialize(destination=f"{OUTDIR}/delphi_full.rdf", format="xml")

unusual_ids = {oid for oid, r in by_id.items() if r.get("unusual_flag")}
sample = build(unusual_ids)
sample.serialize(destination=f"{OUTDIR}/delphi_sample.ttl", format="turtle")
sample.serialize(destination=f"{OUTDIR}/delphi_sample.rdf", format="xml")

print(f"full  : {len(full):,} triples  ({sum(1 for _ in full.subjects(RDF.type, DLP.Observation))} observations)")
print(f"sample: {len(sample):,} triples  ({sum(1 for _ in sample.subjects(RDF.type, DLP.Observation))} observations)")
print(f"-> {OUTDIR}/delphi_full.ttl | delphi_full.rdf | delphi_sample.ttl | delphi_sample.rdf")
