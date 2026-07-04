"""DELPHI contribution ledger + reverse-attribution (기여도 역산).

- hypothesis contribution = static-axis increment (naive Bayes, no decay).
- P(launch) contribution   = stage increment discounted to the query time (leaky residual).
Each contribution is attributed to the obs_id that produced it -> joins back to the source row.

replay_with_ledger() is used by the recache pipeline (persists snaps + ledger).
query() is used by the API at request time (reads persisted snaps + ledger, no GPU).
"""
import itertools
from datetime import datetime
from .engine import Engine


class ContribEngine(Engine):
    def replay_with_ledger(self, observations, campaign):
        obs = sorted([o for o in observations if self.campaign_of(o["loc"]) == campaign],
                     key=lambda x: x["collected_at"])
        state = self.init_state(campaign)
        snaps, ledger = [], []
        for o in obs:
            ev = self.observation_to_event(o); ev["obs_id"] = o["obs_id"]
            state, snap = self.step(state, ev)
            snap["obs_id"] = o["obs_id"]
            lam = self.lam.get(ev["r"], 0.75); pol = ev["pol"]
            for tp in ev["types"]:
                if tp == "NoChange":
                    continue
                for ax, spec in self.axes.items():
                    db = pol * lam * spec["likelihood_db"].get(tp, 0)
                    if db != 0:
                        ledger.append(dict(obs_id=o["obs_id"], ts=ev["ts"], type=tp,
                                           target_kind="axis", target_name=ax, db=db))
                for sg, spec in self.stages.items():
                    db = pol * lam * spec["likelihood_db"].get(tp, 0)
                    if db != 0:
                        ledger.append(dict(obs_id=o["obs_id"], ts=ev["ts"], type=tp,
                                           target_kind="stage", target_name=sg, db=db))
            snaps.append(snap)
        return snaps, ledger

    def query(self, snaps, ledger, T, topn=8):
        """Timestamp T -> latest snapshot at/before T + reverse-attributed contributions.
        snaps: list of snapshot dicts (with PH, p_launch, seq, ts, obs_id).
        ledger: list of {obs_id, ts, type, target_kind, target_name, db}.
        """
        Tdt = datetime.fromisoformat(T) if isinstance(T, str) else T
        cand = [s for s in snaps if datetime.fromisoformat(s["ts"]) <= Tdt]
        if not cand:
            return None
        snap = cand[-1]; snap_t = datetime.fromisoformat(snap["ts"])
        L = [e for e in ledger if datetime.fromisoformat(e["ts"]) <= snap_t]

        # ── hypothesis contributions (static axes, no decay) ──
        obs_axis = {}
        for e in L:
            if e["target_kind"] != "axis":
                continue
            obs_axis.setdefault(e["obs_id"], {}).setdefault(e["target_name"], 0.0)
            obs_axis[e["obs_id"]][e["target_name"]] += e["db"]
        axkeys = list(self.axes.keys())
        hyp_contrib = {}
        for combo in itertools.product([True, False], repeat=len(axkeys)):
            label = "·".join(self.axes[ax]["positive_label"] if pos else self.axes[ax]["negative_label"]
                             for ax, pos in zip(axkeys, combo))
            items = []
            for oid, axd in obs_axis.items():
                c = sum(axd.get(ax, 0.0) * (1 if pos else -1) for ax, pos in zip(axkeys, combo))
                if abs(c) > 1e-9:
                    items.append(dict(obs_id=oid, contribution_db=round(c, 2)))
            items.sort(key=lambda x: -x["contribution_db"])
            hyp_contrib[label] = items[:topn]

        # ── P(launch) contributions (stage residual, decayed to snapshot time) ──
        obs_launch = {}
        for e in L:
            if e["target_kind"] != "stage":
                continue
            d = self.stages[e["target_name"]].get("decay_per_day", 1.0)
            gap = (snap_t - datetime.fromisoformat(e["ts"])).total_seconds() / 86400.0
            residual = e["db"] * (d ** gap)
            rec = obs_launch.setdefault(e["obs_id"], dict(residual=0.0, stages=set()))
            rec["residual"] += residual
            rec["stages"].add(e["target_name"])
        launch_items = [dict(obs_id=oid, residual_db=round(v["residual"], 2), stages=sorted(v["stages"]))
                        for oid, v in obs_launch.items()]
        launch_items.sort(key=lambda x: -x["residual_db"])

        return dict(
            timestamp=snap["ts"], seq=snap["seq"],
            hypotheses={k: round(v, 4) for k, v in snap["PH"].items()},
            p_launch=round(snap["p_launch"], 4),
            hypothesis_contributions=hyp_contrib,
            launch_contributions=launch_items[:topn],
        )
