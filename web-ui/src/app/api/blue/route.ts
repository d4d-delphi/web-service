import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { FriendlyUnit } from '@/types';

// 아군(Blue) 전투서열/작전 자산 조회. 원천 = supabase friendly_units; 평면 미러
// (friendly-units.json)를 서버 fs 로 읽는다(키 불필요, 부재 시 빈 배열).
function loadUnits(): FriendlyUnit[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', 'friendly-units.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FriendlyUnit[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const assetType = request.nextUrl.searchParams.get('assetType'); // KAMD_DETECT/KAMD_INTERCEPT/KMPR_STRIKE/AIR/NAVAL/ISR/...
  const branch = request.nextUrl.searchParams.get('branch');       // army/air/naval/strategic
  const role = request.nextUrl.searchParams.get('role');           // 부분일치
  const pillar = request.nextUrl.searchParams.get('pillar');       // kamd/lamd/kmpr/isr (asset_type 그룹)
  const readiness = request.nextUrl.searchParams.get('readiness'); // ready/standby/...

  let units = loadUnits();

  // pillar 가상 필터: 교리 축 그룹으로 asset_type 매핑
  if (pillar) {
    const typeGroups: Record<string, string[]> = {
      kamd: ['KAMD_DETECT', 'NAVAL'],
      lamd: ['KAMD_INTERCEPT'],
      kmpr: ['KMPR_STRIKE', 'AIR'],
      isr: ['ISR'],
    };
    const grp = typeGroups[pillar] ?? [];
    units = units.filter((u) => grp.includes(u.assetType));
  }
  if (assetType) units = units.filter((u) => u.assetType === assetType);
  if (branch) units = units.filter((u) => u.branch === branch);
  if (readiness) units = units.filter((u) => u.readiness === readiness);
  if (role) units = units.filter((u) => (u.role ?? '').toLowerCase().includes(role.toLowerCase()));

  // 축별 요약 카운트(프론트 요약용)
  const byType: Record<string, number> = {};
  for (const u of units) byType[u.assetType] = (byType[u.assetType] ?? 0) + 1;

  return NextResponse.json({ count: units.length, byType, units });
}
