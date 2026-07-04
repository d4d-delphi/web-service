#!/usr/bin/env python3
"""DELPHI Stage1 / 08 — self-contained interactive TIMELINE view of the unusual_flag=true observations.

Unlike the force graph (07), this lays the ontology out LEFT->RIGHT in chronological order (by collected_at):
each unusual observation is a column; its observed_objects / observed_signals / observed_activities hang below
it as typed ontology nodes. Hovering a class highlights every node of that class across time (temporal pattern);
clicking an observation opens a full detail panel. Offline, no CDN, sensitive data stays local.
Reads data/observations.jsonl (unusual flag + time) + data/abox_json/<obs_id>.json (mapped classes + novelty).
Usage: python3 08_timeline_html.py [output.html]
"""
import sys, json, glob, os

OUT = sys.argv[1] if len(sys.argv) > 1 else "graph/delphi_timeline.html"
rows = {json.loads(l)["obs_id"]: json.loads(l) for l in open("data/observations.jsonl", encoding="utf-8")}
recs = {json.load(open(p, encoding="utf-8"))["obs_id"]: json.load(open(p, encoding="utf-8"))
        for p in glob.glob("data/abox_json/*.json")}

ICON = {"SATELLITE_IMINT": "\U0001F6F0", "SIGINT": "\U0001F4E1", "UAV_FLIR": "✈",
        "OSINT": "\U0001F4C4", "AERIAL_IMINT": "✈"}

cols = []
for oid, r in rows.items():
    if not r.get("unusual_flag"):
        continue
    rec = recs.get(oid, {})
    cols.append({
        "obs_id": oid,
        "at": r.get("collected_at") or "",
        "date": (r.get("collected_at") or "")[:10],
        "time": (r.get("collected_at") or "")[11:16],
        "asset": r.get("asset_type"),
        "icon": ICON.get(r.get("asset_type"), "◉"),
        "platform": r.get("platform"),
        "loc": r.get("location_name") or r.get("mgrs") or "?",
        "mgrs": r.get("mgrs"),
        "polarity": r.get("polarity"),
        "reliability": r.get("reliability"),
        "objects": [{"type": o["type"], "count": o.get("count", 1)} for o in rec.get("observed_objects", [])],
        "signals": [s["type"] for s in rec.get("observed_signals", [])],
        "activities": [a["type"] for a in rec.get("observed_activities", [])],
        "novelty": [n.get("raw") for n in rec.get("novelty", []) if n.get("raw")],
        "desc": r.get("activity_desc") or "",
    })
cols.sort(key=lambda c: c["at"])

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
HTML = r"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DELPHI · unusual events timeline</title>
<style>
:root{--bg:#0e1116;--panel:#161b22;--ink:#e6edf3;--dim:#8b949e;--line:#2b313b;
  --obs:#e0af68;--obj:#bb9af7;--sig:#56d4c0;--act:#7ee787;--nov:#6e7681}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:5;background:linear-gradient(#0e1116,#0e1116f0);
  padding:12px 16px 8px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:15px;letter-spacing:.02em}
