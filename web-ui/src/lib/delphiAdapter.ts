import { InferenceResult, HypothesisNode, EvidenceContribution } from '@/types';

const LABEL_MAP: Record<string, { id: string; name: string }> = {
  '액체·장거리': { id: 'h-liquid-long',  name: '액체연료 중장거리 미사일(ICBM/IRBM)' },
  '고체·장거리': { id: 'h-solid-long',   name: '고체연료 중장거리 미사일(IRBM/ICBM)' },
  '액체·단거리': { id: 'h-liquid-short', name: '액체연료 단거리 미사일' },
  '고체·단거리': { id: 'h-solid-short',  name: '고체연료 단거리 미사일(SRBM)' },
};

export function adaptDelphiInference(resp: any): InferenceResult {
  const hypotheses: HypothesisNode[] = Object.entries(resp.hypotheses ?? {})
    .map(([label, posterior]) => ({
      ...(LABEL_MAP[label] ?? { id: label, name: label }),
      category: 'missile_launch',
      prior: 0.1,
      posterior: posterior as number,
      uncertainty: 0.1,
      evidenceChain: [],
    }))
    .sort((a, b) => b.posterior - a.posterior);

  const contributions: EvidenceContribution[] = (resp.launch_contributions ?? []).map((c: any) => ({
    actionId: c.obs_id,
    likelihood: Math.min((c.residual_db ?? 0) / 30, 1),
    weight: 1,
    logOdds: c.residual_db ?? 0,
    contribution: Math.min((c.residual_db ?? 0) / 30, 1),
  }));

  return {
    hypotheses,
    topHypothesis: hypotheses[0] ?? null,
    overallConfidence: resp.p_launch ?? 0,
    updatedAt: resp.timestamp ?? new Date().toISOString(),
    evidenceCount: contributions.length,
    evidenceContributions: contributions,
  };
}
