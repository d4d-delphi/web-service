// 대한민국 방공/해상 경계선(Cesium 흰색 폴리라인). 공개 자료 기반 근사 좌표(OSINT 수준).
// KADIZ(방공식별구역)·NLL(북방한계선)·해상 경계/작전선. 모두 흰색.

// [lat, lng] 쌍. (Cesium Cartesian3.fromDegreesArray 는 [lng,lat,...] 평탄화 순서로 변환해 사용)
const BOUNDARIES: { id: string; name: string; loop?: boolean; coords: [number, number][] }[] = [
  // ── KADIZ (대한민국 방공식별구역, 11 정점 폐곡선) ──
  {
    id: 'kadiz', name: 'KADIZ', loop: true,
    coords: [
      [39.0, 123.5], [37.0, 123.0], [35.0, 123.7], [33.0, 124.3], [32.0, 124.5],
      [32.0, 127.0], [33.5, 129.0], [36.0, 130.7], [37.233, 131.867],
      [37.283, 133.0], [39.0, 133.0],
    ],
  },
  // ── NLL 서해 (서해 5도 ~ 옹진반도 중간선) ──
  {
    id: 'nll-west', name: 'NLL(서해)',
    coords: [[37.75, 126.35], [37.8, 125.95], [37.85, 125.55], [37.92, 125.1], [37.97, 124.75], [37.85, 124.55]],
  },
  // ── NLL 동해 (MDL 동해안 접점 ~ 동쪽 위도선) ──
  { id: 'nll-east', name: 'NLL(동해)', coords: [[38.6, 128.4], [38.6, 132.0]] },
  // ── 한·중 중간선 (서해 감시 기준) ──
  { id: 'rok-prc-median', name: '한·중 중간선', coords: [[38.5, 123.5], [36.0, 123.3], [34.0, 124.0]] },
  // ── 한·중 어업협정선 ──
  { id: 'rok-prc-fishery', name: '한·중 어업협정선', coords: [[38.5, 124.2], [35.0, 124.3], [33.0, 124.8]] },
  // ── 중국 잠정조치수역 외곽선 (동경 124도) ──
  { id: 'prc-124e', name: '중국 124°E선', coords: [[40.0, 124.0], [36.5, 124.0]] },
  // ── 대한해협 중간선 (부산~대마도) ──
  { id: 'ks-strait-median', name: '대한해협 중간선', coords: [[35.0, 129.0], [34.2, 129.4]] },
  // ── 한·일 어업/EEZ (독도 서방) ──
  { id: 'rok-jpn-eez', name: '한·일 EEZ(독도)', coords: [[37.0, 131.0], [37.4, 131.0]] },
  // ── 조·러 해상 국경선 (두만강 하구 ~ 동남) ──
  { id: 'dprk-rus-border', name: '조·러 해상국경', coords: [[42.0, 130.6], [41.0, 131.5], [40.0, 132.5]] },
  // ── 동해 북방 대잠 초계선 (울릉·독도 북방) ──
  { id: 'eastsea-asw', name: '동해 북방작전선', coords: [[37.7, 129.5], [37.7, 132.5]] },
];

// 모든 경계선을 흰색 폴리라인으로 그린다. (시나리오 전환 effect 내에서 호출 → removeAll 주기와 공존)
export function drawBoundaries(Cesium: any, viewer: any) {
  for (const b of BOUNDARIES) {
    const pts = b.loop ? [...b.coords, b.coords[0]] : b.coords;
    const degrees: number[] = [];
    for (const [lat, lng] of pts) degrees.push(lng, lat);
    viewer.entities.add({
      id: `bdry-${b.id}`,
      name: b.name,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(degrees),
        width: 1.4,
        material: Cesium.Color.WHITE.withAlpha(0.85),
        clampToGround: true,
      },
    });
  }
}
