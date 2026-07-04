import { NextRequest, NextResponse } from 'next/server';
import { resolveMissile, resolveFacility } from '@/lib/ontology';

// 자유텍스트(보고/질의/이벤트) → 정규 엔티티(시설·미사일 체계) 해석 (Palantir 온톨로지).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text: string = typeof body === 'string' ? body : (body?.text ?? '');
    if (!text) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const facilities = resolveFacility(text);
    const missiles = resolveMissile(text);
    return NextResponse.json({ text, facilities, missiles });
  } catch (error) {
    console.error('Ontology API error:', error);
    return NextResponse.json({ error: 'Failed to resolve entities' }, { status: 500 });
  }
}
