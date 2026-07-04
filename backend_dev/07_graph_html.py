#!/usr/bin/env python3
"""DELPHI Stage1 / 06 — render an RDF file to a SELF-CONTAINED interactive HTML graph (offline, no CDN).

Reads an RDF file (default graph/delphi_sample.rdf), extracts a resource graph (dlp: classes + dla: instances
as nodes; rdf:type / rdfs:subClassOf / object-properties as edges; literals kept as per-node details), and
writes a single HTML with the data inlined + a vanilla-JS canvas force-directed viewer. Nothing leaves the box.
Usage: python3 06_graph_html.py [input.rdf|.ttl] [output.html]
"""
import sys, json, os
from rdflib import Graph, Namespace, RDF, RDFS, URIRef, BNode
from rdflib.namespace import OWL

DLP = Namespace("https://delphi.kr/onto#")
DLA = Namespace("https://delphi.kr/abox/")
SRC = sys.argv[1] if len(sys.argv) > 1 else "graph/delphi_sample.rdf"
OUT = sys.argv[2] if len(sys.argv) > 2 else "graph/delphi_graph.html"

fmt = "xml" if SRC.endswith((".rdf", ".xml", ".owl")) else "turtle"
g = Graph(); g.parse(SRC, format=fmt)

def loc(u):
    return str(u).replace(str(DLP), "dlp:").replace(str(DLA), "dla:")
def ln(u):
    return str(u).rsplit("#", 1)[-1].rsplit("/", 1)[-1]

# collect class set (dlp: things used in the class hierarchy or as rdf:type objects)
classes = set()
for s, o in g.subject_objects(RDFS.subClassOf):
    classes.add(str(s)); classes.add(str(o))
for o in g.objects(None, RDF.type):
    if str(o).startswith(str(DLP)):
        classes.add(str(o))

# T-Box Korean labels for classes
ko = {}
for s, o in g.subject_objects(RDFS.label):
    if str(s).startswith(str(DLP)):
        ko[str(s)] = str(o)

CA_SUB = {ln(s) for s in g.subjects(RDFS.subClassOf, DLP.CollectionAsset)}

nodes = {}   # uri -> node dict
def cat_of(uri, types):
    if uri.startswith(str(DLP)):
        return "class"
    if "Observation" in types:
        return "observation"
    if types & CA_SUB:
        return "asset"
    if types & {"NamedLocation", "MGRSCell"}:
        return "location"
    return "observed"

def ensure(uri):
    if uri in nodes:
        return nodes[uri]
    types = {ln(t) for t in g.objects(URIRef(uri), RDF.type)} if not uri.startswith(str(DLP)) else set()
    # label
    lbls = [str(l) for l in g.objects(URIRef(uri), RDFS.label)]
    if uri.startswith(str(DLP)):
        label = ln(uri) + (f" ({ko[uri]})" if uri in ko else "")
    else:
        label = lbls[0] if lbls else ln(uri)
    # literal details
    details = {}
    for p, o in g.predicate_objects(URIRef(uri)):
        if isinstance(o, (URIRef, BNode)):
            continue
        if p == RDFS.label:
            continue
        details[ln(p)] = str(o)
    n = {"id": uri, "label": label, "cat": cat_of(uri, types),
         "types": sorted(types), "details": details, "short": loc(uri)}
    nodes[uri] = n
    return n

EDGE_PREDS = {
    str(RDF.type): "type",
    str(RDFS.subClassOf): "subclass",
    str(DLP.atLocation): "atLocation",
    str(DLP.collectedBy): "collectedBy",
    str(DLP.observedObject): "observedObject",
    str(DLP.observedSignal): "observedSignal",
    str(DLP.observedActivity): "observedActivity",
    str(DLP.withinCell): "withinCell",
    str(DLP.locatedAt): "locatedAt",
}

edges = []
for s, p, o in g:
    if isinstance(s, BNode) or isinstance(o, BNode):
        continue
    ps = str(p)
    if ps not in EDGE_PREDS:
        continue
    if not (str(s).startswith(str(DLP)) or str(s).startswith(str(DLA))):
        continue
    if not (str(o).startswith(str(DLP)) or str(o).startswith(str(DLA))):
        continue
    # for rdf:type keep only when object is a dlp class (skip owl:Class/Ontology etc.)
    if ps == str(RDF.type) and str(o) not in classes:
        continue
    ensure(str(s)); ensure(str(o))
    edges.append({"s": str(s), "t": str(o), "k": EDGE_PREDS[ps], "pred": ln(p)})

# make sure isolated class-hierarchy nodes exist
for c in classes:
    ensure(c)

