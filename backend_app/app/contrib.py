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

        # per-(obs, type, target) effective dB — feeds the evidence-type intermediate layer of
        # the graph. axis rows are static; stage rows are decayed to the snapshot time below.
        type_rows = []

        # ── hypothesis contributions (static axes, no decay) ──
        obs_axis = {}
        for e in L:
            if e["target_kind"] != "axis":
                continue
            obs_axis.setdefault(e["obs_id"], {}).setdefault(e["target_name"], 0.0)
            obs_axis[e["obs_id"]][e["target_name"]] += e["db"]
            type_rows.append(dict(obs_id=e["obs_id"], type=e["type"],
                                  kind="axis", name=e["target_name"], db=e["db"]))
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
        #  obs_stage keeps the per-(obs, stage) residual so the influence graph can
        #  draw a distinct edge into each of s1/s2/s3; obs_launch is the per-obs sum.
        obs_launch = {}
        obs_stage = {}
        for e in L:
            if e["target_kind"] != "stage":
                continue
            d = self.stages[e["target_name"]].get("decay_per_day", 1.0)
            gap = (snap_t - datetime.fromisoformat(e["ts"])).total_seconds() / 86400.0
            residual = e["db"] * (d ** gap)
            rec = obs_launch.setdefault(e["obs_id"], dict(residual=0.0, stages=set()))
            rec["residual"] += residual
            rec["stages"].add(e["target_name"])
            obs_stage.setdefault(e["obs_id"], {}).setdefault(e["target_name"], 0.0)
            obs_stage[e["obs_id"]][e["target_name"]] += residual
            type_rows.append(dict(obs_id=e["obs_id"], type=e["type"],
                                  kind="stage", name=e["target_name"], db=residual))
        launch_items = [dict(obs_id=oid, residual_db=round(v["residual"], 2), stages=sorted(v["stages"]))
                        for oid, v in obs_launch.items()]
        launch_items.sort(key=lambda x: -x["residual_db"])

        return dict(
            timestamp=snap["ts"], seq=snap["seq"],
            hypotheses={k: round(v, 4) for k, v in snap["PH"].items()},
            p_launch=round(snap["p_launch"], 4),
            hypothesis_contributions=hyp_contrib,
            launch_contributions=launch_items[:topn],
            graph=self._graph(snap, obs_stage, obs_axis, type_rows, topn),
        )

    def _graph(self, snap, obs_stage, obs_axis, type_rows, topn):
        """Faithful influence graph at the query time, ready to render as a Sankey:
        observations -> evidence types -> {stages s1/s2/s3 | axes fuel/range} -> {p_* | PH}.

        The A-Box evidence type is the actual mechanism: `likelihood_db` is keyed by type, so
        each observation's dB flows obs -> type -> {stage | axis}. We expose that decomposition
        (obs_type / type_stage / type_axis edges), plus the collapsed obs->stage / obs->axis
        edges for callers that don't render the type layer.

        - obs->{type,stage,axis} weights: stage = leaky residual (decayed), axis = static.
        - stage->output and axis->hypothesis wiring is structural (from config) and is
          reconstructed on the frontend from `outputs[].expr` and the axis pos/neg labels.
        Only the top-N observations by absolute total influence are included, so the graph
        stays legible and the payload bounded.
        """
        obs_ids = set(obs_stage) | set(obs_axis)

        def influence(o):
            return abs(sum(obs_stage.get(o, {}).values())) + abs(sum(obs_axis.get(o, {}).values()))

        top = sorted(obs_ids, key=influence, reverse=True)[:topn]
        top_set = set(top)

        # decompose through the evidence-type layer, restricted to the shown observations so the
        # obs->type flow and the type->target flow stay consistent (a readable Sankey).
        obs_type, type_stage, type_axis, type_net = {}, {}, {}, {}
        for r in type_rows:
            if r["obs_id"] not in top_set:
                continue
            t = r["type"]
            obs_type.setdefault((r["obs_id"], t), 0.0)
            obs_type[(r["obs_id"], t)] += r["db"]
            type_net[t] = type_net.get(t, 0.0) + r["db"]
            tgt = type_stage if r["kind"] == "stage" else type_axis
            tgt.setdefault((t, r["name"]), 0.0)
            tgt[(t, r["name"])] += r["db"]

        return dict(
            stages=[dict(name=sg, prob=round(snap["stage"][sg], 4),
                         prior_db=self.stages[sg].get("prior_db", 0)) for sg in self.stages],
            axes=[dict(name=ax, prob=round(snap["axis_prob"][ax], 4),
                       pos=self.axes[ax]["positive_label"], neg=self.axes[ax]["negative_label"])
                  for ax in self.axes],
            outputs=[dict(name=name, value=round(snap.get(name, 0.0), 4), expr=spec["expr"])
                     for name, spec in self.outputs.items()],
            hypotheses=[dict(label=k, prob=round(v, 4)) for k, v in snap["PH"].items()],
            obs=[dict(obs_id=o,
                      launch_db=round(sum(obs_stage.get(o, {}).values()), 2),
                      axis_db=round(sum(obs_axis.get(o, {}).values()), 2)) for o in top],
            types=[dict(name=t, db=round(v, 2)) for t, v in sorted(type_net.items(), key=lambda x: -abs(x[1]))
                   if abs(v) > 1e-9],
            obs_type_edges=[dict(obs_id=o, type=t, db=round(v, 2))
                            for (o, t), v in obs_type.items() if abs(v) > 1e-9],
            type_stage_edges=[dict(type=t, stage=sg, residual_db=round(v, 2))
                              for (t, sg), v in type_stage.items() if abs(v) > 1e-9],
            type_axis_edges=[dict(type=t, axis=ax, db=round(v, 2))
                             for (t, ax), v in type_axis.items() if abs(v) > 1e-9],
            stage_edges=[dict(obs_id=o, stage=sg, residual_db=round(v, 2))
                         for o, sd in obs_stage.items() if o in top_set
                         for sg, v in sd.items() if abs(v) > 1e-9],
            axis_edges=[dict(obs_id=o, axis=ax, db=round(v, 2))
                        for o, ad in obs_axis.items() if o in top_set
                        for ax, v in ad.items() if abs(v) > 1e-9],
        )
