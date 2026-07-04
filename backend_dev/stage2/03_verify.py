#!/usr/bin/env python3
"""DELPHI Stage2 / 03 — acceptance checks (§5) on the unha3 anchor -> reports/stage2_verify.txt.
Counts are dataset-dependent (our Stage-1 data, not the prototype's 608); the QUALITATIVE anchor
pattern (liquid·long-range argmax, quiet<0.05, comms-surge stage-decomposition, launch-window>0.95,
fuel/range persistence, determinism, config-swappability) is what must hold.
Usage: python3 03_verify.py
"""
import json, copy, yaml
from delphi_inference_engine import Engine, load_abox_observations

out = []
def P(s=""):
    print(s); out.append(s)

eng = Engine("delphi_config.yaml")
recs = load_abox_observations("../data/abox_json/*.json")
snaps, _ = eng.replay(recs, "unha3")
res = {}

def in_window(ts, a, b):
    return a <= ts[:10] <= b

P("=" * 66); P("DELPHI Stage 2 — inference acceptance (anchor: unha3)"); P("=" * 66)

# 1 snapshot count == routed obs, seq unique+monotonic
routed = [r for r in recs if eng.campaign_of(r["loc"]) == "unha3"]
seqs = [s["seq"] for s in snaps]
c1 = (len(snaps) == len(routed) and seqs == list(range(1, len(snaps) + 1)))
res[1] = (c1, f"snapshots={len(snaps)} == routed unha3 obs={len(routed)}, seq 1..N monotonic-unique={seqs==list(range(1,len(snaps)+1))}")
P(f"\n[1] snapshot count / seq      : {'PASS' if c1 else 'FAIL'}  ({res[1][1]})")

# 2 final argmax P(H) == 액체·장거리
fin = snaps[-1]
top = max(fin["PH"], key=fin["PH"].get)
c2 = (top == "액체·장거리" and 0.80 <= fin["PH"][top] <= 0.95)
res[2] = (c2, f"argmax='{top}' P={fin['PH'][top]:.3f} (expect 액체·장거리 ~0.85-0.92)")
P(f"[2] final P(H) argmax          : {'PASS' if c2 else 'FAIL'}  ({res[2][1]})")

# 3 launch curve: quiet<0.05, 4/18 comms-surge<0.10, launch window(7/8-15)>0.95
quiet = [s for s in snaps if in_window(s["ts"], "2026-03-01", "2026-06-30")]
quiet_max = max((s["p_launch"] for s in quiet), default=0)
surge = [s for s in snaps if in_window(s["ts"], "2026-04-18", "2026-04-18")
         and "CommunicationSurge" in s["items"]]
surge_pl = max((s["p_launch"] for s in surge), default=None)
window = [s for s in snaps if in_window(s["ts"], "2026-07-08", "2026-07-15")]
window_max = max((s["p_launch"] for s in window), default=0)
c3 = (quiet_max < 0.05 and (surge_pl is not None and surge_pl < 0.10) and window_max > 0.95)
res[3] = (c3, f"quiet-max={quiet_max:.3f}(<0.05), 4/18 surge P(launch)={surge_pl if surge_pl is None else round(surge_pl,3)}(<0.10), "
              f"launch-window-max={window_max:.3f}(>0.95)")
P(f"[3] launch curve shape         : {'PASS' if c3 else 'FAIL'}  ({res[3][1]})")

# 4 fuel/range persistence at final
c4 = (0.85 <= fin["axis_prob"]["fuel"] <= 0.95 and fin["axis_prob"]["range"] > 0.95)
res[4] = (c4, f"P(액체)={fin['axis_prob']['fuel']:.3f}(~0.90), P(장거리)={fin['axis_prob']['range']:.3f}(>0.95)")
P(f"[4] fuel/range persistence     : {'PASS' if c4 else 'FAIL'}  ({res[4][1]})")

# 5 stage discrimination at 4/18: s2_pad high OR s3_imminent low
if surge:
    ss = surge[-1]["stage"]
    c5 = (ss["s2_pad"] > 0.7 or ss["s3_imminent"] < 0.05)
    res[5] = (c5, f"4/18 s2_pad={ss['s2_pad']:.3f}, s3_imminent={ss['s3_imminent']:.3f} (want s2>0.7 or s3<0.05)")
else:
    c5 = False; res[5] = (False, "no 4/18 comms-surge snapshot found")
P(f"[5] stage discrimination(4/18) : {'PASS' if c5 else 'FAIL'}  ({res[5][1]})")

# 6 determinism: replay twice, bitwise-identical
snaps2, _ = eng.replay(recs, "unha3")
c6 = json.dumps(snaps, sort_keys=True, ensure_ascii=False) == json.dumps(snaps2, sort_keys=True, ensure_ascii=False)
res[6] = (c6, f"two replays identical={c6}")
P(f"[6] determinism                : {'PASS' if c6 else 'FAIL'}  ({res[6][1]})")

# 7 config swappability: add a stage in config (no code change) -> engine runs, snapshot carries it
cfg2 = copy.deepcopy(eng.cfg)
cfg2["stages"]["s4_test"] = {"prior_db": -10, "decay_per_day": 0.9, "likelihood_db": {"TelemetryEmission": +10}}
open("_tmp_cfg.yaml", "w", encoding="utf-8").write(yaml.safe_dump(cfg2, allow_unicode=True))
try:
    eng2 = Engine("_tmp_cfg.yaml")
    s2, _ = eng2.replay(recs, "unha3")
    c7 = ("s4_test" in s2[-1]["stage"])
    res[7] = (c7, f"added stage s4_test via config only -> present in snapshot={c7}")
except Exception as e:
    c7 = False; res[7] = (False, f"config swap failed: {e}")
import os
os.path.exists("_tmp_cfg.yaml") and os.remove("_tmp_cfg.yaml")
P(f"[7] config swappability        : {'PASS' if c7 else 'FAIL'}  ({res[7][1]})")

# signal-bearing trace (like the engine demo)
P("\n--- unha3 signal-bearing snapshots (trace) ---")
P("date        P(launch) P(act)  s1   s2   s3   argmaxH        items")
for s in snaps:
    if s["is_signal"]:
        t = max(s["PH"], key=s["PH"].get)
        P(f"{s['ts'][:10]}  {s['p_launch']:.2f}     {s['p_activity']:.2f}   "
          f"{s['stage']['s1_early']:.2f} {s['stage']['s2_pad']:.2f} {s['stage']['s3_imminent']:.2f}   "
          f"{t:<12} {s['PH'][t]:.2f}  {','.join(s['items'])}")

P("\n" + "=" * 66)
P(f"SUMMARY: {'ALL 7 PASS' if all(res[i][0] for i in range(1,8)) else 'HAS FAILURES: '+str([i for i in range(1,8) if not res[i][0]])}")
P("=" * 66)
open("reports/stage2_verify.txt", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n-> reports/stage2_verify.txt")