.sub{color:var(--dim);font-size:12px;margin-top:3px}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:12px}
.legend span{display:flex;align-items:center;gap:6px;color:var(--dim);cursor:default}
.dot{width:10px;height:10px;border-radius:50%}
.scroll{overflow-x:auto;overflow-y:auto;height:calc(100vh - 96px);padding:0 16px 40px}
.axis{display:flex;position:sticky;top:0;background:#0e1116;padding-top:10px;z-index:3}
.lane{display:flex;align-items:flex-start;gap:0;min-width:max-content;padding-top:4px}
.col{width:200px;flex:0 0 200px;padding:0 6px;position:relative}
.col.month0{border-left:1px dashed #343b46}
.mlabel{position:absolute;top:-2px;left:8px;font-size:10px;color:#6e7681;letter-spacing:.05em}
.obs{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--obs);
  border-radius:8px;padding:8px 9px;cursor:pointer;transition:.12s}
.obs:hover,.obs.sel{border-color:var(--obs);box-shadow:0 0 0 1px var(--obs)}
.obs .d{font-size:11px;color:var(--dim)}
.obs .ic{font-size:14px}.obs .loc{font-size:12px;margin-top:2px;font-weight:600;line-height:1.25}
.obs .meta{font-size:10.5px;color:var(--dim);margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.absent{color:#f7768e;border:1px solid #f7768e;border-radius:4px;padding:0 4px;font-size:9.5px}
.spine{width:2px;background:var(--line);margin:0 auto;height:12px}
.chip{display:flex;align-items:center;gap:6px;background:#12161c;border:1px solid var(--line);
  border-radius:6px;padding:4px 7px;margin:4px 0;font-size:12px;cursor:default;transition:.1s}
.chip .cd{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.chip.obj{border-left:2px solid var(--obj)}.chip.sig{border-left:2px solid var(--sig)}
.chip.act{border-left:2px solid var(--act)}
.chip .ct{font-size:10px;color:var(--dim);margin-left:auto}
.chip.hl{background:#1f2733;border-color:#e6edf3;box-shadow:0 0 0 1px #e6edf3}
.chip.dim{opacity:.28}
.nov{margin-top:5px;font-size:10.5px;color:var(--nov);cursor:pointer;border-top:1px dashed var(--line);padding-top:4px}
.empty{font-size:11px;color:#4d5560;font-style:italic;margin-top:6px}
#detail{position:fixed;top:96px;right:0;width:320px;max-height:calc(100vh - 110px);overflow:auto;
  background:rgba(22,27,34,.97);border:1px solid var(--line);border-radius:10px 0 0 10px;padding:14px;display:none;z-index:8}
#detail h2{margin:0 0 3px;font-size:14px}#detail .c{color:var(--dim);font-size:11px}
#detail table{width:100%;border-collapse:collapse;margin-top:8px}
#detail td{padding:3px 4px;border-top:1px solid var(--line);font-size:11.5px;vertical-align:top}
#detail td.k{color:#7dcfff;white-space:nowrap}#detail .close{float:right;cursor:pointer;color:var(--dim)}
#tip{position:fixed;pointer-events:none;background:#000d;border:1px solid var(--line);border-radius:6px;
  padding:4px 8px;font-size:11.5px;display:none;z-index:9;max-width:280px}
.badge{background:#21262d;border-radius:4px;padding:0 5px;font-size:10px}
</style></head><body>
<header>
  <h1>DELPHI · 특이관측 타임라인 (unusual events)</h1>
  <div class="sub" id="sub"></div>
  <div class="legend">
    <span><i class="dot" style="background:var(--obs)"></i>Observation</span>
    <span data-cat="obj"><i class="dot" style="background:var(--obj)"></i>Object(시설·이동체)</span>
    <span data-cat="sig"><i class="dot" style="background:var(--sig)"></i>Signal(방출)</span>
    <span data-cat="act"><i class="dot" style="background:var(--act)"></i>Activity(활동)</span>
    <span><i class="dot" style="background:var(--nov)"></i>novelty</span>
    <span style="margin-left:auto;color:#586069">← 좌: 이른 시각 · 우: 늦은 시각 →  (클래스 호버=시간축 하이라이트, 관측 클릭=상세)</span>
  </div>
</header>
<div class="scroll"><div class="lane" id="lane"></div></div>
<div id="detail"></div><div id="tip"></div>
<script>
const COLS = __DATA__;
const CATC = {obj:'var(--obj)',sig:'var(--sig)',act:'var(--act)'};
const lane=document.getElementById('lane'), tip=document.getElementById('tip'), detail=document.getElementById('detail');
document.getElementById('sub').textContent =
  `${COLS.length} unusual observations · ${COLS[0]?.date} → ${COLS[COLS.length-1]?.date}`;
function esc(s){return(s==null?'':s+'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
let prevMonth='';
COLS.forEach((c,i)=>{
  const col=document.createElement('div'); col.className='col';
  const mon=c.date.slice(0,7);
  if(mon!==prevMonth){col.classList.add('month0');
    const ml=document.createElement('div');ml.className='mlabel';ml.textContent=mon;col.appendChild(ml);prevMonth=mon;}
  const rel='●'.repeat(c.reliability||0)+'○'.repeat(Math.max(0,5-(c.reliability||0)));
  const obs=document.createElement('div');obs.className='obs';obs.dataset.i=i;
  obs.innerHTML=`<div class="d">${esc(c.date)} <span style="color:#586069">${esc(c.time)}</span></div>`+
    `<div><span class="ic">${c.icon}</span> <span class="loc">${esc(c.loc)}</span></div>`+
    `<div class="meta"><span class="badge">${esc(c.asset)}</span>`+
    (c.polarity==='ABSENT'?'<span class="absent">ABSENT</span>':'')+
    `<span title="reliability" style="color:#586069;font-size:9px">${rel}</span></div>`;
  obs.onclick=()=>showDetail(c,obs);
  col.appendChild(obs);
  const n=c.objects.length+c.signals.length+c.activities.length;
  if(n){col.appendChild(spine());}
  c.objects.forEach(o=>col.appendChild(chip('obj',o.type,'×'+o.count)));
  c.signals.forEach(t=>col.appendChild(chip('sig',t,'')));
  c.activities.forEach(t=>col.appendChild(chip('act',t,'')));
  if(!n){const e=document.createElement('div');e.className='empty';e.textContent='관측객체 없음 (novelty만)';col.appendChild(e);}
  if(c.novelty.length){const nv=document.createElement('div');nv.className='nov';
    nv.textContent=`+ novelty ${c.novelty.length}`;nv.onclick=()=>showDetail(c,obs);col.appendChild(nv);}
  lane.appendChild(col);
});
function spine(){const s=document.createElement('div');s.className='spine';return s;}
function chip(cat,type,ct){
  const d=document.createElement('div');d.className='chip '+cat;d.dataset.type=type;
  d.innerHTML=`<span class="cd" style="background:${CATC[cat]}"></span>${esc(type)}<span class="ct">${esc(ct)}</span>`;
  d.onmouseenter=e=>{highlight(type);tip.style.display='block';tip.innerHTML=`<b>${esc(type)}</b> — ${cat==='obj'?'관측객체':cat==='sig'?'방출':'활동'}`;move(e);};
  d.onmousemove=move;d.onmouseleave=()=>{highlight(null);tip.style.display='none';};
  return d;
}
function move(e){tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';}
function highlight(type){
  document.querySelectorAll('.chip').forEach(ch=>{
    ch.classList.remove('hl','dim');
    if(type){ch.classList.add(ch.dataset.type===type?'hl':'dim');}
  });
}
// legend hover -> highlight whole category
document.querySelectorAll('.legend [data-cat]').forEach(el=>{
  el.onmouseenter=()=>document.querySelectorAll('.chip').forEach(ch=>ch.classList.toggle('dim',!ch.classList.contains(el.dataset.cat)));
  el.onmouseleave=()=>document.querySelectorAll('.chip').forEach(ch=>ch.classList.remove('dim'));
});
function showDetail(c,el){
  document.querySelectorAll('.obs').forEach(o=>o.classList.remove('sel'));el.classList.add('sel');
  const rows=[['obs_id',c.obs_id],['collected_at',c.at],['polarity',c.polarity],['reliability',c.reliability],
    ['platform',c.platform],['mgrs',c.mgrs||'—'],['location',c.loc]];
  const objs=c.objects.map(o=>`${o.type}×${o.count}`).join(', ')||'—';
  const novs=c.novelty.map(n=>`<tr><td>${esc(n)}</td></tr>`).join('');
  detail.innerHTML=`<span class="close" onclick="detail.style.display='none'">✕</span>`+
    `<h2>${c.icon} ${esc(c.loc)}</h2><div class="c">${esc(c.date)} ${esc(c.time)} · ${esc(c.asset)}</div>`+
    `<table>${rows.map(r=>`<tr><td class="k">${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>`+
    `<table><tr><td class="k">objects</td><td>${esc(objs)}</td></tr>`+
    `<tr><td class="k">signals</td><td>${esc(c.signals.join(', ')||'—')}</td></tr>`+
    `<tr><td class="k">activities</td><td>${esc(c.activities.join(', ')||'—')}</td></tr></table>`+
    `<div class="c" style="margin-top:8px">activity_desc</div><div style="font-size:11.5px">${esc(c.desc)}</div>`+
    (novs?`<div class="c" style="margin-top:8px">novelty (${c.novelty.length})</div><table>${novs}</table>`:'');
  detail.style.display='block';
}
</script></body></html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML.replace("__DATA__", json.dumps(cols, ensure_ascii=False)))
print(f"timeline: {len(cols)} unusual observations "
      f"({cols[0]['date']} -> {cols[-1]['date']}) -> {OUT} ({os.path.getsize(OUT)//1024}KB)")
