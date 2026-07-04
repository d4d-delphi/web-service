#!/usr/bin/env python3
"""DELPHI Stage2 / 04 — self-contained interactive TIME-AXIS chart of the inference output.

Reads belief_snapshot.jsonl and plots how each probability evolves as observations arrive, in small
multiples sharing one time axis: [Outputs] p_launch/p_activity · [Stages] s1/s2/s3 · [Static axes]
P(액체)/P(장거리)/P(H 액체·장거리). Vertical markers at signal-bearing events (with their items) span all
panels so you see which event moved which curve. Crosshair tooltip reads every value at a timestamp.
Offline, no CDN, theme-aware. Palette validated via the dataviz skill (8 categorical slots).
Usage: python3 04_belief_timeline_html.py [output.html]
"""
import sys, json, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else "reports/belief_timeline.html"
by_camp = collections.defaultdict(list)
for l in open("belief_snapshot.jsonl", encoding="utf-8"):
    s = json.loads(l)
    by_camp[s["campaign_id"]].append({
        "t": s["ts"], "pl": round(s["p_launch"], 4), "pa": round(s["p_activity"], 4),
        "s1": round(s["stage"]["s1_early"], 4), "s2": round(s["stage"]["s2_pad"], 4),
        "s3": round(s["stage"]["s3_imminent"], 4),
        "fu": round(s["axis_prob"]["fuel"], 4), "ra": round(s["axis_prob"]["range"], 4),
        "ph": round(s["PH"].get("액체·장거리", 0), 4),
        "sig": 1 if s["is_signal"] else 0, "it": ", ".join(s.get("items", [])),
    })
data = {c: v for c, v in by_camp.items()}
order = [c for c in ["unha3", "sinpo", "punggye"] if c in data] + \
        [c for c in data if c not in ("unha3", "sinpo", "punggye")]

