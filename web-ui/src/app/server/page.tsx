'use client';

// /server — live visualizer / explorer for the DELPHI inference backend (`backend_app`).
//
// The backend is a read-only, cache-based FastAPI app that serves the Stage-2
// belief snapshots + contribution ledger. It sets `allow_origins=["*"]`, so this
// page talks to it straight from the browser — no Next.js proxy route needed.
// Endpoints (base `/api/v1`, plus a top-level /health):
//   GET  /health
//   GET  /api/v1/campaigns
//   GET  /api/v1/inference?campaign_id&at&top_n&include_source
//   GET  /api/v1/inference/series?campaign_id&from&to&fields
//   GET  /api/v1/observations/{obs_id}
//   POST /api/v1/admin/reload

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000';

// ---- API response shapes (subset we render) --------------------------------
type Health = {
  status: string;
  cache: string | null;
  mode: string | null;
  campaigns: string[];
  snapshots: number | null;
  ledger: number | null;
};
type Campaign = {
  campaign_id: string;
  label: string;
  observation_count: number;
  time_range?: { start: string; end: string } | null;
};
type SeriesRow = {
  timestamp: string;
  seq: number;
  is_signal?: boolean;
  items?: string[];
  hypotheses?: Record<string, number>;
  [k: string]: unknown;
};
type Contribution = {
  obs_id: string;
  residual_db: number;
  stages: string[];
  source?: {
    location_name?: string;
    collected_at?: string;
    asset_type?: string;
    activity_desc?: string;
  };
};
// Faithful influence graph at the query time (see contrib.ContribEngine._graph).
type GraphObs = { obs_id: string; launch_db: number; axis_db: number; source?: Contribution['source'] };
type GraphData = {
  stages: { name: string; prob: number; prior_db: number }[];
  axes: { name: string; prob: number; pos: string; neg: string }[];
  outputs: { name: string; value: number; expr: string }[];
  hypotheses: { label: string; prob: number }[];
  obs: GraphObs[];
  types: { name: string; db: number }[];
  obs_type_edges: { obs_id: string; type: string; db: number }[];
  type_stage_edges: { type: string; stage: string; residual_db: number }[];
  type_axis_edges: { type: string; axis: string; db: number }[];
  stage_edges: { obs_id: string; stage: string; residual_db: number }[];
  axis_edges: { obs_id: string; axis: string; db: number }[];
};
type Inference = {
  seq: number;
  p_launch: number;
  hypotheses: Record<string, number>;
  launch_contributions: Contribution[];
  graph?: GraphData;
};

// The series fields we chart, grouped into 3 stacked panels.
const SERIES = [
  { key: 'p_launch', label: 'P(발사)', color: '#ef4444', panel: 0 },
  { key: 'p_activity', label: 'P(활동)', color: '#3b82f6', panel: 0 },
  { key: 's1_early', label: 's1 초기', color: '#f59e0b', panel: 1 },
  { key: 's2_pad', label: 's2 발사장', color: '#f97316', panel: 1 },
  { key: 's3_imminent', label: 's3 임박', color: '#ec4899', panel: 1 },
] as const;
// Panel 3 is a 100%-stacked area of the 4 hypotheses (they sum to 1.0). Fixed
// bottom→top stacking order + distinct colors (amber is reserved for the marker).
const HYPS = [
  { key: '액체·장거리', color: '#a3e635' },
  { key: '액체·단거리', color: '#38bdf8' },
  { key: '고체·장거리', color: '#fb7185' },
  { key: '고체·단거리', color: '#c084fc' },
] as const;
const PANEL_TITLES = ['Outputs · 발사 / 활동', 'Stages · s1 / s2 / s3', 'Hypothesis mix · 가설구성 Σ=1'];
const SERIES_FIELDS = 'p_launch,p_activity,s1_early,s2_pad,s3_imminent,hypotheses';

// ---- Influence-graph node styling (labels + colors, keyed by backend node name) ----
const STAGE_META: Record<string, { label: string; color: string }> = {
  s1_early: { label: 's1 초기', color: '#f59e0b' },
  s2_pad: { label: 's2 발사장', color: '#f97316' },
  s3_imminent: { label: 's3 임박', color: '#ec4899' },
};
const AXIS_META: Record<string, { label: string; color: string }> = {
  fuel: { label: '연료축', color: '#38bdf8' },
  range: { label: '사거리축', color: '#a3e635' },
};
const OUTPUT_META: Record<string, { label: string; color: string }> = {
  p_launch: { label: 'P(발사)', color: '#ef4444' },
  p_activity: { label: 'P(활동)', color: '#3b82f6' },
};
const HYP_COLOR: Record<string, string> = {
  '액체·장거리': '#a3e635',
  '액체·단거리': '#38bdf8',
  '고체·장거리': '#fb7185',
  '고체·단거리': '#c084fc',
};
const POS_EDGE = '#34d399'; // +dB (probability pushed up)
const NEG_EDGE = '#f87171'; // −dB (probability pushed down)
const STRUCT_EDGE = '#4b5563'; // structural wiring (stage→output, axis→hypothesis)

