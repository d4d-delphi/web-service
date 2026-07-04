import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { FriendlyFormation } from '@/types';

// 아군(ROK/USFK) 전투서열 조회. 원천 = supabase friendly_formations; 평면 미러(friendly-formations.json)를
// 서버 fs 로 읽는다(키 불필요, 부재 시 빈 배열).
function load(): FriendlyFormation[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'friendly-formations.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FriendlyFormation[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const ftype = request.nextUrl.searchParams.get('type');
  const branch = request.nextUrl.searchParams.get('branch');
  const side = request.nextUrl.searchParams.get('side');
  let units = load();
  if (ftype) units = units.filter((u) => u.formationType === ftype);
  if (branch) units = units.filter((u) => u.branch === branch);
  if (side) units = units.filter((u) => u.side === side);
  return NextResponse.json({ count: units.length, units });
}
