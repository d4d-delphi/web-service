"""DELPHI inference engine (config-driven) — validated Stage-2 core.

Reads delphi_config.yaml only. step(state, event) -> (state', snapshot) is a pure function;
replay is deterministic/idempotent. No GPU/LLM — pure arithmetic over Stage-1 A-Box instances.
"""
import math
import yaml
from datetime import datetime


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


DB = math.log(10) / 10.0          # deciban -> natural log-odds


class Engine:
    def __init__(self, config_path):
        self.cfg = yaml.safe_load(open(config_path, encoding="utf-8"))
        self.facilities = set(self.cfg.get("facility_classes", []))
        self.lam = {int(k): v for k, v in self.cfg.get("reliability_lambda", {}).items()}
        self.axes = self.cfg["static_axes"]
        self.stages = self.cfg["stages"]
        self.outputs = self.cfg["outputs"]

    def campaign_of(self, location):
        for name, c in self.cfg["campaigns"].items():
            if location is None:
                if c.get("match_null_location"):
                    return name
                continue
            if any(k in location for k in c.get("match_any", [])):
                return name
        return "other"

    def init_state(self, campaign=None):
        st = {"axis": {}, "stage": {}, "last_ts": None, "seq": 0}
        override = {}
        if campaign and campaign in self.cfg["campaigns"]:
            override = self.cfg["campaigns"][campaign].get("prior_override", {})
        for ax, spec in self.axes.items():
            st["axis"][ax] = spec.get("prior_db", 0) + override.get(ax, 0)
        for sg, spec in self.stages.items():
            st["stage"][sg] = spec.get("prior_db", 0)
        return st

    def observation_to_event(self, obs):
        items = []
        for o in obs.get("objs", []):
            if o in self.facilities:
                continue                      # facility presence emits nothing
            items.append(o)
        items += obs.get("sigs", []) + obs.get("acts", [])
        return dict(types=items or ["NoChange"],
                    pol=obs.get("polarity", +1), r=int(obs.get("reliability", 4)),
                    ts=obs["collected_at"])

    def step(self, state, event):
        st = {"axis": dict(state["axis"]), "stage": dict(state["stage"]),
              "last_ts": state["last_ts"], "seq": state["seq"] + 1}
        t = datetime.fromisoformat(event["ts"])
        if st["last_ts"] is not None:
            gap = max((t - datetime.fromisoformat(st["last_ts"])).total_seconds() / 86400.0, 0.0)
            for sg, spec in self.stages.items():
                prior = spec.get("prior_db", 0); d = spec.get("decay_per_day", 1.0)
                st["stage"][sg] = prior + (d ** gap) * (st["stage"][sg] - prior)
        st["last_ts"] = event["ts"]
        lam = self.lam.get(event["r"], 0.75); pol = event["pol"]
        for tp in event["types"]:
            for ax, spec in self.axes.items():
                st["axis"][ax] += pol * lam * spec["likelihood_db"].get(tp, 0)
            for sg, spec in self.stages.items():
                st["stage"][sg] += pol * lam * spec["likelihood_db"].get(tp, 0)
        return st, self.snapshot(st, event)

    def snapshot(self, st, event):
        axprob = {ax: sigmoid(st["axis"][ax] * DB) for ax in self.axes}
        PH = self._combine_hypotheses(axprob)
        s = {sg: sigmoid(st["stage"][sg] * DB) for sg in self.stages}
        outs = {name: eval(spec["expr"], {"__builtins__": {}}, s) for name, spec in self.outputs.items()}
        return dict(seq=st["seq"], ts=event["ts"], axis_prob=axprob, PH=PH, stage=s, **outs,
                    is_signal=event["types"] != ["NoChange"],
                    items=[x for x in event["types"] if x != "NoChange"])

    def _combine_hypotheses(self, axprob):
        import itertools
        axes = list(self.axes.keys())
        PH = {}
        for combo in itertools.product([True, False], repeat=len(axes)):
            p = 1.0; label = []
            for ax, pos in zip(axes, combo):
                p *= axprob[ax] if pos else (1 - axprob[ax])
                label.append(self.axes[ax]["positive_label"] if pos else self.axes[ax]["negative_label"])
            PH["·".join(label)] = p
        return PH

    def replay(self, observations, campaign):
        obs = sorted([o for o in observations if self.campaign_of(o["loc"]) == campaign],
                     key=lambda x: x["collected_at"])
        state = self.init_state(campaign)
        snaps = []
        for o in obs:
            state, snap = self.step(state, self.observation_to_event(o))
            snaps.append(snap)
        return snaps, state


def load_abox_observations(abox_glob):
    """Stage-1 A-Box JSON -> observation dicts consumed by the engine."""
    import glob, json
    recs = []
    for f in glob.glob(abox_glob):
        d = json.load(open(f, encoding="utf-8"))
        gl = lambda k: [(x.get("type") if isinstance(x, dict) else x) for x in d.get(k, [])]
        recs.append(dict(obs_id=d["obs_id"], collected_at=d["collected_at"],
            polarity=(+1 if d.get("polarity", "PRESENT") == "PRESENT" else -1),
            reliability=d.get("reliability_grade", 4),
            loc=(d.get("location") or {}).get("named"),
            objs=gl("observed_objects"), sigs=gl("observed_signals"), acts=gl("observed_activities")))
    return recs
