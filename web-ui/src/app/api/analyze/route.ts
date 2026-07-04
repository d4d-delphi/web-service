import { NextRequest, NextResponse } from 'next/server';
import { analyzeThreats } from '@/lib/claude';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { threats, friendlies } = body;

    const threatsStr = JSON.stringify(threats, null, 2);
    const friendliesStr = JSON.stringify(friendlies, null, 2);

    const analysis = await analyzeThreats(threatsStr, friendliesStr);

    let parsed;
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { analysis };
    } catch {
      parsed = { analysis };
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Analyze API error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze threats' },
      { status: 500 }
    );
  }
}
