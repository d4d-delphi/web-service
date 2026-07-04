import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { toPoint } from 'mgrs';
import { ActionClassType, Coordinates, TimelineEvent } from '@/types';

// Read the shared "Delphi" Supabase project directly from Next.js (server-side),
// replacing the old FastAPI hop. Env now lives in web-ui/.env.local — the
// service-role key is server-only and never shipped to the browser.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// One row of Layer 1 원천 첩보. Only the fields we map are typed here.
interface ObservationRow {
  obs_id: string;
  asset_type: 'SATELLITE_IMINT' | 'AERIAL_IMINT' | 'SIGINT' | 'UAV_FLIR' | 'OSINT';
  polarity: 'PRESENT' | 'ABSENT';
  collected_at: string;
  mgrs: string | null;
  location_name: string | null;
  observed_objects: { type: string; count: number }[];
  activity_desc: string;
  unusual_flag: boolean;
  platform: string;
  reliability: number;
}

// 감시 자산 종류 → 베이지안 파이프라인 액션 클래스
const ASSET_CLASS: Record<ObservationRow['asset_type'], ActionClassType> = {
  SATELLITE_IMINT: 'IMINT',
  AERIAL_IMINT: 'IMINT',
  SIGINT: 'SIGINT',
  UAV_FLIR: 'UAV',
  OSINT: 'OSINT',
};

// 자산 종류 → 인텔피드 이벤트 타입 (배지/색상용)
const ASSET_EVENT_TYPE: Record<ObservationRow['asset_type'], TimelineEvent['type']> = {
  SATELLITE_IMINT: 'intel',
  AERIAL_IMINT: 'intel',
  SIGINT: 'alert',
  UAV_FLIR: 'movement',
  OSINT: 'alert',
};

// MGRS 군사좌표 → WGS84 lat/lng. 파싱 실패 시 undefined (지도에 표시 안 함).
function parseMgrs(mgrs: string | null): Coordinates | undefined {
  if (!mgrs) return undefined;
  try {
    // `mgrs` 라이브러리는 공백 없는 문자열을 기대한다 ("51S XD 4600 9100" → "51SXD46009100").
    const [lng, lat] = toPoint(mgrs.replace(/\s+/g, ''));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch {
    /* 좌표 없는 관측(일부 OSINT 등)은 조용히 건너뛴다 */
  }
  return undefined;
}

// location_name은 길어서(괄호·영문 병기) 피드 제목으로는 앞부분만 사용한다.
function shortTitle(row: ObservationRow): string {
  const base = row.location_name ?? row.platform;
  return base.split(/[(\-–]/)[0].trim() || row.asset_type;
}

function mapRow(row: ObservationRow, fraction: number): TimelineEvent {
  const date = new Date(row.collected_at);
  return {
    id: row.obs_id,
    time: Number.isNaN(date.getTime())
      ? row.collected_at
      : date.toISOString().slice(0, 10), // YYYY-MM-DD
    timestamp: 0, // 재생 축은 클라이언트에서 시나리오 duration에 맞춰 매핑
    timeFraction: fraction,
    title: row.polarity === 'ABSENT' ? `[부재] ${shortTitle(row)}` : shortTitle(row),
    description: row.activity_desc,
    type: ASSET_EVENT_TYPE[row.asset_type] ?? 'intel',
    threatLevel: row.reliability,
    actionClass: ASSET_CLASS[row.asset_type] ?? 'IMINT',
    actionId: row.obs_id,
    position: parseMgrs(row.mgrs),
    mgrs: row.mgrs ?? undefined,
    collectedAt: row.collected_at,
  };
}

export async function GET() {
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: 'Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('observation')
    .select(
      'obs_id, asset_type, polarity, collected_at, mgrs, location_name, observed_objects, activity_desc, unusual_flag, platform, reliability',
    )
    .order('collected_at', { ascending: true });

  if (error) {
    console.error('Supabase observation fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const rows = (data ?? []) as ObservationRow[];

  // collected_at 범위로 0..1 상대 시간축을 계산해 각 이벤트에 부여한다.
  const times = rows.map((r) => new Date(r.collected_at).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;

  const events = rows.map((row, i) => {
    const t = new Date(row.collected_at).getTime();
    const fraction = rows.length > 1 ? (t - min) / span : i;
    return mapRow(row, fraction);
  });

  return NextResponse.json({ events });
}
