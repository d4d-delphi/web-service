#!/usr/bin/env python3
"""DELPHI Stage1 — Qwen classification client (few-shot). Reuses MISP/behavior-events Qwen runtime.

Model: Qwen/Qwen3.5-27B-FP8 (in-process transformers; TRITON_PTXAS_PATH=cuda13 + fla + enable_thinking=False).
Runs ONLY on unusual_flag=true rows. For each it extracts the FULL observed content:
  observed_objects (facilities + mobile objects, mapped from BOTH structured observed_objects AND the
  free-text activity_desc nouns), observed_signals (SIGINT emissions), observed_activities, and novelty.
Baseline rows never reach the LLM (03 handles them deterministically in the same schema).

Principle 0.1 still holds: classify observed FORM/MOTION/EMISSION only — no intent/purpose/state/capability.
Few-shot examples below encode the exact mapping policy so recall is high AND classes stay controlled.
Greedy decode -> reproducible. Prompt is English; Korean input preserved verbatim in novelty.
"""
import os, sys, json, re

os.environ.setdefault("TRITON_PTXAS_PATH", "/usr/local/cuda-13.0/bin/ptxas")
MODEL = "Qwen/Qwen3.5-27B-FP8"
DEV = "cuda"
MAX_NEW = 360

FACILITY = ["LaunchPad", "EngineTestStand", "ProductionComplex", "SubmarineBase",
            "NuclearTestSite", "Airfield", "GantryTower"]
MOBILE = ["Transporter", "TEL", "Trailer", "RailCar", "PropellantVehicle",
          "OxidizerVehicle", "SecurityVehicle", "SupportVehicle"]
ACTIVITY = ["VehicleMassing", "ObjectMovement", "StructureWork", "CommunicationSurge",
            "AreaClosure", "PersonnelActivity", "SignalActivation"]
EMISSION = ["CommsEmission", "RadarEmission", "TelemetryEmission"]

SYS = (
    "You are a TRANSLATOR that maps a Korean military observation report into a fixed ontology observation "
    "vocabulary. You RELABEL observed facts only — you never judge, infer intent/purpose/capability/state, "
    "and never output notions like 'launch imminent', 'nuclear-test prep', 'missile', 'weaponization'.\n\n"
    "Extract observed_objects from BOTH the structured observed_objects list AND concrete nouns in "
    "activity_desc. Map to the controlled classes below. Recall matters: map every vehicle/facility that has "
    "a reasonable class. Only genuinely unclassifiable things (static containers, cables, cranes, fences, "
    "camouflage, buildings with no specific class, submarines, boat_basin, tunnel_portal) go to novelty.\n\n"
    f"[Facility]     {', '.join(FACILITY)}\n"
    f"[MobileObject] {', '.join(MOBILE)}\n"
    f"[Activity]     {', '.join(ACTIVITY)}\n"
    f"[Emission]     {', '.join(EMISSION)}\n\n"
    "[Object mapping rules]\n"
    " - test_stand/engine_test_stand/엔진시험대 -> EngineTestStand ; production_hall/construction_hall/생산홀/건조동 -> ProductionComplex\n"
    " - gantry_tower/갠트리 -> GantryTower ; runway/활주로 -> Airfield\n"
    " - 트레일러/운반트레일러/트레일러 화물차/large_trailer -> Trailer ; 편성 열차/열차/long_train_formation -> RailCar\n"
    " - 이동식발사대/TEL -> TEL ; 운반차/transporter -> Transporter\n"
    " - EXPLICIT fuel/propellant object (연료차/추진제차량/연료 운반차/연료통/추진제 탱크/연료 탱크/propellant) -> "
    "PropellantVehicle ; explicit oxidizer object (산화제차/산화제 탱크/oxidizer) -> OxidizerVehicle. "
    "Fire ONLY when the object itself carries a 연료/추진제/산화제/fuel/propellant/oxidizer keyword.\n"
    " - 보안차량/security_vehicle -> SecurityVehicle\n"
    " - generic vehicles/trucks with NO stated fuel role (차량/vehicle/유개트럭/무개트럭/화물차/소형차량/백색차량/버스/지원차량) "
    "-> SupportVehicle. NEVER upgrade a generic 차량 to PropellantVehicle/OxidizerVehicle from location, "
    "facility name, or nearby context — a plain '차량 N대' stays SupportVehicle even at a launch/propellant site.\n"
    " - NOT vehicles -> novelty: 케이블, 크레인, 굴착/계측 장비, 위장막, 울타리, 건물, "
    "submarine, boat_basin(선거), tunnel_portal(갱도), mobile_radar\n\n"
    "[Activity rules] many vehicles massed -> VehicleMassing ; moved/deployed/relocated -> ObjectMovement ; "
    "built/worked/renovated/covered/cleared -> StructureWork ; comms-traffic surge NOW -> CommunicationSurge ; "
    "area closed/NOTAM warning zone -> AreaClosure ; many personnel -> PersonnelActivity ; "
    "radar/telemetry/signal emitting NOW -> SignalActivation. Past-context events -> not an activity. "
    "Baseline -> [].\n"
    "[Emission] Decide from emitter_guess AND signal_params (measured facts):\n"
    "   voice/무전망/통신망/traffic_level -> CommsEmission ; PRI/PW/Scan(pulsed radar params) -> RadarEmission ;\n"
    "   PCM/FM modulation or wide continuous bandwidth(>1000kHz)/continuous data stream/텔레메트리 -> TelemetryEmission.\n"
    "   If emitter_guess is 미상/unknown, classify from signal_params. Background/nominal -> [].\n\n"
    "[Output] EXACTLY ONE JSON object, no prose/markdown:\n"
    '{"observed_objects":[{"type":"<class>","count":<int>}],"observed_signals":["<Emission>"],'
    '"observed_activities":["<Activity>"],"novelty":["<raw Korean phrase, out-of-vocab observations>"]}'
)