data = {"nodes": list(nodes.values()), "edges": edges}
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)

HTML = r"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DELPHI Stage1 — RDF graph</title>
<style>
:root{--bg:#0e1116;--panel:#161b22;--ink:#e6edf3;--dim:#8b949e;--line:#30363d}
*{box-sizing:border-box}html,body{margin:0;height:100%;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);overflow:hidden}
#c{position:fixed;inset:0;display:block;cursor:grab}#c:active{cursor:grabbing}
.pane{position:fixed;background:rgba(22,27,34,.92);border:1px solid var(--line);border-radius:10px;backdrop-filter:blur(6px)}
#hud{top:12px;left:12px;padding:12px 14px;max-width:290px}
#hud h1{margin:0 0 8px;font-size:14px;letter-spacing:.02em}
#hud .sub{color:var(--dim);font-size:11px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:7px;margin:4px 0;font-size:12px}
.sw{width:11px;height:11px;border-radius:50%;flex:0 0 auto}
.sq{width:16px;height:0;border-top:2px solid;flex:0 0 auto}
label.tg{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;color:var(--dim)}
label.tg input{accent-color:#7dcfff}
hr{border:0;border-top:1px solid var(--line);margin:9px 0}
#search{width:100%;padding:6px 8px;background:#0d1117;border:1px solid var(--line);border-radius:6px;color:var(--ink);margin-top:4px}
#detail{top:12px;right:12px;width:300px;max-height:88vh;overflow:auto;padding:12px 14px;display:none}
#detail h2{margin:0 0 3px;font-size:13px;word-break:break-word}
#detail .cat{font-size:11px;color:var(--dim);margin-bottom:8px}
#detail table{width:100%;border-collapse:collapse}
#detail td{padding:2px 4px;vertical-align:top;font-size:11.5px;border-top:1px solid var(--line)}
#detail td.k{color:#7dcfff;white-space:nowrap;width:38%}
#tip{position:fixed;pointer-events:none;background:#000c;border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:11.5px;display:none;max-width:260px;z-index:9}
.btn{background:#21262d;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer}
#foot{bottom:10px;left:12px;color:var(--dim);font-size:11px;background:none;border:0}
kbd{background:#21262d;border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:10px}
</style></head><body>
<canvas id="c"></canvas>
<div id="hud" class="pane">
  <h1>DELPHI Stage 1 · RDF</h1>
  <div class="sub" id="counts"></div>
  <div class="row"><span class="sw" style="background:#7aa2f7"></span>Class (T-Box)</div>
  <div class="row"><span class="sw" style="background:#e0af68"></span>Observation</div>
  <div class="row"><span class="sw" style="background:#9ece6a"></span>CollectionAsset</div>
  <div class="row"><span class="sw" style="background:#f7768e"></span>Location / MGRS</div>
  <div class="row"><span class="sw" style="background:#bb9af7"></span>Observed (obj/sig/act)</div>
  <hr>
  <label class="tg"><input type="checkbox" id="e_subclass" checked><span class="sq" style="border-color:#5a6785;border-top-style:dashed"></span>subClassOf</label>
  <label class="tg"><input type="checkbox" id="e_type" checked><span class="sq" style="border-color:#3a4152"></span>rdf:type</label>
  <label class="tg"><input type="checkbox" id="e_prop" checked><span class="sq" style="border-color:#7dcfff"></span>object properties</label>
  <label class="tg" style="margin-top:5px"><input type="checkbox" id="showlab" checked> 라벨 표시</label>
  <input id="search" placeholder="라벨 검색…" autocomplete="off">
  <div class="row" style="margin-top:8px;gap:6px"><button class="btn" id="reheat">재배치</button><button class="btn" id="fit">전체보기</button></div>
</div>
<div id="detail" class="pane"></div>
<div id="tip"></div>
<div id="foot">드래그=이동 · 휠=줌 · 노드클릭=상세 · 빈곳드래그=팬</div>
<script>
const DATA = __DATA__;
const CAT = {class:'#7aa2f7',observation:'#e0af68',asset:'#9ece6a',location:'#f7768e',observed:'#bb9af7'};
const EK = {subclass:{c:'#5a6785',dash:[5,4],grp:'subclass'},type:{c:'#3a4152',dash:[],grp:'type'},
  atLocation:{c:'#7dcfff',dash:[],grp:'prop'},collectedBy:{c:'#7dcfff',dash:[],grp:'prop'},
  observedObject:{c:'#c0a6ff',dash:[],grp:'prop'},observedSignal:{c:'#c0a6ff',dash:[],grp:'prop'},
  observedActivity:{c:'#c0a6ff',dash:[],grp:'prop'},withinCell:{c:'#56d4c0',dash:[],grp:'prop'},
  locatedAt:{c:'#7dcfff',dash:[],grp:'prop'}};
const cv=document.getElementById('c'),ctx=cv.getContext('2d');
const tip=document.getElementById('tip'),detail=document.getElementById('detail');
let W,H,DPR;function resize(){DPR=devicePixelRatio||1;W=cv.width=innerWidth*DPR;H=cv.height=innerHeight*DPR;cv.style.width=innerWidth+'px';cv.style.height=innerHeight+'px';}
addEventListener('resize',resize);resize();

const N=DATA.nodes, id2n={}; N.forEach(n=>{id2n[n.id]=n;n.x=(Math.random()-.5)*innerWidth*0.7;n.y=(Math.random()-.5)*innerHeight*0.7;n.vx=0;n.vy=0;
  n.deg=0;});
const E=DATA.edges.filter(e=>id2n[e.s]&&id2n[e.t]);
E.forEach(e=>{e.a=id2n[e.s];e.b=id2n[e.t];e.a.deg++;e.b.deg++;});
N.forEach(n=>n.r=(n.cat==='class'?6:4)+Math.min(6,n.deg*0.6));
document.getElementById('counts').textContent=`${N.length} nodes · ${E.length} edges`;

let view={x:innerWidth/2,y:innerHeight/2,k:1};
function fit(){let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;N.forEach(n=>{mnx=Math.min(mnx,n.x);mny=Math.min(mny,n.y);mxx=Math.max(mxx,n.x);mxy=Math.max(mxy,n.y)});
  const w=mxx-mnx||1,h=mxy-mny||1;const k=Math.min(innerWidth/(w+120),innerHeight/(h+120),2);view.k=k;view.x=innerWidth/2-(mnx+mxx)/2*k;view.y=innerHeight/2-(mny+mxy)/2*k;}
const toScreen=n=>({x:n.x*view.k+view.x,y:n.y*view.k+view.y});
function fromScreen(sx,sy){return{x:(sx-view.x)/view.k,y:(sy-view.y)/view.k};}

// physics
let alpha=1;const KR=5500,KS=0.045,REST=62,DAMP=0.9,CEN=0.006;
function tick(){if(alpha<0.02)return;alpha*=0.994;
  for(let i=0;i<N.length;i++){const a=N[i];for(let j=i+1;j<N.length;j++){const b=N[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+0.01;if(d2>90000)continue;const f=KR/d2,d=Math.sqrt(d2);const fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}
  E.forEach(e=>{const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.sqrt(dx*dx+dy*dy)||1,rest=e.k==='subclass'?REST*0.85:REST,f=KS*(d-rest);const fx=dx/d*f,fy=dy/d*f;e.a.vx+=fx;e.a.vy+=fy;e.b.vx-=fx;e.b.vy-=fy;});
  N.forEach(n=>{n.vx-=n.x*CEN;n.vy-=n.y*CEN;if(n===drag)return;n.vx*=DAMP;n.vy*=DAMP;n.x+=n.vx*alpha*2.2;n.y+=n.vy*alpha*2.2;n.vx*=0.5;n.vy*=0.5;});
}
const show={subclass:1,type:1,prop:1};
function edgeOn(e){return show[EK[e.k].grp];}
let hover=null,sel=null,drag=null,query='';
function draw(){ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);
  // edges
  E.forEach(e=>{if(!edgeOn(e))return;const st=EK[e.k];const A=toScreen(e.a),B=toScreen(e.b);
    const hot=hover&&(e.a===hover||e.b===hover)||sel&&(e.a===sel||e.b===sel);
    ctx.globalAlpha=hot?0.95:(st.grp==='type'?0.22:0.5);ctx.strokeStyle=st.c;ctx.lineWidth=hot?1.8:1;ctx.setLineDash(st.dash);
    ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
    if(st.grp==='prop'&&(hot)){ // arrowhead
      const ang=Math.atan2(B.y-A.y,B.x-A.x),r=(e.b.r*view.k)+3;const hx=B.x-Math.cos(ang)*r,hy=B.y-Math.sin(ang)*r;
      ctx.setLineDash([]);ctx.fillStyle=st.c;ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx-Math.cos(ang-.4)*7,hy-Math.sin(ang-.4)*7);ctx.lineTo(hx-Math.cos(ang+.4)*7,hy-Math.sin(ang+.4)*7);ctx.closePath();ctx.fill();}
  });
  ctx.setLineDash([]);ctx.globalAlpha=1;
  const showlab=document.getElementById('showlab').checked;
  N.forEach(n=>{const S=toScreen(n);const r=Math.max(2.5,n.r*view.k);
    const match=query&&n.label.toLowerCase().includes(query);
    ctx.beginPath();ctx.arc(S.x,S.y,r,0,7);ctx.fillStyle=CAT[n.cat];
    ctx.globalAlpha=(query&&!match)?0.18:1;ctx.fill();
    if(n===sel||n===hover||match){ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();}
    ctx.globalAlpha=1;
    if(showlab&&(view.k>0.75||n.cat==='class'||n===hover||n===sel||match)){
      ctx.font=(n.cat==='class'?'600 ':'')+Math.max(10,11)+'px system-ui';ctx.fillStyle=(query&&!match)?'#555':'#c9d1d9';
      ctx.globalAlpha=(query&&!match)?0.3:0.92;ctx.fillText(n.label.length>34?n.label.slice(0,32)+'…':n.label,S.x+r+3,S.y+3.5);ctx.globalAlpha=1;}
  });
}
function loop(){tick();draw();requestAnimationFrame(loop);}
fit();loop();

// interaction
function pick(sx,sy){let best=null,bd=1e9;N.forEach(n=>{const S=toScreen(n);const d=Math.hypot(S.x-sx,S.y-sy);if(d<Math.max(9,n.r*view.k+5)&&d<bd){bd=d;best=n;}});return best;}
let panning=false,px,py,moved=false;
cv.addEventListener('mousedown',e=>{const n=pick(e.clientX,e.clientY);moved=false;if(n){drag=n;n.fx=1;}else{panning=true;px=e.clientX;py=e.clientY;}});
addEventListener('mousemove',e=>{
  if(drag){const p=fromScreen(e.clientX,e.clientY);drag.x=p.x;drag.y=p.y;drag.vx=0;drag.vy=0;alpha=Math.max(alpha,0.35);moved=true;}
  else if(panning){view.x+=e.clientX-px;view.y+=e.clientY-py;px=e.clientX;py=e.clientY;moved=true;}
  else{const n=pick(e.clientX,e.clientY);hover=n;if(n){tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';tip.innerHTML='<b>'+esc(n.label)+'</b><br><span style="color:#8b949e">'+(n.types.join(', ')||n.short)+'</span>';}else tip.style.display='none';}
});
addEventListener('mouseup',e=>{if(drag){drag.fx=0;drag=null;}if(panning){panning=false;}if(!moved){const n=pick(e.clientX,e.clientY);select(n);}});
cv.addEventListener('wheel',e=>{e.preventDefault();const f=Math.exp(-e.deltaY*0.0016);const mx=e.clientX,my=e.clientY;const wx=(mx-view.x)/view.k,wy=(my-view.y)/view.k;view.k=Math.max(0.15,Math.min(6,view.k*f));view.x=mx-wx*view.k;view.y=my-wy*view.k;},{passive:false});
function esc(s){return(s+'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function select(n){sel=n;if(!n){detail.style.display='none';return;}
  let rows='';for(const[k,v]of Object.entries(n.details))rows+=`<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const outs=E.filter(e=>e.a===n).map(e=>`${e.pred} → ${esc(id2n[e.t].label)}`);
  const ins=E.filter(e=>e.b===n).map(e=>`${esc(id2n[e.s].label)} → ${e.pred}`);
  detail.innerHTML=`<h2>${esc(n.label)}</h2><div class="cat">${n.cat} · ${esc(n.short)}</div>`+
    (n.types.length?`<div class="cat">a ${n.types.join(', ')}</div>`:'')+
    (rows?`<table>${rows}</table>`:'')+
    (outs.length?`<hr><div class="cat">→ 나가는 관계</div><table>${outs.map(o=>`<tr><td>${o}</td></tr>`).join('')}</table>`:'')+
    (ins.length?`<hr><div class="cat">← 들어오는 관계</div><table>${ins.map(o=>`<tr><td>${o}</td></tr>`).join('')}</table>`:'');
  detail.style.display='block';}
document.getElementById('search').addEventListener('input',e=>{query=e.target.value.toLowerCase().trim();});
document.getElementById('reheat').onclick=()=>{alpha=1;};
document.getElementById('fit').onclick=fit;
['e_subclass','e_type','e_prop'].forEach(idn=>document.getElementById(idn).addEventListener('change',e=>{show[idn.split('_')[1]]=e.target.checked;}));
</script></body></html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)))
print(f"nodes {len(data['nodes'])}  edges {len(data['edges'])}  -> {OUT}  ({os.path.getsize(OUT)//1024}KB)")
