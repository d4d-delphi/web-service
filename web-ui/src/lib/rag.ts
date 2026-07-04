import { HistoricalCase } from '@/types';
import historicalCases from '@/data/historical-cases.json';

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

export async function searchSimilarCases(
  currentIndicators: string[],
  topK: number = 3
): Promise<HistoricalCase[]> {
  // Try Supabase vector search first, fallback to local
  try {
    const cases = (historicalCases as HistoricalCase[]).map((c) => ({
      ...c,
      similarity: calculateSimilarity(currentIndicators, c.indicators),
    }));

    return cases
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, topK);
  } catch (error) {
    console.error('RAG search error:', error);
    return (historicalCases as HistoricalCase[]).slice(0, topK);
  }
}

export function formatCasesForPrompt(cases: HistoricalCase[]): string {
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
