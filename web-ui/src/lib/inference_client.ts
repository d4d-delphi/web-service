import { InferenceResult, HypothesisNode, TimelineEvent } from '@/types';

// 백엔드(deciban 추론 엔진) 연동 — P0. env BACKEND_API_URL(예: http://127.0.0.1:8000/api/v1)이 있고
// 해당 시나리오=캠페인 매핑이 있으면 백엔드 /inference 를 쓴다. 실패/미설정 시 호출측에서 bayesian.ts 폴백.

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_API_URL;

// 시나리오 → 백엔드 캠페인. (백엔드 캠페인: unha3=동창리/은하-3, sinpo, punggye)
const SCENARIO_CAMPAIGN: Record<string, string> = {
  'scenario-a': 'unha3',
};

export function scenarioToCampaign(scenarioId?: string): string | null {
  if (!scenarioId) return null;
  return SCENARIO_CAMPAIGN[scenarioId] ?? null;
}

export function backendEnabled(): boolean {
  return Boolean(BACKEND);
}

// 데모 재생 시각(visible events) → 백엔드 쿼리용 ISO `at` (가장 최근 관측 시각).
export function latestObservationAt(events: TimelineEvent[], currentTime: number): string | null {
  const ts = events
    .filter((e) => e.timestamp <= currentTime && e.collectedAt)
    .map((e) => e.collectedAt as string);
  if (!ts.length) return null;
  return ts.sort().slice(-1)[0];
}

interface BackendContribution {
  obs_id: string;
  contribution_db: number;
  source?: Record<string, unknown>;
}
interface BackendInference {
  campaign_id: string;
  timestamp: string;
  seq: number;
  hypotheses: Record<string, number>;
  p_launch: number;
  hypothesis_contributions?: Record<string, BackendContribution[]>;
  launch_contributions?: BackendContribution[];
}

// 백엔드 추론 → 프론트 InferenceResult. obs_id 기여도(deciban)로 근거추적 가능.
// 실패 시 null (호출측이 bayesian.ts 폴백).
export async function runBackendInference(
  campaignId: string,
  atISO: string,
  topN = 8,
): Promise<InferenceResult | null> {
  if (!BACKEND) return null;
  try {
    const url =
      `${BACKEND}/inference` +
      `?campaign_id=${encodeURIComponent(campaignId)}` +
      `&at=${encodeURIComponent(atISO)}` +
      `&top_n=${topN}&include_source=true`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = (await r.json()) as BackendInference;

    const entries = Object.entries(b.hypotheses || {}).sort((a, c) => c[1] - a[1]);
    const contribsFor = (name: string) =>
      (b.hypothesis_contributions?.[name] || []).map((c) => c.obs_id);
    const nodes: HypothesisNode[] = entries.map(([name, p]) => ({
      id: name,
      name,
      category: 'missile_launch',
      prior: p,
      posterior: p,
      uncertainty: Math.max(0, 1 - p),
      evidenceChain: contribsFor(name),
    }));
    const top = nodes[0] ?? null;

    // 근거(P2 evidence-trace용): top 가설 기여도 + launch 잔여 기여도(deciban).
    const raw: BackendContribution[] = [
      ...((top && b.hypothesis_contributions?.[top.name]) || []),
      ...(b.launch_contributions || []),
    ];
    const sum = raw.reduce((s, c) => s + Math.abs(c.contribution_db), 0) || 1;
    const evidenceContributions = raw.map((c) => ({
      actionId: c.obs_id,
      likelihood: 0.5,
      weight: 1,
      logOdds: c.contribution_db,
      contribution: Math.abs(c.contribution_db) / sum,
    }));
    const evidenceCount = new Set(raw.map((c) => c.obs_id)).size;

    return {
      hypotheses: nodes,
      topHypothesis: top,
      overallConfidence: b.p_launch ?? top?.posterior ?? 0,
      updatedAt: b.timestamp,
      evidenceCount,
      evidenceContributions,
    };
  } catch {
    return null;
  }
}
