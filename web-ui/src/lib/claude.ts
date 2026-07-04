import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateBriefing(
  currentSituation: string,
  historicalContext: string
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `당신은 대한민국 합참 정보분석관입니다. 현재 상황과 과거 사례를 바탕으로 간결한 상황 브리핑을 작성하세요.

## 현재 상황
${currentSituation}

## 과거 유사 사례
${historicalContext}

## 요구사항
1. 상황 요약 (2-3문장)
2. 위협 평가 (발사 가능성 %)
3. 권고 조치 (3개 이내)
4. 신뢰도 (%)

JSON 형식으로 응답:
{
  "summary": "...",
  "threatAssessment": "...",
  "confidence": 85,
  "launchProbability": 70,
  "recommendations": ["...", "...", "..."]
}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type === 'text') {
    return content.text;
  }
  return '';
}

export async function analyzeThreats(
  threats: string,
  friendlyAssets: string
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `대한민국 합참 작전분석관으로서, 적 위협과 아군 자산을 분석하여 최적 대응방안을 제시하세요.

## 적 위협
${threats}

## 아군 가용 자산
${friendlyAssets}

간결하게 분석 결과를 JSON으로:
{
  "analysis": "...",
  "priority_targets": ["...", "..."],
  "recommended_action": "...",
  "risk_level": "high/medium/low"
}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type === 'text') {
    return content.text;
  }
  return '';
}
