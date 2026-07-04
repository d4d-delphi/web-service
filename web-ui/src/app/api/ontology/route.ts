import { NextRequest, NextResponse } from 'next/server';
import { resolveMissile, resolveFacility } from '@/lib/ontology';
import { resolveEmitter, interpretSigintEmitter, SigintAssetDetail } from '@/lib/emitter';

// 자유텍스트(보고/질의/이벤트) → 정규 엔티티(시설·미사일 체계·방출원) 해석 (Palantir 온톨로지).
// body.sigintDetail 가 있으면 SIGINT observation asset_detail → 정규 emitter 해석도 함께 수행.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text: string = typeof body === 'string' ? body : (body?.text ?? '');
    if (!text) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const facilities = resolveFacility(text);
    const missiles = resolveMissile(text);
    const emitters = resolveEmitter(text);
    // SIGINT asset_detail 이 같이 오면 신호특성 기반 emitter 해석 추가(D3).
    const sigintDetail: SigintAssetDetail | null = body?.sigintDetail ?? null;
    const sigintInterpretation = sigintDetail ? interpretSigintEmitter(sigintDetail) : null;
    return NextResponse.json({ text, facilities, missiles, emitters, sigintInterpretation });
  } catch (error) {
    console.error('Ontology API error:', error);
    return NextResponse.json({ error: 'Failed to resolve entities' }, { status: 500 });
  }
}

