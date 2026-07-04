"""Redis cache backend for the DELPHI inference cache.

옵션(env-gated). 미설정 시 store/recache 는 기존대로 로컬 JSONL 파일을 쓴다(fallback).
설정 시: recache 가 빌드한 cache/ 파일을 Redis에 올리고(publish), Store 가 Redis에서 읽는다(load)
→ API 서버가 stateless/다중 인스턴스로 동작.

지원 백엔드(우선순위):
  1) Upstash REST  — UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
     (Supabase 와 짝으로 자주 쓰이는 서버리스 Redis. requests 만 필요 — 이미 의존.)
  2) 표준 Redis     — REDIS_URL (redis://...)  (redis-py 필요)

Redis 키 구성:
  delphi:meta                -> JSON(meta)
  delphi:obs:{obs_id}        -> JSON(observations row)
  delphi:snaps:{campaign}    -> JSON(list of belief snapshots)
  delphi:ledger:{campaign}   -> JSON(list of ledger entries)
  delphi:abox:{obs_id}       -> JSON(A-Box record)
  delphi:campaigns           -> JSON(list of campaign ids)
"""
import json, os, glob
from app import settings as S


def enabled() -> bool:
    return bool(os.environ.get("UPSTASH_REDIS_REST_URL") and os.environ.get("UPSTASH_REDIS_REST_TOKEN")) \
        or bool(os.environ.get("REDIS_URL"))


# ── backend abstraction: _set(key,val), _get(key), _delete(*keys), _keys(pat) ──────────
def _upstash():
    import requests  # already a server dep
    base = os.environ["UPSTASH_REDIS_REST_URL"].rstrip("/")
    tok = os.environ["UPSTASH_REDIS_REST_TOKEN"]
    hdr = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    def cmd(*args):
        # Upstash single-command endpoint
        r = requests.post(f"{base}/{args[0]}", headers=hdr,
                          json=[*args[1:]] if len(args) > 1 else None, timeout=30)
        r.raise_for_status()
        return r.json().get("result")

    def pipeline(cmds):
        r = requests.post(f"{base}/pipeline", headers=hdr, json=[list(c) for c in cmds], timeout=60)
        r.raise_for_status()
        return [x.get("result") for x in r.json()]

    class _Upstash:
        def set(self, k, v): return cmd("SET", k, v)
        def get(self, k): return cmd("GET", k)
        def delete(self, *ks): return cmd("DEL", *ks) if ks else 0
        def keys(self, pat):
            res = cmd("KEYS", pat) or []
            return res if isinstance(res, list) else [res]
        pipelined_set = pipeline
    return _Upstash()


def _redislib():
    import redis  # optional dep (pip install redis)
    return redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)


def _client():
    if os.environ.get("UPSTASH_REDIS_REST_URL") and os.environ.get("UPSTASH_REDIS_REST_TOKEN"):
        return _upstash()
    if os.environ.get("REDIS_URL"):
        return _redislib()
    return None


# ── publish (recache → Redis) ─────────────────────────────────────────────────────────
def publish_cache(cache_dir=None):
    """cache/ 파일들을 Redis로 올린다. recache 완료 후 호출."""
    c = _client()
    if c is None:
        return False
    cd = cache_dir or S.CACHE_DIR
    snaps, ledger, obs, campaigns = {}, {}, {}, set()

    if os.path.exists(S.SNAPSHOTS):
        for line in open(S.SNAPSHOTS, encoding="utf-8"):
            s = json.loads(line)
            snaps.setdefault(s["campaign_id"], []).append(s)
            campaigns.add(s["campaign_id"])
    if os.path.exists(S.LEDGER):
        for line in open(S.LEDGER, encoding="utf-8"):
            e = json.loads(line)
            ledger.setdefault(e["campaign_id"], []).append(e)
            campaigns.add(e["campaign_id"])
    if os.path.exists(S.OBSERVATIONS):
        for line in open(S.OBSERVATIONS, encoding="utf-8"):
            o = json.loads(line)
            obs[o["obs_id"]] = o

    # wipe old delphi:* keys (clean republish)
    for k in c.keys("delphi:*"):
        c.delete(k)

    cmds = []
    # Upstash pipeline expects [op, *args]; redis-py pipeline uses .set chaining — 추상 단순화 위해 배치
    def put(k, v):
        c.set(k, json.dumps(v, ensure_ascii=False))
    for cid, lst in snaps.items():
        put(f"delphi:snaps:{cid}", lst)
    for cid, lst in ledger.items():
        put(f"delphi:ledger:{cid}", lst)
    for oid, row in obs.items():
        put(f"delphi:obs:{oid}", row)
    # A-Box (per-obs JSON files)
    if os.path.isdir(S.ABOX_DIR):
        for fp in glob.glob(os.path.join(S.ABOX_DIR, "*.json")):
            try:
                rec = json.load(open(fp, encoding="utf-8"))
                oid = rec.get("obs_id") or os.path.splitext(os.path.basename(fp))[0]
                put(f"delphi:abox:{oid}", rec)
            except Exception:
                pass
    if os.path.exists(S.META):
        put("delphi:meta", json.load(open(S.META, encoding="utf-8")))
    put("delphi:campaigns", sorted(campaigns))
    print(f"[cache_redis] published to Redis: campaigns={len(campaigns)} snaps={sum(len(v) for v in snaps.values())} "
          f"ledger={sum(len(v) for v in ledger.values())} obs={len(obs)}")
    return True


# ── load (Store ← Redis) ──────────────────────────────────────────────────────────────
def load_cache():
    """Redis에서 캐크를 읽어 Store 가 기대하는 dict 구조(snaps/ledger/observations/meta)로 반환."""
    c = _client()
    if c is None:
        return None
    snaps, ledger, observations = {}, {}, {}
    for cid in (json.loads(c.get("delphi:campaigns") or "[]")):
        raw = c.get(f"delphi:snaps:{cid}")
        if raw:
            snaps[cid] = json.loads(raw)
        raw = c.get(f"delphi:ledger:{cid}")
        if raw:
            ledger[cid] = json.loads(raw)
    for k in c.keys("delphi:obs:*"):
        observations[k.split("delphi:obs:", 1)[1]] = json.loads(c.get(k))
    meta = json.loads(c.get("delphi:meta") or "{}")
    return {"snaps": snaps, "ledger": ledger, "observations": observations, "meta": meta}
