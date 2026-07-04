#!/usr/bin/env python3
"""DELPHI Stage1 / 02 — classify unusual_flag=true rows with Qwen (few-shot) -> data/llm_cache/<obs_id>.json.

Only the ~20 unusual rows reach the LLM (baseline is deterministic in 03). Idempotent/resumable:
cached obs_id are skipped; parse failures quarantined to data/failures.jsonl.
Model loads ONCE here (~3.5 min FP8 kernel warmup + ~40s inference). Everything downstream is CPU-only.
Usage: TRITON_PTXAS_PATH=/usr/local/cuda-13.0/bin/ptxas python3 02_classify_unusual.py [BATCH]
"""
import os, sys, json, time
import qwen_client as qc

OBS = "data/observations.jsonl"
CACHE = "data/llm_cache"
FAIL = "data/failures.jsonl"
BATCH = int(sys.argv[1]) if len(sys.argv) > 1 else 8

os.makedirs(CACHE, exist_ok=True)
rows = [json.loads(l) for l in open(OBS, encoding="utf-8")]
targets = [r for r in rows if r.get("unusual_flag")]
pending = [r for r in targets if not os.path.exists(f"{CACHE}/{r['obs_id']}.json")]
print(f"unusual=true {len(targets)} / cached {len(targets)-len(pending)} / to-process {len(pending)}  "
      f"(baseline {len(rows)-len(targets)} handled deterministically in 03)", flush=True)
if not pending:
    print("all cached — done."); sys.exit(0)

t0 = time.time(); done = failed = 0
for s in range(0, len(pending), BATCH):
    chunk = pending[s:s+BATCH]
    results, raws = qc.classify_batch(chunk)
    for r, out, raw in zip(chunk, results, raws):
        if out is None:
            failed += 1
            with open(FAIL, "a", encoding="utf-8") as f:
                f.write(json.dumps({"obs_id": r["obs_id"], "raw": (raw or "")[:2000]}, ensure_ascii=False) + "\n")
            continue
        with open(f"{CACHE}/{r['obs_id']}.json", "w", encoding="utf-8") as f:
            json.dump({"obs_id": r["obs_id"], "llm": out}, f, ensure_ascii=False)
        done += 1
    print(f"  {s+len(chunk)}/{len(pending)}  ok={done} fail={failed}  {time.time()-t0:.0f}s", flush=True)

print(f"\ndone: ok {done} / fail {failed} / {time.time()-t0:.0f}s", flush=True)
