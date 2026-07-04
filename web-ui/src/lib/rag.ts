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

// 의미론적 검색(pgvector) — OPENAI_API_KEY + Supabase 키가 있고 launch_cases.embedding 이
// 백필된 경우에만 동작. 하나라도 없으면 null → 키워드 union 으로 폴백.
// openai 팩키지는 동적 require 로, 미설치/미설정 시 조용히 스킵.
function tryRequire(mod: string): any {
  try { return (require as any)(mod); } catch { return null; }
}

async function vectorSearch(indicators: string[], topK: number): Promise<AnyCase[] | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!openaiKey || !supabaseUrl || !supabaseKey) return null;
  const OpenAI = tryRequire('openai')?.OpenAI;
  if (!OpenAI) return null;
  try {
    const client = new OpenAI({ apiKey: openaiKey });
    const emb = await client.embeddings.create({
      model: 'text-embedding-3-small', input: indicators.join(' '),
    });
    const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/match_launch_cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query_embedding: emb.data[0].embedding, match_count: topK }),
    });
    if (!resp.ok) return null;
    const rows = (await resp.json()) as any[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.map((r) => ({
      id: `lc-${r.case_no}`, caseNo: r.case_no as number, date: r.launch_date as string,
      title: `${r.missile_name} (${r.weapon_class}) 발사`,
      missileType: `${r.weapon_class} (${r.missile_name})`,
      outcome: r.outcome as string, indicators: (r.indicators ?? []) as string[],
      description: (r.description ?? '') as string, similarity: r.similarity as number,
    })) as LaunchCase[];
  } catch (error) {
    console.error('vector search failed, keyword fallback:', error);
    return null;
  }
}

export async function searchSimilarCases(
  currentIndicators: string[],
  topK: number = 3
): Promise<AnyCase[]> {
  // 1) 의미론적 검색(pgvector) — 키/임베딩 있을 때 우선
  const vec = await vectorSearch(currentIndicators, topK);
  if (vec && vec.length) return vec;

  // 2) 키워드 union 폴백 (historical-cases-full + launch-cases 미러)
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