// Intermediate layer: A-Box evidence types (the mechanism — likelihood_db is keyed by these),
// grouped by ontology class per the taxonomy: 이동물체 / 활동 / 신호방출. Color encodes the group.
const TYPE_GROUPS = ['이동물체', '활동', '신호방출'] as const;
const GROUP_COLOR = ['#f59e0b', '#38bdf8', '#a78bfa'];
const TYPE_META: Record<string, { label: string; group: number }> = {
  // 2.2 MobileObject (이동물체)
  Transporter: { label: '수송·발사대', group: 0 },
  TEL: { label: 'TEL', group: 0 },
  Trailer: { label: '트레일러', group: 0 },
  RailCar: { label: '특수 열차', group: 0 },
  PropellantVehicle: { label: '추진제 차량', group: 0 },
  OxidizerVehicle: { label: '산화제 차량', group: 0 },
  SecurityVehicle: { label: '보안 차량', group: 0 },
  SupportVehicle: { label: '지원 차량', group: 0 },
  // 2.3 Activity (활동)
  VehicleMassing: { label: '차량 집결', group: 1 },
  ObjectMovement: { label: '물체 이동', group: 1 },
  StructureWork: { label: '구조물 작업', group: 1 },
  CommunicationSurge: { label: '통신 급증', group: 1 },
  AreaClosure: { label: '구역 폐쇄', group: 1 },
  PersonnelActivity: { label: '인원 활동', group: 1 },
  SignalActivation: { label: '신호 활성화', group: 1 },
  // 2.4 Emission (신호방출)
  CommsEmission: { label: '통신 방출', group: 2 },
  RadarEmission: { label: '레이더 방출', group: 2 },
  TelemetryEmission: { label: '텔레메트리', group: 2 },
};
function typeMeta(name: string) {
  const m = TYPE_META[name];
  return m ? { label: m.label, group: m.group, color: GROUP_COLOR[m.group] } : { label: name, group: 3, color: '#9ca3af' };
}

const ENDPOINTS = [
  { method: 'GET', path: '/health', desc: '캐시 상태 · 신선도' },
  { method: 'GET', path: '/api/v1/campaigns', desc: '캠페인 목록' },
  { method: 'GET', path: '/api/v1/inference', desc: '시점 스냅샷 + 기여도 역산' },
  { method: 'GET', path: '/api/v1/inference/series', desc: 'belief 타임라인 시계열' },
  { method: 'GET', path: '/api/v1/observations/{obs_id}', desc: '원천 관측 조회' },
  { method: 'POST', path: '/api/v1/admin/reload', desc: '캐시 핫리로드' },
];

