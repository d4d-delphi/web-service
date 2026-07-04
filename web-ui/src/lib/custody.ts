// 발사(H-0) 이후 커스터디(비행 추적) 화면용 궤적/제원 합성.
// 실측 트랙이 없으므로 발사점→종단(target) 사이를 선형 지상궤적으로 잇고,
// 고도·속도·다운레인지를 재생 진행도(progress 0..1)에 따라 그럴듯하게 생성한다.
import { Coordinates, LaunchConfig, Scenario } from '@/types';

export interface TrackPoint {
  lat: number;
  lng: number;
  altKm: number;
  velKms: number;
  downrangeKm: number;
  metSec: number; // Mission Elapsed Time (초)
  progress: number; // 0..1
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

function lerpCoord(a: Coordinates, b: Coordinates, t: number): Coordinates {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// 발사점→종단 방위각(도, 정북=0, 시계방향). 궤적 마커 회전에 사용.
export function launchBearingDeg(launch: LaunchConfig): number {
  const dLat = launch.target.lat - launch.site.lat;
  const coslat = Math.cos((launch.site.lat * Math.PI) / 180) || 1;
  const dEast = (launch.target.lng - launch.site.lng) * coslat;
  return (Math.atan2(dEast, dLat) * 180) / Math.PI;
}

// 진행도 p에서의 비행 상태.
export function trackAt(launch: LaunchConfig, progress: number): TrackPoint {
  const p = clamp01(progress);
  const { lat, lng } = lerpCoord(launch.site, launch.target, p);
  // orbital: 부스트로 궤도 고도까지 단조 상승. ballistic: 포물선(정점 후 하강).
  const altKm =
    launch.profile === 'ballistic'
      ? launch.apogeeKm * Math.sin(Math.PI * p)
      : launch.apogeeKm * easeOutCubic(p);
  // 속도는 초반 급가속 후 종단속도에 수렴.
  const velKms = launch.maxVelKms * easeOutCubic(clamp01(p * 1.15));
  return {
    lat,
    lng,
    altKm,
    velKms,
    downrangeKm: launch.rangeKm * p,
    metSec: launch.flightSec * p,
    progress: p,
  };
}

// 이미 비행한 지상궤적(progress까지) 폴리라인 점들.
export function flownPath(launch: LaunchConfig, progress: number, steps = 64): Coordinates[] {
  const p = clamp01(progress);
  const n = Math.max(1, Math.round(steps * p));
  const out: Coordinates[] = [];
  for (let i = 0; i <= n; i++) out.push(lerpCoord(launch.site, launch.target, (p * i) / n));
  return out;
}

// 전체 예측 궤적(발사점→종단) 폴리라인 점들.
export function fullPath(launch: LaunchConfig, steps = 64): Coordinates[] {
  const out: Coordinates[] = [];
  for (let i = 0; i <= steps; i++) out.push(lerpCoord(launch.site, launch.target, i / steps));
  return out;
}

// km/s → 마하 (해수면 음속 ≈ 343 m/s).
export const machOf = (velKms: number) => (velKms * 1000) / 343;

export function formatMET(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `T+${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

export interface CustodyState {
  active: boolean; // H-0을 지났는가
  hZero: number; // H-0 재생 시각
  progress: number; // H-0~duration 구간 진행도 0..1
}

// 시나리오 재생 시각으로부터 발사(H-0) 상태를 계산. launch 없으면 null.
// H-0 = 미사일이 실제로 발사되는 시점. 타임라인에 발사/타격 관측이 있으면 그 관측
// 시각을 H-0 로 쓰고(실제 발사 순간), 없으면 발사 단계(startTime)로 폴백한다.
export function custodyState(scenario: Scenario, currentTime: number): CustodyState | null {
  const launch = scenario.launch;
  if (!launch) return null;
  const fireEvent = scenario.timeline.find((e) => e.type === 'launch' || e.type === 'strike');
  const phase = scenario.phases.find((p) => p.id === launch.phaseId);
  const hZero = fireEvent?.timestamp ?? phase?.startTime;
  if (hZero == null) return null;
  const span = Math.max(1, scenario.duration - hZero);
  return {
    active: currentTime >= hZero,
    hZero,
    progress: clamp01((currentTime - hZero) / span),
  };
}