# ── Few-shot exemplars (encode the mapping policy with correct outputs) ──
FEWSHOT = [
 ("collection_asset: SATELLITE_IMINT\n"
  "observed_objects: gantry_tower x1, security_vehicle x1, flame_trench_cover x1\n"
  "activity_desc (Korean): 발사대 갠트리 타워 작업대, 발사대 상단부 전개 상태. 갠트리 내부 차폐. 화염구 덮개 1기 식별. 발사대 하단, 소형 차량 4대 식별.",
  '{"observed_objects":[{"type":"GantryTower","count":1},{"type":"SecurityVehicle","count":1},{"type":"SupportVehicle","count":4}],'
  '"observed_signals":[],"observed_activities":["ObjectMovement","StructureWork","VehicleMassing"],'
  '"novelty":["화염구 덮개 1기(flame trench cover)","갠트리 내부 차폐"]}'),

 ("collection_asset: SIGINT\n"
  "asset_detail (signal): {\"frequency_band\":\"S-Band\",\"emitter_guess\":\"협대역 텔레메트리\"}\n"
  "activity_desc (Korean): 동창리 발사장 방향, 협대역 하향 텔레메트리 계열 방출 포착. 연속 데이터 스트림 패턴 식별.",
  '{"observed_objects":[],"observed_signals":["TelemetryEmission"],"observed_activities":["SignalActivation"],'
  '"novelty":["협대역 하향 연속 데이터 스트림 패턴"]}'),

 ("collection_asset: SATELLITE_IMINT\n"
  "observed_objects: long_train_formation x1\n"
  "activity_desc (Korean): 룡성 지도부 전용역 캐노피 승강장, 대형 편성 열차 1편 정차 식별. 승강장 캐노피 일부 차폐. 인근 정비구역 차량 다수 식별.",
  '{"observed_objects":[{"type":"RailCar","count":1},{"type":"SupportVehicle","count":1}],"observed_signals":[],'
  '"observed_activities":["VehicleMassing"],"novelty":["승강장 캐노피 차폐"]}'),

 ("collection_asset: OSINT\n"
  "activity_desc (Korean): 항공고시보(NOTAM) 발행. 1단 낙탄구역 : 발사지 정남 약 480km. 2단 낙탄구역 : 발사지 정남 약 2500km. 유효시간 2026.7.8. 04:00~08:00(UTC).",
  '{"observed_objects":[],"observed_signals":[],"observed_activities":["AreaClosure"],'
  '"novelty":["1단 낙탄구역 정남 480km","2단 낙탄구역 정남 2500km","유효시간 2026.7.8 04:00~08:00 UTC"]}'),

 ("collection_asset: SATELLITE_IMINT\n"
  "observed_objects: submarine x1, boat_basin x1, construction_hall x1, test_stand x1, heavy_crane x1\n"
  "activity_desc (Korean): 보안 항만, 잠수함 1척 식별. 대형 크레인 함교 인근 배치. 건조동 3동 전면 장비·인원 식별. 시험대 인근 굴착 장비 1식 식별.",
  '{"observed_objects":[{"type":"ProductionComplex","count":1},{"type":"EngineTestStand","count":1}],"observed_signals":[],'
  '"observed_activities":["PersonnelActivity","ObjectMovement"],'
  '"novelty":["잠수함 1척(submarine)","boat_basin(선거)","대형 크레인(heavy crane)","굴착 장비(excavator)"]}'),

 ("collection_asset: SATELLITE_IMINT\n"
  "observed_objects: large_trailer x2, cylindrical_load x2\n"
  "activity_desc (Korean): 수평조립건물 지원구역, 대형 운반트레일러 2대 식별. 트레일러 상부 원통형 적재물 1기씩 식별.",
  '{"observed_objects":[{"type":"Trailer","count":2}],"observed_signals":[],"observed_activities":["ObjectMovement"],'
  '"novelty":["원통형 적재물 2기(cylindrical load)","수평조립건물 지원구역"]}'),

 # explicit fuel container -> PropellantVehicle ; generic minibus/truck -> SupportVehicle (NOT propellant)
 ("collection_asset: SATELLITE_IMINT\n"
  "observed_objects: engine_test_stand x1, support_building x2, control_building x1\n"
  "activity_desc (Korean): 엔진시험장 시험대 인근, 3m 연료통 1기, 미상 케이블 다수, 인원 3명 식별. 지원건물 인근, 미니버스 1대, 7m 유개트럭 1대 식별.",
  '{"observed_objects":[{"type":"EngineTestStand","count":1},{"type":"PropellantVehicle","count":1},{"type":"SupportVehicle","count":2}],'
  '"observed_signals":[],"observed_activities":["PersonnelActivity","ObjectMovement"],'
  '"novelty":["미상 케이블 다수","지원건물/제어건물(support/control building)"]}'),

 # 'propellant' only in the location/facility name, objects are generic -> stay SupportVehicle (no inference)
 ("collection_asset: SATELLITE_IMINT\n"
  "observed_objects: building x1, vehicle x1\n"
  "activity_desc (Korean): 저장동 양측, 인원 다수 및 차량 활동 식별. 발사대 하부, 차량 3대 식별.",
  '{"observed_objects":[{"type":"SupportVehicle","count":3}],"observed_signals":[],'
  '"observed_activities":["PersonnelActivity","ObjectMovement"],"novelty":["저장동(building)"]}'),
]


