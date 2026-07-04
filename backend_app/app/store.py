"""In-memory cache store for the API. Loads Stage-2 artifacts (snapshots, ledger, observations) and
answers queries via ContribEngine — no GPU/LLM, just read + join + sort. Hot-reloadable after recache.
"""
import json, os
from collections import defaultdict
from app.contrib import ContribEngine
from app import settings as S

SOURCE_FIELDS = ["obs_id", "collected_at", "asset_type", "location_name",
                 "activity_desc", "reliability", "platform", "analyst_unit"]


class Store:
    def __init__(self):
        self.reload()

    def reload(self):
        self.engine = ContribEngine(S.CONFIG_PATH)
        self.snaps = defaultdict(list)
        self.ledger = defaultdict(list)
        self.observations = {}
        self.meta = {}
        if os.path.exists(S.SNAPSHOTS):
            for l in open(S.SNAPSHOTS, encoding="utf-8"):
                s = json.loads(l); self.snaps[s["campaign_id"]].append(s)
        for c in self.snaps:
            self.snaps[c].sort(key=lambda s: s["ts"])
        if os.path.exists(S.LEDGER):
            for l in open(S.LEDGER, encoding="utf-8"):
                e = json.loads(l); self.ledger[e["campaign_id"]].append(e)
        if os.path.exists(S.OBSERVATIONS):
            for l in open(S.OBSERVATIONS, encoding="utf-8"):
                o = json.loads(l); self.observations[o["obs_id"]] = o
        if os.path.exists(S.META):
            self.meta = json.load(open(S.META, encoding="utf-8"))
        return self

    # ---- endpoints backing ----
    def campaigns(self):
        out = []
        for cid, m in (self.meta.get("campaigns") or {}).items():
            out.append({"campaign_id": cid, "label": m.get("label", cid),
                        "observation_count": m.get("observation_count", len(self.snaps.get(cid, []))),
                        "time_range": m.get("time_range")})
        return out

    def has_campaign(self, cid):
        return cid in self.snaps

    def _source(self, obs_id, full=False):
        row = self.observations.get(obs_id)
        if row is None:
            return {"obs_id": obs_id, "_missing": True}
        if full:
            return row
        return {k: row.get(k) for k in SOURCE_FIELDS}

    def inference(self, campaign_id, at, top_n=8, include_source=True):
        r = self.engine.query(self.snaps[campaign_id], self.ledger[campaign_id], at, topn=top_n)
        if r is None:
            return None
        if include_source:
            for lst in r["hypothesis_contributions"].values():
                for it in lst:
                    it["source"] = self._source(it["obs_id"])
            for it in r["launch_contributions"]:
                it["source"] = self._source(it["obs_id"])
        return {"campaign_id": campaign_id, **r}

    def series(self, campaign_id, frm=None, to=None, fields=None):
        fields = fields or ["p_launch", "hypotheses"]
        out = []
        for s in self.snaps[campaign_id]:
            if frm and s["ts"] < frm:
                continue
            if to and s["ts"] > to:
                continue
            item = {"timestamp": s["ts"], "seq": s["seq"]}
            for f in fields:
                if f == "hypotheses":
                    item["hypotheses"] = {k: round(v, 4) for k, v in s["PH"].items()}
                elif f in s:
                    item[f] = s[f]
                elif f in s.get("stage", {}):
                    item[f] = s["stage"][f]
                elif f in s.get("axis_prob", {}):
                    item[f] = s["axis_prob"][f]
            if s.get("is_signal"):
                item["is_signal"] = True
                item["items"] = s.get("items", [])
            out.append(item)
        return out

    def observation(self, obs_id):
        return self._source(obs_id, full=True) if obs_id in self.observations else None


store = Store()
