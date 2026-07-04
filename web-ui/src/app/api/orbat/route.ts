import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MilitaryUnit } from '@/types';

// 적 전투서열(ORBAT) 조회. 원천 = supabase military_units; 평면 미러(orbat-units.json)를
// 서버 fs 로 읽는다(키 불필요, 부재 시 빈 배열).
function loadUnits(): MilitaryUnit[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'orbat-units.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as MilitaryUnit[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const branch = request.nextUrl.searchParams.get('branch');   // army/air/naval/strategic/sf 필터
  const unitType = request.nextUrl.searchParams.get('type');   // corps/missile/... 필터
  let units = loadUnits();
  if (branch) units = units.filter((u) => u.branch === branch);
  if (unitType) units = units.filter((u) => u.unitType === unitType);
  return NextResponse.json({ count: units.length, units });
}
