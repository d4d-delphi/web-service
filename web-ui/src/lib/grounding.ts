import { resolveFacility, resolveMissile, formatEntitiesForPrompt } from '@/lib/ontology';
import { resolveEmitter, formatEmittersForPrompt } from '@/lib/emitter';
import { searchSimilarCases, formatCasesForPrompt } from '@/lib/rag';

// 자연어 질문 → DELPHI 지식베이스 그라운딩(정규 시설/미사일/방출원 + 과거 발사사례 RAG) 텍스트.
// /api/chat 이 시스템 프롬프트에 주입 → 우측 패널 채팅 답이 온톨로지/RAG 로 그라운딩됨.
export async function buildChatGrounding(userText: string): Promise<string> {
  if (!userText?.trim()) return '';
  const facilities = resolveFacility(userText);
  const missiles = resolveMissile(userText);
  const emitters = resolveEmitter(userText);
  const entityText = formatEntitiesForPrompt({ facilities, missiles });
  const emitterText = emitters.length ? formatEmittersForPrompt({ emitters }) : '';
  // RAG: 질문 토큰으로 과거 발사사례(launch_cases 303건) 검색
  const tokens = userText.split(/[\s,./?]+/).filter((t) => t.length > 1);
  const cases = await searchSimilarCases(tokens, 3);
  const caseText = cases.length ? formatCasesForPrompt(cases) : '';
  return [entityText, emitterText, caseText].filter(Boolean).join('\n\n');
}
