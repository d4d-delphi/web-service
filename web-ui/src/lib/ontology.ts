import fs from 'fs';
import path from 'path';

// 온톨로지 JSON 미러는 export_ontology_mirror.py 가 supabase 에서 내보낸 것 (gitignore, data/).
// 서버 런타임에만 fs 로 읽고, 없으면(fresh clone) 빈 배열로 폴백 — 키 불필요.

export interface MissileEntity {
  canonicalName: string;
  slug: string;
  weaponClass: string;
  family: string | null;
  fuelType: string | null;
  kn: string | null;
  rangeKm: number | string | null;
  aliases: string[];
  matchedAlias: string;
}

export interface FacilityEntity {
  canonicalName: string;
  slug: string;
  facilityType: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  fuelType: string | null;
  role: string | null;
  aliases: string[];
  matchedAlias: string;
}

interface MissileMirror {
  canonicalName: string; slug: string; weaponClass: string; family: string | null;
  fuelType: string | null; kn: string | null; rangeKm: number | string | null; aliases: string[];
}
interface FacilityMirror {
  canonicalName: string; slug: string; facilityType: string | null; region: string | null;
  lat: number | null; lng: number | null; fuelType: string | null; role: string | null; aliases: string[];
}

function loadMirror<T>(name: string): T[] {
  try {
    const file = path.join(process.cwd(), 'src', 'data', name);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T[];
  } catch {
    return [];
  }
}

// 텍스트 안에서 가장 길게 매칭되는 alias 로 정규 엔티티 해석. (긴 alias = 더 구체적)
function resolve<T extends { aliases: string[] }>(
  text: string,
  pool: T[],
): (T & { matchedAlias: string })[] {
  const low = text.toLowerCase();
  const hits: (T & { matchedAlias: string })[] = [];
  for (const entity of pool) {
    let best: string | null = null;
    for (const alias of entity.aliases) {
      const a = alias.toLowerCase();
      if (a.length >= 2 && low.includes(a) && (!best || a.length > best.length)) {
        best = a;
      }
    }
    if (best) hits.push({ ...entity, matchedAlias: best });
  }
  return hits.sort((a, b) => b.matchedAlias.length - a.matchedAlias.length);
}

export function resolveMissile(text: string): MissileEntity[] {
  return resolve(text, loadMirror<MissileMirror>('missile-ontology.json'));
}

export function resolveFacility(text: string): FacilityEntity[] {
  return resolve(text, loadMirror<FacilityMirror>('facility-ontology.json'));
}

// 해석 결과를 LLM 프롬프트용 텍스트로 직렬화
export function formatEntitiesForPrompt(params: {
  missiles: MissileEntity[];
  facilities: FacilityEntity[];
}): string {
  const { missiles, facilities } = params;
  const parts: string[] = [];
  if (facilities.length) {
    parts.push('정규 시설(온톨로지 해석):\n' + facilities.slice(0, 6).map((f) =>
      `- ${f.canonicalName} [${f.facilityType ?? '?'}]${f.lat != null ? ` (${f.lat.toFixed(2)},${f.lng?.toFixed(2)})` : ''}${f.fuelType ? ` 연료:${f.fuelType}` : ''} — 매칭: "${f.matchedAlias}"`).join('\n'));
  }
  if (missiles.length) {
    parts.push('정규 미사일 체계(온톨로지 해석):\n' + missiles.slice(0, 6).map((m) =>
      `- ${m.canonicalName}${m.kn ? `(${m.kn})` : ''} [${m.weaponClass}]${m.fuelType ? ` ${m.fuelType}` : ''}${m.rangeKm ? ` 사거리~${m.rangeKm}km` : ''} — 매칭: "${m.matchedAlias}"`).join('\n'));
  }
  return parts.join('\n\n');
}