HTML = r"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DELPHI · belief timeline</title>
<style>
:root{--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;
  --pl:#e66767;--pa:#3987e5;--s1:#c98500;--s2:#d95926;--s3:#d55181;--fu:#199e70;--ra:#9085e9;--ph:#008300}
@media (prefers-color-scheme: light){:root{--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;
  --muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--pl:#e34948;--pa:#2a78d6;--s1:#eda100;--s2:#eb6834;
  --s3:#e87ba4;--fu:#1baf7a;--ra:#4a3aa7;--ph:#008300}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--plane);color:var(--ink);
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:12px 18px 8px}h1{margin:0;font-size:15px}.sub{color:var(--ink2);font-size:12px;margin-top:3px}
.tabs{margin-top:9px;display:flex;gap:6px}
.tab{background:var(--surface);border:1px solid var(--axis);color:var(--ink2);border-radius:7px;
  padding:5px 12px;cursor:pointer;font-size:12px}.tab.on{color:var(--ink);border-color:var(--pa);box-shadow:0 0 0 1px var(--pa)}
#wrap{padding:0 12px}#cv{display:block;width:100%;background:var(--surface);border:1px solid var(--grid);border-radius:10px}
#tip{position:fixed;pointer-events:none;background:var(--surface);border:1px solid var(--axis);border-radius:8px;
  padding:8px 10px;font-size:11.5px;display:none;z-index:9;min-width:190px;box-shadow:0 4px 18px #0007}
#tip .dt{color:var(--ink2);margin-bottom:5px;font-weight:600}
#tip .r{display:flex;justify-content:space-between;gap:12px;padding:1px 0}
#tip .r i{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:5px}
#tip .it{margin-top:5px;color:var(--ink2);border-top:1px solid var(--grid);padding-top:4px;max-width:230px}
.hint{color:var(--muted);font-size:11px;padding:2px 18px 12px}
</style></head><body>
<header><h1>DELPHI · 추론엔진 belief 시간축 추이</h1>
<div class="sub" id="sub"></div>
<div class="tabs" id="tabs"></div></header>
<div id="wrap"><canvas id="cv"></canvas></div>
<div class="hint">세로 눈금 = 신호 관측(이벤트) · 마우스 이동 = 크로스헤어로 모든 확률값 판독 · 좌→우 시간순</div>
<div id="tip"></div>
<script>
const DATA=__DATA__, ORDER=__ORDER__;
const SERIES=[
 {k:'pl',lab:'P(발사)',c:'--pl',panel:0},{k:'pa',lab:'P(활동)',c:'--pa',panel:0},
 {k:'s1',lab:'s1 초기',c:'--s1',panel:1},{k:'s2',lab:'s2 발사장',c:'--s2',panel:1},{k:'s3',lab:'s3 임박',c:'--s3',panel:1},
 {k:'fu',lab:'P(액체)',c:'--fu',panel:2},{k:'ra',lab:'P(장거리)',c:'--ra',panel:2},{k:'ph',lab:'P(H)액체·장거리',c:'--ph',panel:2}];
const PANELS=['Outputs (발사·활동)','Stages — leaky (s1·s2·s3)','Static axes (액체·장거리·결합)'];
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),tip=document.getElementById('tip');
let CAMP=ORDER[0],DPR=1,W=0,H=0,geom=null;
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function rows(){return DATA[CAMP];}
function fmtDate(t){return t.slice(0,10);}
document.getElementById('tabs').innerHTML=ORDER.map(c=>`<div class="tab${c===CAMP?' on':''}" data-c="${c}">${c} (${DATA[c].length})</div>`).join('');
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{CAMP=t.dataset.c;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.dataset.c===CAMP));draw();});
function layout(){
  DPR=devicePixelRatio||1; W=cv.clientWidth;
  const np=3, ph=190, gap=20, top=14, bot=34, H0=top+np*ph+(np-1)*gap+bot;
  H=H0; cv.width=W*DPR; cv.height=H*DPR; cv.style.height=H+'px'; ctx.setTransform(DPR,0,0,DPR,0,0);
  const L=48,R=150; const r=rows(); const t0=new Date(r[0].t).getTime(),t1=new Date(r[r.length-1].t).getTime();
  const panels=[]; for(let p=0;p<np;p++){const y0=top+p*(ph+gap);panels.push({y0,y1:y0+ph});}
  geom={L,R,top,bot,ph,gap,np,t0,t1,panels,plotW:W-L-R};
}
function X(t){return geom.L+(new Date(t).getTime()-geom.t0)/(geom.t1-geom.t0||1)*geom.plotW;}
function Y(p,v){const g=geom.panels[p];return g.y1-v*(g.y1-g.y0);}
function draw(){
  layout(); const r=rows(); ctx.clearRect(0,0,W,H);
  document.getElementById('sub').textContent=`campaign ${CAMP} · ${r.length} snapshots · ${fmtDate(r[0].t)} → ${fmtDate(r[r.length-1].t)} · 세로선=신호이벤트`;
  const muted=css('--muted'),grid=css('--grid'),axis=css('--axis'),ink2=css('--ink2');
  // event markers (signal-bearing) across all panels
  ctx.strokeStyle=grid;ctx.lineWidth=1;
  r.forEach(d=>{if(d.sig){const x=X(d.t);ctx.globalAlpha=.7;ctx.beginPath();
    ctx.moveTo(x,geom.top);ctx.lineTo(x,geom.panels[2].y1);ctx.stroke();}});
  ctx.globalAlpha=1;
  for(let p=0;p<geom.np;p++){
    const g=geom.panels[p];
    // gridlines 0/.5/1 + y labels
    ctx.strokeStyle=grid;ctx.fillStyle=muted;ctx.font='10px system-ui';ctx.textAlign='right';
    [0,.5,1].forEach(v=>{const y=Y(p,v);ctx.globalAlpha=v===0?.9:.5;ctx.beginPath();ctx.moveTo(geom.L,y);ctx.lineTo(W-geom.R,y);ctx.stroke();
      ctx.globalAlpha=1;ctx.fillText(v.toFixed(1),geom.L-6,y+3);});
    // panel title
    ctx.textAlign='left';ctx.fillStyle=ink2;ctx.font='600 11px system-ui';ctx.fillText(PANELS[p],geom.L+2,g.y0-3);
    // series lines + direct labels
    const labs=[];
    SERIES.filter(s=>s.panel===p).forEach(s=>{
      const col=css(s.c);ctx.strokeStyle=col;ctx.lineWidth=2;ctx.beginPath();
      r.forEach((d,i)=>{const x=X(d.t),y=Y(p,d[s.k]);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
      ctx.stroke();
      const last=r[r.length-1];labs.push({y:Y(p,last[s.k]),lab:s.lab,col,v:last[s.k]});
    });
    // de-collide direct labels
    labs.sort((a,b)=>a.y-b.y);for(let i=1;i<labs.length;i++)if(labs[i].y-labs[i-1].y<12)labs[i].y=labs[i-1].y+12;
    ctx.textAlign='left';ctx.font='10px system-ui';
    labs.forEach(l=>{ctx.fillStyle=l.col;ctx.fillText('● ',W-geom.R+4,l.y+3);
      ctx.fillStyle=ink2;ctx.fillText(l.lab+' '+l.v.toFixed(2),W-geom.R+14,l.y+3);});
  }
  // time axis (month ticks)
  ctx.strokeStyle=axis;ctx.fillStyle=muted;ctx.font='10px system-ui';ctx.textAlign='center';
  const ay=geom.panels[2].y1+16;let seen={};
  r.forEach(d=>{const m=d.t.slice(0,7);if(!seen[m]){seen[m]=1;const x=X(d.t);
    ctx.beginPath();ctx.moveTo(x,ay-6);ctx.lineTo(x,ay-2);ctx.stroke();ctx.fillText(m,x,ay+6);}});
  cv._r=r;
}
// crosshair + tooltip
cv.addEventListener('mousemove',e=>{
  const rc=cv.getBoundingClientRect(),mx=e.clientX-rc.left,my=e.clientY-rc.top;
  const r=cv._r;if(!r||mx<geom.L||mx>W-geom.R){tip.style.display='none';draw();return;}
  let bi=0,bd=1e9;r.forEach((d,i)=>{const dx=Math.abs(X(d.t)-mx);if(dx<bd){bd=dx;bi=i;}});
  const d=r[bi],x=X(d.t);
  draw();
  ctx.strokeStyle=css('--muted');ctx.setLineDash([4,3]);ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x,geom.top);ctx.lineTo(x,geom.panels[2].y1);ctx.stroke();ctx.setLineDash([]);
  SERIES.forEach(s=>{const y=Y(s.panel,d[s.k]);ctx.fillStyle=css(s.c);ctx.beginPath();ctx.arc(x,y,3.2,0,7);ctx.fill();
    ctx.strokeStyle=css('--surface');ctx.lineWidth=1.5;ctx.stroke();});
  tip.style.display='block';
  let left=e.clientX+14; if(left>innerWidth-210) left=e.clientX-206;
  tip.style.left=left+'px';tip.style.top=(e.clientY+8)+'px';
  tip.innerHTML=`<div class="dt">${d.t.slice(0,10)} ${d.t.slice(11,16)} ${d.sig?'· ●신호':'· 감쇠'}</div>`+
    SERIES.map(s=>`<div class="r"><span><i style="background:${css(s.c)}"></i>${s.lab}</span><b>${d[s.k].toFixed(3)}</b></div>`).join('')+
    (d.it?`<div class="it">${d.it}</div>`:'');
});
cv.addEventListener('mouseleave',()=>{tip.style.display='none';draw();});
addEventListener('resize',draw);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw);
draw();
</script></body></html>"""

import os
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
open(OUT, "w", encoding="utf-8").write(
    HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)).replace("__ORDER__", json.dumps(order)))
print(f"belief timeline -> {OUT} ({os.path.getsize(OUT)//1024}KB) · campaigns: "
      + ", ".join(f"{c}({len(data[c])})" for c in order))