function fmt(n: number, d = 3) {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

export default function ServerPage() {
  const [base, setBase] = useState(DEFAULT_BASE);
  const [baseDraft, setBaseDraft] = useState(DEFAULT_BASE);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [drill, setDrill] = useState<Inference | null>(null);
  const [drillAt, setDrillAt] = useState<string | null>(null);
  // Authoritative scrub position = index into `series` (timestamps are NOT unique — 25 of
  // them repeat — so deriving the index by timestamp match would pin the slider at the first
  // duplicate and swallow arrow-key steps). drillAt is kept only for the fetch URL + labels.
  const [drillIdx, setDrillIdx] = useState(-1);
  const [probe, setProbe] = useState<{ label: string; status: number; body: string } | null>(null);
  const [view, setView] = useState<'timeline' | 'graph'>('timeline');

  // ---- data loading --------------------------------------------------------
  const loadHealth = useCallback(async () => {
    setHealthErr(null);
    try {
      const r = await fetch(`${base}/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setHealth((await r.json()) as Health);
    } catch (e) {
      setHealth(null);
      setHealthErr(e instanceof Error ? e.message : String(e));
    }
  }, [base]);

  const loadCampaigns = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/v1/campaigns`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { campaigns: Campaign[] };
      setCampaigns(j.campaigns);
      setActive((cur) => cur ?? j.campaigns[0]?.campaign_id ?? null);
    } catch {
      setCampaigns([]);
    }
  }, [base]);

  useEffect(() => {
    loadHealth();
    loadCampaigns();
  }, [loadHealth, loadCampaigns]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadingSeries(true);
    setDrill(null);
    setDrillAt(null);
    setDrillIdx(-1);
    fetch(`${base}/api/v1/inference/series?campaign_id=${active}&fields=${encodeURIComponent(SERIES_FIELDS)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { series: SeriesRow[] }) => {
        if (cancelled) return;
        // flatten the 액체·장거리 hypothesis onto each row as `ph` for charting
        const rows = j.series.map((p) => ({
          ...p,
          ph: (p.hypotheses || {})['액체·장거리'] ?? 0,
        }));
        setSeries(rows);
      })
      .catch(() => !cancelled && setSeries([]))
      .finally(() => !cancelled && setLoadingSeries(false));
    return () => {
      cancelled = true;
    };
  }, [base, active]);

  // Move the crosshair/label immediately, but debounce the /inference fetch so
  // dragging the slider doesn't fire a request per pixel. Clicks pass immediate.
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drillInto = useCallback(
    (idx: number, immediate = false) => {
      const row = series[idx];
      if (!active || !row) return;
      setDrillIdx(idx);
      setDrillAt(row.timestamp);
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      const url = `/api/v1/inference?campaign_id=${active}&at=${encodeURIComponent(row.timestamp)}&top_n=6`;
      const go = async () => {
        setProbe({ label: `GET ${url}`, status: -1, body: '요청 중…' });
        try {
          const r = await fetch(`${base}${url}`);
          const text = await r.text();
          // Show the raw API result for this timestamp in the Response panel...
          let pretty = text;
          try {
            pretty = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            /* leave as-is */
          }
          setProbe({ label: `GET ${url}`, status: r.status, body: pretty.slice(0, 6000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          // ...and the parsed object drives the rendered drilldown.
          setDrill(JSON.parse(text) as Inference);
        } catch {
          setDrill(null);
        }
      };
      if (immediate) go();
      else fetchTimer.current = setTimeout(go, 140);
    },
    [base, active, series],
  );

  // When a fresh series loads, seed the drilldown/slider at the latest snapshot.
  useEffect(() => {
    if (series.length && drillIdx < 0) drillInto(series.length - 1, true);
  }, [series, drillIdx, drillInto]);

  const runProbe = useCallback(
    async (method: string, path: string) => {
      // fill the {obs_id} / query params with something demoable
      let url = path;
      if (path.includes('{obs_id}')) {
        const oid = drill?.launch_contributions?.[0]?.obs_id ?? '';
        if (!oid) {
          setProbe({ label: `${method} ${path}`, status: 0, body: '먼저 타임라인을 클릭해 obs_id를 확보하세요.' });
          return;
        }
        url = path.replace('{obs_id}', encodeURIComponent(oid));
      } else if (path === '/api/v1/inference') {
        const at = series[series.length - 1]?.timestamp ?? new Date().toISOString();
        url = `${path}?campaign_id=${active ?? ''}&at=${encodeURIComponent(at)}&top_n=6`;
      } else if (path === '/api/v1/inference/series') {
        url = `${path}?campaign_id=${active ?? ''}&fields=p_launch,hypotheses`;
      }
      setProbe({ label: `${method} ${url}`, status: -1, body: '요청 중…' });
      try {
        const r = await fetch(`${base}${url}`, { method });
        const text = await r.text();
        let pretty = text;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          /* leave as-is */
        }
        setProbe({ label: `${method} ${url}`, status: r.status, body: pretty.slice(0, 6000) });
        if (path === '/api/v1/admin/reload' && r.ok) loadHealth();
      } catch (e) {
        setProbe({ label: `${method} ${url}`, status: 0, body: e instanceof Error ? e.message : String(e) });
      }
    },
    [base, active, series, drill, loadHealth],
  );

  const activeCampaign = campaigns.find((c) => c.campaign_id === active) || null;
  // Slider position tracks the drilldown index directly (kept in sync with clicks + keys).
  const sliderIdx = drillIdx >= 0 ? Math.min(drillIdx, series.length - 1) : Math.max(0, series.length - 1);
  const sliderRow = series[sliderIdx];

  // Arrow / Home / End / PageUp-Down scrub the timeline from anywhere on the page. When the
  // range input itself is focused the browser already steps it, so we skip inputs to avoid
  // double-stepping (and to not hijack arrows while typing the base URL).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!series.length) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const last = series.length - 1;
      let next = sliderIdx;
      if (e.key === 'ArrowRight') next = Math.min(last, sliderIdx + 1);
      else if (e.key === 'ArrowLeft') next = Math.max(0, sliderIdx - 1);
      else if (e.key === 'PageUp') next = Math.min(last, sliderIdx + 10);
      else if (e.key === 'PageDown') next = Math.max(0, sliderIdx - 10);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else return;
      e.preventDefault();
      if (next !== sliderIdx) drillInto(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [series, sliderIdx, drillInto]);

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--navy-900)] text-gray-200">
      {/* Header ------------------------------------------------------------ */}
      <header className="flex items-center gap-4 px-5 py-3 border-b border-gray-800 bg-[var(--layer-1)]">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-white flex items-center gap-2">
            DELPHI 추론 API
            <span className="text-[11px] font-normal text-gray-500">backend_app · live</span>
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            읽기 전용 캐시 기반 FastAPI — belief 스냅샷 + 기여도 역산을 그대로 시각화
          </p>
        </div>
        <div className="flex-1" />
        <HealthPill health={health} err={healthErr} />
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBase(baseDraft.replace(/\/$/, ''));
          }}
        >
          <input
            value={baseDraft}
            onChange={(e) => setBaseDraft(e.target.value)}
            spellCheck={false}
            className="w-64 bg-[var(--navy-900)] border border-gray-700 rounded px-2 py-1 text-[11px] font-mono text-gray-300 focus:border-[var(--friendly)] outline-none"
          />
          <button
            type="submit"
            className="text-[11px] px-3 py-1 rounded border border-gray-700 text-gray-300 hover:border-[var(--friendly)] hover:text-white transition-colors"
          >
            연결
          </button>
        </form>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Left rail: endpoint catalog + probe ---------------------------- */}
        <aside className="w-[300px] shrink-0 border-r border-gray-800 bg-[var(--layer-1)] flex flex-col">
          <SectionTitle>엔드포인트</SectionTitle>
          <div className="px-3 pb-3 space-y-1.5">
            {ENDPOINTS.map((e) => (
              <button
                key={e.method + e.path}
                onClick={() => runProbe(e.method, e.path)}
                className="w-full text-left group rounded border border-gray-800 hover:border-gray-600 bg-[var(--navy-900)] px-2.5 py-1.5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] font-bold px-1 py-px rounded ${
                      e.method === 'GET' ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-400 bg-amber-400/10'
                    }`}
                  >
                    {e.method}
                  </span>
                  <span className="text-[11px] font-mono text-gray-300 truncate">{e.path}</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">{e.desc}</div>
              </button>
            ))}
          </div>

          <SectionTitle>응답</SectionTitle>
          <div className="flex-1 min-h-0 px-3 pb-3">
            {probe ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <StatusDot status={probe.status} />
                  <span className="text-[10px] font-mono text-gray-400 truncate">{probe.label}</span>
                </div>
                <pre className="flex-1 min-h-0 overflow-auto text-[10.5px] leading-snug font-mono text-gray-300 bg-[var(--navy-900)] border border-gray-800 rounded p-2 whitespace-pre-wrap break-words">
                  {probe.body}
                </pre>
              </div>
            ) : (
              <p className="text-[11px] text-gray-600 px-1">엔드포인트를 눌러 실제 응답을 확인하세요.</p>
            )}
          </div>
        </aside>

        {/* Center: campaign tabs + belief timeline ------------------------ */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-800">
            {campaigns.map((c) => (
              <button
                key={c.campaign_id}
                onClick={() => setActive(c.campaign_id)}
                className={`text-[12px] px-3 py-1 rounded border transition-colors ${
                  c.campaign_id === active
                    ? 'border-[var(--friendly)] text-white bg-[var(--friendly)]/10'
                    : 'border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                {c.label} <span className="text-gray-500">· {c.observation_count}</span>
              </button>
            ))}
            {activeCampaign?.time_range && (
              <span className="text-[10px] text-gray-600 ml-2">
                {activeCampaign.time_range.start.slice(0, 10)} → {activeCampaign.time_range.end.slice(0, 10)} ·{' '}
                {series.length} snapshots
              </span>
            )}
            <div className="flex-1" />
            {/* View toggle: belief timeline ↔ influence graph (both driven by the scrubbed time) */}
            <div className="flex items-center rounded border border-gray-700 overflow-hidden text-[11px]">
              {(
                [
                  ['timeline', 'belief 타임라인'],
                  ['graph', '영향 그래프'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1 transition-colors ${
                    view === v ? 'bg-[var(--friendly)]/15 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 p-4">
            {view === 'graph' ? (
              drill?.graph ? (
                <InfluenceGraph graph={drill.graph} at={drillAt} />
              ) : (
                <Centered>
                  {series.length ? '타임라인을 클릭해 시점을 선택하면 그 시점의 영향 그래프가 그려집니다.' : '데이터 없음'}
                </Centered>
              )
            ) : loadingSeries ? (
              <Centered>불러오는 중…</Centered>
            ) : series.length ? (
              <TimelineChart rows={series} onPick={(i) => drillInto(i, true)} pickedIdx={sliderIdx} />
            ) : (
              <Centered>
                {healthErr ? `백엔드 연결 실패 (${healthErr})` : '시계열 데이터가 없습니다.'}
              </Centered>
            )}
          </div>

          {/* Timestamp scrubber — drag to query /inference at any snapshot ---- */}
          {series.length > 0 && sliderRow && (
            <div className="px-5 pb-1.5">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-gray-500 shrink-0">시점 스크럽</span>
                <input
                  type="range"
                  min={0}
                  max={series.length - 1}
                  value={sliderIdx}
                  onChange={(e) => drillInto(+e.target.value)}
                  className="flex-1 h-1 accent-[var(--friendly)] cursor-pointer"
                  aria-label="타임스탬프 스크럽"
                />
                <span className="shrink-0 w-[150px] text-right font-mono text-[11px] text-gray-300">
                  {sliderRow.timestamp.slice(0, 10)} {sliderRow.timestamp.slice(11, 16)}
                  {sliderRow.is_signal ? <span className="text-amber-400"> ●</span> : null}
                </span>
                <span className="shrink-0 w-[52px] text-right text-[10px] text-gray-600">
                  {sliderIdx + 1}/{series.length}
                </span>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-600 px-5 pb-2">
            {view === 'graph' ? (
              <>
                영향 그래프: 증거유형(A-Box) → s1/s2/s3·연료/사거리 → P(발사)·가설(PH) · 간선 굵기 ∝ |dB|, 색 = 부호 ·
                선택 시점 <code className="text-gray-500">GET /api/v1/inference</code> 의{' '}
                <code className="text-gray-500">graph</code> 필드
              </>
            ) : (
              <>
                곡선: <code className="text-gray-500">GET /api/v1/inference/series</code> · 클릭·슬라이더 시 기여도:{' '}
                <code className="text-gray-500">GET /api/v1/inference</code> · 세로선 = 신호 이벤트
              </>
            )}
          </p>
        </section>

        {/* Right: drilldown ---------------------------------------------- */}
        <aside className="w-[330px] shrink-0 border-l border-gray-800 bg-[var(--layer-1)] flex flex-col">
          <SectionTitle>드릴다운 · 기여도 역산</SectionTitle>
          <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
            {drill ? (
              <Drilldown drill={drill} at={drillAt} />
            ) : (
              <p className="text-[11px] text-gray-600 px-1">
                타임라인을 클릭하거나 아래 슬라이더를 드래그하면 그 시점의 P(발사)와, 어느 관측이 확률을
                밀어올렸는지(deciban residual)를 API에서 역산해 보여줍니다.
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{children}</div>
  );
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center text-[12px] text-gray-500">{children}</div>;
}
function StatusDot({ status }: { status: number }) {
  const color =
    status === -1 ? 'bg-gray-500' : status === 0 ? 'bg-red-500' : status < 300 ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-[10px] font-mono text-gray-500">{status <= 0 ? '···' : status}</span>
    </span>
  );
}

function HealthPill({ health, err }: { health: Health | null; err: string | null }) {
  const ok = health?.status === 'ok';
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500 threat-pulse' : 'bg-red-500'}`} />
      {ok && health ? (
        <span className="text-gray-400">
          <span className="text-emerald-400 font-medium">online</span> · {health.snapshots} snap ·{' '}
          {health.ledger} ledger · {health.mode} ·{' '}
          <span className="text-gray-500">{health.cache?.slice(0, 16)?.replace('T', ' ')}</span>
        </span>
      ) : (
        <span className="text-red-400">offline{err ? ` · ${err}` : ''}</span>
      )}
    </div>
  );
}

function Drilldown({ drill, at }: { drill: Inference; at: string | null }) {
  const hyps = Object.entries(drill.hypotheses || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="animate-fade-in">
      <div className="text-[11px] text-gray-500 mb-1">
        {at?.slice(0, 10)} {at?.slice(11, 16)} · seq {drill.seq}
      </div>
      <div className="text-[26px] font-bold text-[var(--threat-red)] leading-none my-2">
        P(발사) {fmt(drill.p_launch)}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        가설 분포 (PH)
      </div>
      <div className="space-y-1 mb-3">
        {hyps.map(([name, prob], i) => (
          <div key={name}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={i === 0 ? 'text-white font-medium' : 'text-gray-300'}>{name}</span>
              <span className="font-mono text-gray-400">{fmt(prob)}</span>
            </div>
            <div className="h-1.5 rounded bg-gray-800 overflow-hidden mt-0.5">
              <div
                className={`h-full rounded ${i === 0 ? 'bg-[var(--ai-gold)]' : 'bg-[var(--friendly)]'}`}
                style={{ width: `${Math.max(prob * 100, 1)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        P(발사) 기여 (residual dB)
      </div>
      <div className="space-y-0">
        {drill.launch_contributions?.length ? (
          drill.launch_contributions.map((it) => {
            const s = it.source || {};
            const pos = it.residual_db >= 0;
            return (
              <div key={it.obs_id} className="border-t border-gray-800 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11.5px] text-gray-200 truncate">
                    {s.location_name || it.obs_id}
                  </span>
                  <span className={`text-[11.5px] font-bold shrink-0 ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pos ? '+' : ''}
                    {it.residual_db} dB
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {(s.collected_at || '').slice(0, 16)} · {s.asset_type || '—'} · {it.stages?.join('+')}
                </div>
                {s.activity_desc && (
                  <div className="text-[10px] text-gray-600 mt-0.5 line-clamp-2">{s.activity_desc}</div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-[11px] text-gray-600 py-2">기여 없음 (감쇠 구간)</div>
        )}
      </div>
    </div>
  );
}

// ---- Canvas belief-timeline chart -----------------------------------------
function TimelineChart({
  rows,
  onPick,
  pickedIdx,
}: {
  rows: SeriesRow[];
  onPick: (i: number) => void;
  pickedIdx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const geom = useRef<{
    L: number;
    R: number;
    W: number;
    H: number;
    top: number;
    panels: { y0: number; y1: number }[];
    t0: number;
    t1: number;
    plotW: number;
  } | null>(null);

  const times = useMemo(() => rows.map((r) => +new Date(r.timestamp)), [rows]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap || !rows.length) return;
    const DPR = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const np = 3;
    const ph = Math.max(120, (wrap.clientHeight - 60) / np);
    const gap = 18;
    const top = 12;
    const bot = 26;
    const H = top + np * ph + (np - 1) * gap + bot;
    cv.width = W * DPR;
    cv.height = H * DPR;
    cv.style.height = `${H}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const L = 40;
    const R = 150;
    const panels: { y0: number; y1: number }[] = [];
    for (let p = 0; p < np; p++) {
      const y0 = top + p * (ph + gap);
      panels.push({ y0, y1: y0 + ph });
    }
    const t0 = times[0];
    const t1 = times[times.length - 1];
    const plotW = W - L - R;
    geom.current = { L, R, W, H, top, panels, t0, t1, plotW };
    const X = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * plotW;
    const Y = (p: number, v: number) => panels[p].y1 - v * (panels[p].y1 - panels[p].y0);

    // Progressive reveal: draw the plot only up to the picked/slider index.
    const revealIdx = pickedIdx >= 0 ? pickedIdx : rows.length - 1;

    // signal event verticals (only up to the reveal point)
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    rows.forEach((d, i) => {
      if (d.is_signal && i <= revealIdx) {
        const x = X(times[i]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, panels[2].y1);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    for (let p = 0; p < np; p++) {
      const g = panels[p];
      ctx.strokeStyle = '#1f2937';
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      [0, 0.5, 1].forEach((v) => {
        const y = Y(p, v);
        ctx.globalAlpha = v === 0 ? 0.8 : 0.4;
        ctx.beginPath();
        ctx.moveTo(L, y);
        ctx.lineTo(W - R, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(v.toFixed(1), L - 6, y + 3);
      });

      const labs: { y: number; label: string; color: string; v: number }[] = [];

      if (p === 2) {
        // 100%-stacked area of the 4 hypotheses, revealed up to revealIdx.
        const cum = new Array(revealIdx + 1).fill(0);
        HYPS.forEach((h) => {
          ctx.fillStyle = h.color;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          for (let i = 0; i <= revealIdx; i++) {
            const v = cum[i] + Number(rows[i].hypotheses?.[h.key] ?? 0);
            const x = X(times[i]);
            const y = Y(p, v);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          for (let i = revealIdx; i >= 0; i--) ctx.lineTo(X(times[i]), Y(p, cum[i]));
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          for (let i = 0; i <= revealIdx; i++) cum[i] += Number(rows[i].hypotheses?.[h.key] ?? 0);
        });
        // legend: band center at the leading (revealed) edge
        const lead = rows[revealIdx];
        let acc = 0;
        HYPS.forEach((h) => {
          const prob = Number(lead.hypotheses?.[h.key] ?? 0);
          labs.push({ y: Y(p, acc + prob / 2), label: h.key, color: h.color, v: prob });
          acc += prob;
        });
      } else {
        SERIES.filter((s) => s.panel === p).forEach((s) => {
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= revealIdx; i++) {
            const x = X(times[i]);
            const y = Y(p, Number(rows[i][s.key] ?? 0));
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
          const lead = rows[revealIdx];
          labs.push({ y: Y(p, Number(lead[s.key] ?? 0)), label: s.label, color: s.color, v: Number(lead[s.key] ?? 0) });
        });
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = '#9ca3af';
      ctx.font = '600 11px system-ui';
      ctx.fillText(PANEL_TITLES[p], L + 2, g.y0 - 3);

      labs.sort((a, b) => a.y - b.y);
      for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12;
      ctx.font = '10px system-ui';
      labs.forEach((l) => {
        ctx.fillStyle = l.color;
        ctx.fillText('■', W - R + 4, l.y + 3);
        ctx.fillStyle = '#9ca3af';
        ctx.fillText(`${l.label} ${l.v.toFixed(2)}`, W - R + 15, l.y + 3);
      });
    }

    // month ticks
    ctx.strokeStyle = '#374151';
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    const ay = panels[2].y1 + 14;
    const seen: Record<string, 1> = {};
    rows.forEach((d, i) => {
      const m = d.timestamp.slice(0, 7);
      if (!seen[m]) {
        seen[m] = 1;
        const x = X(times[i]);
        ctx.beginPath();
        ctx.moveTo(x, ay - 5);
        ctx.lineTo(x, ay - 1);
        ctx.stroke();
        ctx.fillText(m, x, ay + 6);
      }
    });

    // Bold vertical marker at the picked / slider timestamp — the leading edge of
    // the revealed plot, drawn bright/solid so it clearly stands out and moves.
    if (pickedIdx >= 0) {
      const x = X(times[pickedIdx]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, panels[2].y1);
      ctx.stroke();
      SERIES.forEach((s) => {
        const y = Y(s.panel, Number(rows[pickedIdx][s.key] ?? 0));
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 7);
        ctx.fill();
        ctx.strokeStyle = '#0a0e1a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      // timestamp chip pinned to the marker at the top
      const lbl = `${rows[pickedIdx].timestamp.slice(5, 10)} ${rows[pickedIdx].timestamp.slice(11, 16)}`;
      ctx.font = '600 10px system-ui';
      const tw = ctx.measureText(lbl).width + 10;
      const cx = Math.min(Math.max(x - tw / 2, L), W - R - tw);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(cx, top - 2, tw, 14);
      ctx.fillStyle = '#0a0e1a';
      ctx.textAlign = 'left';
      ctx.fillText(lbl, cx + 5, top + 8);
    }

    // lighter dashed crosshair follows the mouse hover (secondary)
    if (hover) {
      const x = X(times[hover.i]);
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, panels[2].y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [rows, times, hover, pickedIdx]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const nearest = (mx: number) => {
    const g = geom.current;
    if (!g) return 0;
    const X = (t: number) => g.L + ((t - g.t0) / (g.t1 - g.t0 || 1)) * g.plotW;
    let bi = 0;
    let bd = Infinity;
    times.forEach((t, i) => {
      const dx = Math.abs(X(t) - mx);
      if (dx < bd) {
        bd = dx;
        bi = i;
      }
    });
    return bi;
  };

  const hoverRow = hover ? rows[hover.i] : null;

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="w-full block rounded-lg border border-gray-800 bg-[var(--layer-1)] cursor-crosshair"
        onMouseMove={(e) => {
          const g = geom.current;
          const rc = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - rc.left;
          if (!g || mx < g.L || mx > g.W - g.R) {
            setHover(null);
            return;
          }
          setHover({ i: nearest(mx), x: e.clientX - rc.left, y: e.clientY - rc.top });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const rc = e.currentTarget.getBoundingClientRect();
          onPick(nearest(e.clientX - rc.left));
        }}
      />
      {hover && hoverRow && (
        <div
          className="pointer-events-none absolute z-10 min-w-[180px] rounded-lg border border-gray-700 bg-[var(--layer-2)] px-2.5 py-2 text-[11px] shadow-lg"
          style={{
            left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth || 0) - 200),
            top: hover.y + 8,
          }}
        >
          <div className="text-gray-400 mb-1">
            {hoverRow.timestamp.slice(0, 10)} {hoverRow.timestamp.slice(11, 16)}
            {hoverRow.is_signal ? ' · ●신호' : ''}
          </div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <b className="text-gray-200">{fmt(Number(hoverRow[s.key] ?? 0))}</b>
            </div>
          ))}
          <div className="border-t border-gray-700 my-1" />
          {HYPS.map((h) => (
            <div key={h.key} className="flex justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: h.color }} />
                {h.key}
              </span>
              <b className="text-gray-200">{fmt(Number(hoverRow.hypotheses?.[h.key] ?? 0))}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Influence flow graph (Sankey-ish) ------------------------------------
// Renders the `graph` payload from GET /api/v1/inference at the scrubbed time as a left→right
// flow: 증거유형(A-Box) → {s1/s2/s3 stages · fuel/range axes} → {P outputs · PH}.
//   • the A-Box evidence type is the mechanism — likelihood_db is keyed by it. Type nodes are
//     grouped by ontology class (이동물체/활동/신호방출); their dB is aggregated over the shown obs.
//   • type→stage / type→axis edges are *live* contributions (thickness ∝ |dB|, color = sign).
//   • stage→output and axis→hypothesis edges are structural wiring (muted grey).
type GNode = {
  id: string;
  kind: 'obs' | 'type' | 'stage' | 'axis' | 'output' | 'hyp';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label: string;
  sub?: string;
  prob?: number;
  gold?: boolean;
  title: string;
};
type GEdge = {
  id: string;
  from: string;
  to: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  color: string;
  struct: boolean;
  title: string;
};

function signed(n: number) {
  return `${n >= 0 ? '+' : ''}${n}`;
}

// Distribute node centers down a column, adding a gap where the group index changes.
function columnY(groups: number[], top: number, avail: number) {
  const n = groups.length;
  if (!n) return { ys: [] as number[], slot: 0 };
  const breaks = groups.filter((g, i) => i > 0 && g !== groups[i - 1]).length;
  const slot = avail / (n + breaks * 0.6);
  let acc = 0;
  const ys = groups.map((g, i) => {
    if (i > 0 && g !== groups[i - 1]) acc += 0.6;
    return top + slot * (i + acc + 0.5);
  });
  return { ys, slot };
}

type GLabel = { x: number; y: number; text: string; color: string };
function buildLayout(
  graph: GraphData,
  W: number,
  H: number,
): { nodes: GNode[]; edges: GEdge[]; headers: [number, string][]; groupLabels: GLabel[] } {
  if (W < 40 || H < 40) return { nodes: [], edges: [], headers: [], groupLabels: [] };
  const top = 34;
  const bottom = 26;
  const availH = H - top - bottom;

  // 3 columns: 증거유형(A-Box) → s1/s2/s3·축 → 출력·PH
  const typeW = Math.min(180, Math.max(120, W * 0.24));
  const typeX = 6;
  const outW = Math.min(190, Math.max(130, W * 0.26));
  const outX = W - 6 - outW;
  const latW = 108;
  const latX = (typeX + typeW + outX) / 2 - latW / 2;

  const nodes: GNode[] = [];
  const byId = new Map<string, GNode>();
  const push = (node: GNode) => {
    nodes.push(node);
    byId.set(node.id, node);
  };

  const nh = (slot: number) => Math.max(20, Math.min(40, slot * 0.72));

  // Column 1 — A-Box evidence types, ordered + grouped by ontology class (이동물체/활동/신호방출).
  const groupLabels: GLabel[] = [];
  const typeItems = graph.types
    .map((t) => ({ t, meta: typeMeta(t.name) }))
    .sort((a, b) => a.meta.group - b.meta.group || Math.abs(b.t.db) - Math.abs(a.t.db));
  const typeY = columnY(typeItems.map((it) => it.meta.group), top, availH);
  const typeH = nh(typeY.slot);
  const seenGroup = new Set<number>();
  typeItems.forEach((it, i) => {
    push({
      id: `type:${it.t.name}`,
      kind: 'type',
      x: typeX,
      y: typeY.ys[i],
      w: typeW,
      h: typeH,
      color: it.meta.color,
      label: it.meta.label,
      sub: `${signed(it.t.db)} dB`,
      title: `${it.meta.label} (${it.t.name}) · ${TYPE_GROUPS[it.meta.group] ?? '기타'}\n순 기여 ${signed(it.t.db)} dB`,
    });
    if (!seenGroup.has(it.meta.group)) {
      seenGroup.add(it.meta.group);
      groupLabels.push({
        x: typeX,
        y: typeY.ys[i] - typeH / 2 - 4,
        text: TYPE_GROUPS[it.meta.group] ?? '기타',
        color: it.meta.color,
      });
    }
  });

  // Column 2 — latents: stages then axes
  const latItems = [
    ...graph.stages.map((s) => ({ group: 0, s })),
    ...graph.axes.map((a) => ({ group: 1, a })),
  ];
  const latY = columnY(latItems.map((it) => it.group), top, availH);
  const latH = nh(latY.slot);
  graph.stages.forEach((s, i) => {
    const meta = STAGE_META[s.name] || { label: s.name, color: '#9ca3af' };
    push({
      id: `stage:${s.name}`,
      kind: 'stage',
      x: latX,
      y: latY.ys[i],
      w: latW,
      h: latH,
      color: meta.color,
      label: meta.label,
      prob: s.prob,
      title: `${meta.label} (${s.name})\ns = ${s.prob.toFixed(3)} · prior ${s.prior_db} dB`,
    });
  });
  graph.axes.forEach((a, k) => {
    const i = graph.stages.length + k;
    const meta = AXIS_META[a.name] || { label: a.name, color: '#9ca3af' };
    push({
      id: `axis:${a.name}`,
      kind: 'axis',
      x: latX,
      y: latY.ys[i],
      w: latW,
      h: latH,
      color: meta.color,
      label: meta.label,
      prob: a.prob,
      title: `${meta.label} (${a.name})\nP(${a.pos}) = ${a.prob.toFixed(3)} · P(${a.neg}) = ${(1 - a.prob).toFixed(3)}`,
    });
  });

  // Column 3 — outputs then hypotheses
  const maxHyp = graph.hypotheses.reduce((m, h) => Math.max(m, h.prob), 0);
  const outItems = [
    ...graph.outputs.map((o) => ({ group: 0, o })),
    ...graph.hypotheses.map((h) => ({ group: 1, h })),
  ];
  const outY = columnY(outItems.map((it) => it.group), top, availH);
  const outH = nh(outY.slot);
  graph.outputs.forEach((o, i) => {
    const meta = OUTPUT_META[o.name] || { label: o.name, color: '#e5e7eb' };
    push({
      id: `out:${o.name}`,
      kind: 'output',
      x: outX,
      y: outY.ys[i],
      w: outW,
      h: outH,
      color: meta.color,
      label: meta.label,
      prob: o.value,
      sub: o.value.toFixed(3),
      title: `${meta.label} = ${o.value.toFixed(4)}\n${o.expr}`,
    });
  });
  graph.hypotheses.forEach((h, k) => {
    const i = graph.outputs.length + k;
    push({
      id: `hyp:${h.label}`,
      kind: 'hyp',
      x: outX,
      y: outY.ys[i],
      w: outW,
      h: outH,
      color: HYP_COLOR[h.label] || '#c084fc',
      label: h.label,
      prob: h.prob,
      sub: h.prob.toFixed(3),
      gold: h.prob === maxHyp && maxHyp > 0,
      title: `PH ${h.label} = ${h.prob.toFixed(4)}`,
    });
  });

  // ---- edges -----
  const edges: GEdge[] = [];
  const anchor = (from: GNode, to: GNode) => ({ ax: from.x + from.w, ay: from.y, bx: to.x, by: to.y });
  const maxFlow = Math.max(
    1,
    ...graph.type_stage_edges.map((e) => Math.abs(e.residual_db)),
    ...graph.type_axis_edges.map((e) => Math.abs(e.db)),
  );
  const flowW = (v: number) => 1.5 + 7.5 * Math.min(1, Math.abs(v) / maxFlow);
  const structW = (p: number) => 0.6 + 3.9 * Math.max(0, Math.min(1, p));
  const sign = (v: number) => (v >= 0 ? POS_EDGE : NEG_EDGE);
  const addEdge = (fromId: string, toId: string, width: number, color: string, struct: boolean, title: string) => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) return;
    edges.push({ id: `${fromId}->${toId}`, from: fromId, to: toId, ...anchor(from, to), width, color, struct, title });
  };

  // evidence type → stage (leaky residual) and → axis (static)
  graph.type_stage_edges.forEach((e) => {
    addEdge(`type:${e.type}`, `stage:${e.stage}`, flowW(e.residual_db), sign(e.residual_db), false,
      `${typeMeta(e.type).label} → ${STAGE_META[e.stage]?.label || e.stage}: ${signed(e.residual_db)} dB (leaky residual)`);
  });
  graph.type_axis_edges.forEach((e) => {
    addEdge(`type:${e.type}`, `axis:${e.axis}`, flowW(e.db), sign(e.db), false,
      `${typeMeta(e.type).label} → ${AXIS_META[e.axis]?.label || e.axis}: ${signed(e.db)} dB (static)`);
  });
  // structural: stage → output (stage name present in the output expression)
  graph.outputs.forEach((o) => {
    graph.stages.forEach((s) => {
      if (o.expr.includes(s.name)) {
        addEdge(`stage:${s.name}`, `out:${o.name}`, structW(s.prob), STRUCT_EDGE, true,
          `${STAGE_META[s.name]?.label || s.name} → ${OUTPUT_META[o.name]?.label || o.name}`);
      }
    });
  });
  // structural: axis → hypothesis (every hypothesis is a product over both axes)
  graph.hypotheses.forEach((h) => {
    graph.axes.forEach((a) => {
      addEdge(`axis:${a.name}`, `hyp:${h.label}`, structW(h.prob), STRUCT_EDGE, true,
        `${AXIS_META[a.name]?.label || a.name} → PH ${h.label}`);
    });
  });

  const headers: [number, string][] = [
    [typeX + typeW / 2, '증거유형 (A-Box)'],
    [latX + latW / 2, 's1/s2/s3 · 연료/사거리축'],
    [outX + outW / 2, 'P(발사·활동) · 가설 PH'],
  ];

  return { nodes, edges, headers, groupLabels };
}

function edgePath(e: GEdge) {
  const dx = Math.max(24, (e.bx - e.ax) * 0.4);
  return `M ${e.ax} ${e.ay} C ${e.ax + dx} ${e.ay}, ${e.bx - dx} ${e.by}, ${e.bx} ${e.by}`;
}

function InfluenceGraph({ graph, at }: { graph: GraphData; at: string | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setDim({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges, headers, groupLabels } = useMemo(
    () => buildLayout(graph, dim.w, dim.h),
    [graph, dim.w, dim.h],
  );

  // hover connectivity
  const neighbors = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    edges.forEach((e) => {
      if (e.from === hoverId) set.add(e.to);
      if (e.to === hoverId) set.add(e.from);
    });
    return set;
  }, [hoverId, edges]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full rounded-lg border border-gray-800 bg-[var(--layer-1)] overflow-hidden"
    >
      {dim.w > 40 && (
        <svg width={dim.w} height={dim.h} className="block">
          {/* column headers */}
          {headers.map(([x, label]) => (
            <text key={label} x={x} y={16} textAnchor="middle" className="fill-gray-500" fontSize={11} fontWeight={600}>
              {label}
            </text>
          ))}
          {/* ontology-class labels within the evidence-type column */}
          {groupLabels.map((g) => (
            <text key={g.text} x={g.x + 1} y={g.y} fontSize={9.5} fontWeight={600} fill={g.color} opacity={0.85}>
              {g.text}
            </text>
          ))}

          {/* structural edges under flow edges */}
          {edges
            .filter((e) => e.struct)
            .map((e) => {
              const on = !hoverId || e.from === hoverId || e.to === hoverId;
              return (
                <path
                  key={e.id}
                  d={edgePath(e)}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={e.width}
                  strokeLinecap="round"
                  opacity={hoverId ? (on ? 0.6 : 0.05) : 0.28}
                  strokeDasharray="1 5"
                >
                  <title>{e.title}</title>
                </path>
              );
            })}
          {/* live contribution edges */}
          {edges
            .filter((e) => !e.struct)
            .map((e) => {
              const on = !hoverId || e.from === hoverId || e.to === hoverId;
              return (
                <path
                  key={e.id}
                  d={edgePath(e)}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={e.width}
                  strokeLinecap="round"
                  opacity={hoverId ? (on ? 0.9 : 0.06) : 0.55}
                >
                  <title>{e.title}</title>
                </path>
              );
            })}

          {/* nodes */}
          {nodes.map((n) => {
            const active = !neighbors || neighbors.has(n.id);
            const x = n.x;
            const y = n.y - n.h / 2;
            return (
              <g
                key={n.id}
                opacity={active ? 1 : 0.25}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                style={{ cursor: 'pointer' }}
              >
                <title>{n.title}</title>
                <rect
                  x={x}
                  y={y}
                  width={n.w}
                  height={n.h}
                  rx={5}
                  fill={n.color}
                  fillOpacity={0.14}
                  stroke={n.gold ? 'var(--ai-gold)' : n.color}
                  strokeWidth={n.gold ? 2 : 1.2}
                />
                {/* probability / value fill bar along the bottom */}
                {n.prob !== undefined && n.h >= 24 && (
                  <rect
                    x={x + 6}
                    y={y + n.h - 5}
                    width={(n.w - 12) * Math.max(0, Math.min(1, n.prob))}
                    height={3}
                    rx={1.5}
                    fill={n.color}
                    opacity={0.85}
                  />
                )}
                <text x={x + 8} y={y + (n.sub && n.h >= 30 ? 15 : n.h / 2 + 4)} fontSize={11} className="fill-gray-100">
                  {n.label}
                </text>
                {n.prob !== undefined && (
                  <text x={x + n.w - 8} y={y + 15} textAnchor="end" fontSize={11} className="fill-gray-400" fontFamily="monospace">
                    {n.sub ?? n.prob.toFixed(2)}
                  </text>
                )}
                {n.sub && n.h >= 30 && n.prob === undefined && (
                  <text x={x + 8} y={y + n.h - 8} fontSize={9.5} className="fill-gray-500">
                    {n.sub}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* legend + timestamp */}
      <div className="pointer-events-none absolute bottom-1.5 left-3 right-3 flex items-center gap-3 text-[10px] text-gray-500">
        <LegendSwatch color={POS_EDGE} label="+dB" />
        <LegendSwatch color={NEG_EDGE} label="−dB" />
        <LegendSwatch color={STRUCT_EDGE} label="구조 wiring" dashed />
        <span className="ml-auto font-mono text-gray-600">{at ? `${at.slice(0, 10)} ${at.slice(11, 16)}` : ''}</span>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-4 h-0.5 rounded"
        style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 5px)` : color }}
      />
      {label}
    </span>
  );
}
