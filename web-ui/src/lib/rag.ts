import fs from 'fs';
import path from 'path';
import { HistoricalCase, LaunchCase } from '@/types';
import historicalCases from '@/data/mock/historical-cases-full.json';

// HistoricalCase(데모 서사형 25건)와 LaunchCase(실데이터 팩트형 303건)를 RAG에서 동일 취급.
type AnyCase = HistoricalCase | LaunchCase;

// Simple keyword-based similarity for demo (fallback when Supabase unavailable)
function calculateSimilarity(indicators: string[], caseIndicators: string[]): number {
  const normalizedInput = indicators.map((i) => i.toLowerCase());
  const normalizedCase = caseIndicators.map((i) => i.toLowerCase());

  let matches = 0;
  for (const indicator of normalizedInput) {
    for (const caseInd of normalizedCase) {
      if (
        caseInd.includes(indicator) ||
        indicator.includes(caseInd) ||
        indicator.split(' ').some((word) => caseInd.includes(word))
      ) {
        matches++;
        break;
      }
    }
  }

  return matches / Math.max(normalizedInput.length, normalizedCase.length);
}

// `launch-cases.json`은 build_launch_seed.py가 supabase 원천(CNS + nagix)에서 생성하는
// RAG용 평면 미러(303건). 데이터 정책상 gitignore(supabase가 source of truth)이므로
// 서버 런타임에만 존재 여부를 확인해 읽고, 없으면(fresh clone 등) 조용히 스킵한다.
function loadLaunchCases(): LaunchCase[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'launch-cases.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LaunchCase[];
  } catch {
    return [];
  }
}

export async function searchSimilarCases(
  currentIndicators: string[],
  topK: number = 3
): Promise<AnyCase[]> {
  // Try Supabase vector search first, fallback to local
  try {
    const all: AnyCase[] = [
      ...(historicalCases as HistoricalCase[]),
      ...loadLaunchCases(),
    ];

    const scored = all.map((c) => ({
      ...c,
      similarity: calculateSimilarity(currentIndicators, c.indicators),
    }));

    return scored
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, topK);
  } catch (error) {
    console.error('RAG search error:', error);
    return (historicalCases as HistoricalCase[]).slice(0, topK);
  }
}

export function formatCasesForPrompt(cases: AnyCase[]): string {
  return cases
    .map(
      (c, i) =>
        `### 사례 ${i + 1}: ${c.title} (${c.date})
- 미사일: ${c.missileType}
- 징후: ${c.indicators.join(', ')}
- 결과: ${c.outcome}
- 유사도: ${Math.round((c.similarity || 0) * 100)}%`
    )
    .join('\n\n');
}
