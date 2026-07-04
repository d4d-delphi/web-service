import { NextRequest, NextResponse } from 'next/server';
import { searchSimilarCases } from '@/lib/rag';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { indicators } = body;

    const cases = await searchSimilarCases(indicators);

    return NextResponse.json({ cases });
  } catch (error) {
    console.error('RAG API error:', error);
    return NextResponse.json(
      { error: 'Failed to search cases' },
      { status: 500 }
    );
  }
}
