import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// 지휘 참모 AI 시스템 프롬프트: DELPHI/NL-COP 대시보드 맥락을 부여하고,
// 한국어·2,000단어 이내라는 출력 제약을 명시한다.
const SYSTEM_PROMPT = `당신은 DELPHI(NL-COP) 통합 정보융합 지휘통제 대시보드의 AI 참모입니다.
사용자는 한반도 미사일 발사 징후를 다중출처 첩보와 베이지안 추론으로 감시하는 지휘관·정보분석관입니다.

지침:
- 반드시 한국어로만 답변합니다.
- 답변은 200단어 정도로 간결하고 실무적으로 작성합니다.
- 군사·정보 분석 맥락에 맞춰 근거와 판단을 명확히 구분해 제시합니다.
- 제공된 [현재 상황 컨텍스트]가 있으면 이를 우선 반영하되, 추측은 추측이라고 표시합니다.
- 확실하지 않은 사실을 단정하지 않습니다.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY가 설정되지 않았습니다 (.env.local 확인).' },
      { status: 500 },
    );
  }

  try {
    const { messages, context } = (await req.json()) as {
      messages: ChatMessage[];
      context?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages가 비어 있습니다.' }, { status: 400 });
    }

    const systemContent = context
      ? `${SYSTEM_PROMPT}\n\n[현재 상황 컨텍스트]\n${context}`
      : SYSTEM_PROMPT;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        reasoning_effort: 'medium',
        stream: true,
        messages: [{ role: 'system', content: systemContent }, ...messages],
      }),
    });

    if (!res.ok || !res.body) {
      const detail = res.body ? await res.text() : '(no body)';
      console.error('OpenAI chat error:', res.status, detail);
      return NextResponse.json(
        { error: `OpenAI 요청 실패 (${res.status})` },
        { status: 502 },
      );
    }

    // OpenAI의 SSE(`data: {...}`)를 파싱해 델타 텍스트만 평문 청크로 클라이언트에 흘려보낸다.
    const upstream = res.body;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE 이벤트는 개행으로 구분된다. 완성된 라인만 처리하고 나머지는 버퍼에 남긴다.
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]') continue;
              try {
                const json = JSON.parse(payload);
                const delta: string = json.choices?.[0]?.delta?.content ?? '';
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // 부분 JSON 등 파싱 불가 라인은 무시.
              }
            }
          }
        } catch (err) {
          console.error('Chat stream error:', err);
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: '답변 생성에 실패했습니다.' }, { status: 500 });
  }
}