def build_user(row):
    lines = [f"collection_asset: {row.get('asset_type')}"]
    oo = row.get("observed_objects") or []
    if oo:
        lines.append("observed_objects: " + ", ".join(f"{o.get('type')} x{o.get('count',1)}" for o in oo))
    ad = row.get("asset_detail") or {}
    if row.get("asset_type") == "SIGINT" and isinstance(ad, dict):
        sig = {k: ad.get(k) for k in ("frequency_band", "emitter_guess", "signal_params",
                                      "signal_strength", "ew_status") if ad.get(k) is not None}
        if sig:
            lines.append("asset_detail (signal): " + json.dumps(sig, ensure_ascii=False))
    lines.append(f"activity_desc (Korean): {row.get('activity_desc') or ''}")
    return "\n".join(lines)


_JSON_RE = re.compile(r"\{.*\}", re.S)
def parse_json(text):
    if not text:
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    text = re.sub(r"```(json)?", "", text).strip()
    m = _JSON_RE.search(text)
    if not m:
        return None
    frag = m.group(0); depth = 0; end = None
    for i, ch in enumerate(frag):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1; break
    if end:
        frag = frag[:end]
    try:
        o = json.loads(frag)
        return o if isinstance(o, dict) else None
    except Exception:
        return None


_TOK = _MODEL = None
def load():
    global _TOK, _MODEL
    if _MODEL is not None:
        return _TOK, _MODEL
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    print(f"[qwen] loading {MODEL} ...", flush=True)
    t = AutoTokenizer.from_pretrained(MODEL)
    if t.pad_token is None:
        t.pad_token = t.eos_token
    t.padding_side = "left"
    m = AutoModelForCausalLM.from_pretrained(MODEL, device_map=DEV, dtype="auto").eval()
    _TOK, _MODEL = t, m
    print("[qwen] loaded", flush=True)
    return t, m


def _messages(row, extra=""):
    msgs = [{"role": "system", "content": SYS}]
    for u, a in FEWSHOT:
        msgs.append({"role": "user", "content": u})
        msgs.append({"role": "assistant", "content": a})
    msgs.append({"role": "user", "content": build_user(row) + extra})
    return msgs

def _prompt(row, extra=""):
    tok, _ = load()
    return tok.apply_chat_template(_messages(row, extra), tokenize=False,
                                   add_generation_prompt=True, enable_thinking=False)

def _generate(prompts):
    import torch
    tok, model = load()
    enc = tok(prompts, return_tensors="pt", add_special_tokens=False, padding=True).to(DEV)
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=MAX_NEW, do_sample=False, pad_token_id=tok.pad_token_id)
    plen = enc["input_ids"].shape[1]
    return [tok.decode(out[i, plen:], skip_special_tokens=True).strip() for i in range(out.shape[0])]

def classify_batch(rows):
    raws = _generate([_prompt(r) for r in rows])
    results = [parse_json(t) for t in raws]
    retry = [i for i, r in enumerate(results) if r is None]
    if retry:
        rraw = _generate([_prompt(rows[i], "\n\nOutput MUST be exactly one valid JSON object.") for i in retry])
        for j, i in enumerate(retry):
            results[i] = parse_json(rraw[j]); raws[i] = rraw[j]
    return results, raws


if __name__ == "__main__":
    rows = [json.loads(l) for l in open("data/observations.jsonl", encoding="utf-8")]
    unusual = [r for r in rows if r.get("unusual_flag")]
    res, _ = classify_batch(unusual)
    import collections
    oc = collections.Counter()
    for r, out in zip(unusual, res):
        for o in (out or {}).get("observed_objects", []): oc[o.get("type")] += 1
        print(f"\n[{r['asset_type']}] {r['obs_id'][:8]} :: {(r.get('activity_desc') or '')[:60]}")
        print("  ", json.dumps(out, ensure_ascii=False) if out else "PARSE-FAIL")
    print("\n[observed_objects classes]", dict(oc))
