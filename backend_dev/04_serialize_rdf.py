#!/usr/bin/env python3
"""DELPHI Stage1 / 04 — serialize the 712 uniform A-Box JSON records -> abox/delphi_abox.ttl (rdflib, CPU).

Reads data/abox_json/*.json (produced by 03; already vocab-validated) and emits deterministic Turtle:
URIs by sha1, platform/location dedup, class/property refs checked against the T-Box. Also writes the
T-Box+A-Box merge (abox/delphi_full.ttl).
Usage: python3 04_serialize_rdf.py
"""
import json, os, glob, hashlib
from rdflib import Graph, Namespace, Literal, URIRef, RDF, RDFS
from rdflib.namespace import XSD

DLP = Namespace("https://delphi.kr/onto#")
DLA = Namespace("https://delphi.kr/abox/")
RECDIR = "data/abox_json"
TBOX = "onto/delphi_tbox_v0.2.ttl"
OUT = "abox/delphi_abox.ttl"
FULL = "abox/delphi_full.ttl"

def sha(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]

tb = Graph(); tb.parse(TBOX, format="turtle")
DEFINED = {str(s) for s in set(tb.subjects()) if str(s).startswith(str(DLP))}
def cls_ok(name):
    return name and (str(DLP) + name) in DEFINED

recs = [json.load(open(p, encoding="utf-8")) for p in sorted(glob.glob(f"{RECDIR}/*.json"))]

g = Graph()
g.bind("dlp", DLP); g.bind("dla", DLA); g.bind("rdfs", RDFS); g.bind("xsd", XSD)
n_obs = n_oo = n_os = n_oa = 0

for r in recs:
    oid = r["obs_id"]
    O = URIRef(str(DLA) + "obs_" + oid)
    g.add((O, RDF.type, DLP.Observation))
    g.add((O, DLP.derivedFrom, Literal(oid, datatype=XSD.string)))
    if r.get("collected_at"):
        g.add((O, DLP.collectedAt, Literal(r["collected_at"], datatype=XSD.dateTime)))
    if r.get("polarity"):
        g.add((O, DLP.polarity, Literal(r["polarity"], datatype=XSD.string)))
    if r.get("reliability_grade") is not None:
        g.add((O, DLP.reliabilityGrade, Literal(int(r["reliability_grade"]), datatype=XSD.integer)))

    ca = r.get("collection_asset") or {}
    plat, acls = ca.get("platform"), ca.get("type")
    if plat and cls_ok(acls):
        A = URIRef(str(DLA) + "asset_" + sha(plat))
        g.add((A, RDF.type, DLP[acls]))
        g.add((A, DLP.platform, Literal(plat, datatype=XSD.string)))
        g.add((O, DLP.collectedBy, A))

    lo = r.get("location") or {}
    named, mgrs = lo.get("named"), lo.get("mgrs"); cell = None
    if mgrs:
        cell = URIRef(str(DLA) + "cell_" + sha(mgrs))
        g.add((cell, RDF.type, DLP.MGRSCell))
        g.add((cell, DLP.mgrs, Literal(mgrs, datatype=XSD.string)))
    if named:
        L = URIRef(str(DLA) + "loc_" + sha(named))
        g.add((L, RDF.type, DLP.NamedLocation))
        g.add((L, RDFS.label, Literal(named)))
        if cell is not None:
            g.add((L, DLP.withinCell, cell))
        g.add((O, DLP.atLocation, L))
    elif cell is not None:
        g.add((O, DLP.atLocation, cell))

    for i, o in enumerate(r.get("observed_objects") or []):
        if not cls_ok(o.get("type")):
            continue
        node = URIRef(str(DLA) + oid + f"_oo{i}")
        g.add((node, RDF.type, DLP[o["type"]]))
        g.add((node, DLP["count"], Literal(int(o.get("count", 1)), datatype=XSD.integer)))
        g.add((node, DLP.spuqUncertainty, Literal(o.get("spuq", 0.2), datatype=XSD.double)))
        g.add((O, DLP.observedObject, node)); n_oo += 1
    for i, o in enumerate(r.get("observed_signals") or []):
        if not cls_ok(o.get("type")):
            continue
        node = URIRef(str(DLA) + oid + f"_os{i}")
        g.add((node, RDF.type, DLP[o["type"]]))
        g.add((node, DLP.spuqUncertainty, Literal(o.get("spuq", 0.2), datatype=XSD.double)))
        g.add((O, DLP.observedSignal, node)); n_os += 1
    for i, o in enumerate(r.get("observed_activities") or []):
        if not cls_ok(o.get("type")):
            continue
        node = URIRef(str(DLA) + oid + f"_oa{i}")
        g.add((node, RDF.type, DLP[o["type"]]))
        g.add((node, DLP.spuqUncertainty, Literal(o.get("spuq", 0.2), datatype=XSD.double)))
        g.add((O, DLP.observedActivity, node)); n_oa += 1
    n_obs += 1

os.makedirs("abox", exist_ok=True)
g.serialize(destination=OUT, format="turtle")
full = Graph(); full.parse(TBOX, format="turtle")
for t in g:
    full.add(t)
full.bind("dlp", DLP); full.bind("dla", DLA)
full.serialize(destination=FULL, format="turtle")

print(f"Observation {n_obs}  observedObject {n_oo}  observedSignal {n_os}  observedActivity {n_oa}")
print(f"{len(g)} triples -> {OUT}")
print(f"merged {len(full)} triples -> {FULL}")
