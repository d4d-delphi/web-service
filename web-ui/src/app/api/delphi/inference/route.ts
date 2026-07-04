import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.DELPHI_API_URL ?? 'http://127.0.0.1:8000';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const params = new URLSearchParams({
    campaign_id: searchParams.get('campaign_id') ?? 'unha3',
    at:          searchParams.get('at') ?? '',
    top_n:       searchParams.get('top_n') ?? '8',
  });
  try {
    const res = await fetch(`${BASE}/api/v1/inference?${params}`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: res.statusText }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'backend unavailable' }, { status: 503 });
  }
}
