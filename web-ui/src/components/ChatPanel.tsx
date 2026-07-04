'use client';

import { useState, useRef, useEffect } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 좁은 다크 패널에 맞춘 컴팩트 마크다운 매핑. 기본 마진을 줄이고 링크는 새 탭으로.
const mdComponents: Components = {
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-4 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-4 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="marker:text-gray-500">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-cyan-400 underline underline-offset-2">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mt-2 mb-1 text-[13px] font-bold text-cyan-300">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2 mb-1 text-[13px] font-bold text-cyan-300">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-[12px] font-semibold text-cyan-300">{children}</h3>,
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} block overflow-x-auto rounded bg-black/40 p-2 my-1 font-mono text-[11px]`}>
        {children}
      </code>
    ) : (
      <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px] text-cyan-200">{children}</code>
    ),
  pre: ({ children }) => <pre className="my-1">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-gray-600 pl-2 text-gray-400">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-gray-700 px-1.5 py-0.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-gray-700 px-1.5 py-0.5">{children}</td>,
  hr: () => <hr className="my-2 border-gray-700/60" />,
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 강조(`**`/`*`)가 닫히지 않는 CommonMark 플랭킹 엣지케이스를 교정한다.
// 한국어는 조사가 붙어 `**...)**로`, `**20%**입니다`처럼 닫는 구분자가 "구두점 뒤 +
// 곧바로 글자"인 경우가 잦은데, 이때 닫는 `**`가 right-flanking 조건을 못 채워 강조가
// 통째로 평문으로 남는다. 구두점과 닫는 구분자 사이에 폭 없는 공백(U+200B)을 끼워
// 넣어 정상적으로 닫히게 한다(화면상 변화 없음). 별표(`*`)·역따옴표는 대상에서 제외하고,
// 인라인 코드(`...`)는 건드리지 않는다.
function fixEmphasisFlanking(line: string): string {
  return line
    .split(/(`+[^`]*`+)/)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(/([^\s\p{L}\p{N}*`])(\*{1,2})(?=[\p{L}\p{N}])/gu, '$1​$2'),
    )
    .join('');
}

// LLM 출력에서 흔한 마크다운 엣지케이스를 렌더 직전에 교정한다.
//  (1) `굵은 제목\n---` 은 CommonMark 상 setext 제목(밑줄)로 해석돼 `---` 구분선이
//      사라지고 앞 줄이 <h2>로 병합된다. → 구분선 앞에 빈 줄을 넣어 수평선으로 강제.
//  (2) 선행 공백 4칸 이상인 줄은 들여쓰기 코드블록이 되어 `**굵게**` 등이 그대로
//      노출된다. → 목록 맥락이 아닌 줄의 과도한 선행 공백을 제거.
//  (3) 조사가 붙어 닫히지 않는 강조 구분자 교정(fixEmphasisFlanking).
// 코드펜스(``` / ~~~) 내부는 원문 그대로 보존한다.
function normalizeMarkdown(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  const fenceRe = /^\s*(```|~~~)/;
  const underlineRe = /^ {0,3}(-{3,}|={3,})\s*$/;
  const listRe = /^\s*([-*+]|\d+[.)])\s/;
  let inFence = false;
  let listContext = false;
  for (const raw of lines) {
    if (fenceRe.test(raw)) {
      inFence = !inFence;
      out.push(raw);
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    // (1) setext 밑줄로 오인되는 --- / === 를 수평선(빈 줄 + ---)으로 정규화.
    if (underlineRe.test(raw)) {
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push('---');
      listContext = false;
      continue;
    }
    // 목록 맥락 추적: 목록 항목이면 진입, 들여쓰기 없는 비목록 줄이면 해제, 빈 줄은 유지.
    if (listRe.test(raw)) listContext = true;
    else if (raw.trim() !== '' && !/^\s/.test(raw)) listContext = false;

    // (2) 실수로 들어간 4칸+ 들여쓰기(코드블록화) 방지 — 목록 맥락이 아닐 때만.
    let line = raw;
    if (!listContext && /^ {4,}\S/.test(line) && !listRe.test(line)) {
      line = line.replace(/^ +/, '');
    }
    // (3) 조사·구두점 때문에 닫히지 않는 강조 교정.
    line = fixEmphasisFlanking(line);
    out.push(line);
  }
  return out.join('\n');
}

interface ChatPanelProps {
  /** 현재 시나리오/추론 상황 요약. 매 질의 시 시스템 컨텍스트로 전달된다. */
  context?: string;
}

export default function ChatPanel({ context }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 쌓이면 항상 하단으로 스크롤.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, context }),
      });

      // 오류 응답은 JSON({error})으로 온다. 정상 응답은 평문 스트림.
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          /* 본문 없음 */
        }
        throw new Error(msg);
      }

      // 어시스턴트 메시지 자리를 먼저 만들고, 스트림 델타를 이어 붙인다.
      setMessages((m) => [...m, { role: 'assistant', content: '' }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: acc };
          return copy;
        });
      }
      if (!acc) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: '(빈 응답)' };
          return copy;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청 실패');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="h-full flex flex-col layer-1 border-l border-t border-blue-900/30">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-blue-900/30 bg-blue-950/20">
        <h2 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
          지휘 참모 AI
        </h2>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && !loading && (
          <p className="text-[11px] text-gray-600 leading-relaxed mt-1">
            현재 상황이나 위협 판단에 대해 질문하세요. 예: &ldquo;지금 발사 가능성을 어떻게 봐야 하나?&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed break-words ${
                m.role === 'user'
                  ? 'bg-blue-600/25 border border-blue-500/30 text-blue-100 whitespace-pre-wrap'
                  : 'bg-gray-800/50 border border-gray-700/40 text-gray-200'
              }`}
            >
              {m.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {normalizeMarkdown(m.content)}
                </ReactMarkdown>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="rounded-lg px-2.5 py-1.5 bg-gray-800/50 border border-gray-700/40 text-[12px] text-gray-400">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/70 animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/70 animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/70 animate-bounce"></span>
              </span>
            </div>
          </div>
        )}
        {error && (
          <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/40 rounded px-2 py-1">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-blue-900/30 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="질문 입력… (Enter 전송, Shift+Enter 줄바꿈)"
            className="flex-1 resize-none max-h-24 rounded-md bg-gray-900/70 border border-gray-700/50 focus:border-cyan-600/60 outline-none px-2.5 py-1.5 text-[12px] text-gray-100 placeholder:text-gray-600"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="shrink-0 h-8 px-3 rounded-md bg-cyan-600/80 hover:bg-cyan-500 disabled:bg-gray-700/50 disabled:text-gray-500 text-white text-[12px] font-medium transition-colors"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
