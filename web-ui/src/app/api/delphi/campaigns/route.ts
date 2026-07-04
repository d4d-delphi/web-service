import { NextResponse } from 'next/server';

const BASE = process.env.DELPHI_API_URL ?? 'http://127.0.0.1:8000';

export async function GET() {
  try {
    const res = await fetch(`${BASE}/api/v1/campaigns`, { cache: 'no-store' });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'backend unavailable' }, { status: 503 });
  }
}
