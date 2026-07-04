// 대한민국 방공/해상 경계선(Cesium 흰색 폴리라인). 공개 자료 기반 근사 좌표(OSINT 수준).
// 기준: KADIZ=인천 FIR 경계 정합(2013 확장, 이어도/마라도/홍도 포함).
//       NLL 서해=서해 5도(연평·대청·소청·백령·우도)와 옹진반도 중간선.
// 모두 흰색.

// [lat, lng] 쌍.
const BOUNDARIES: { id: string; name: string; loop?: boolean; coords: [number, number][] }[] = [
  // ── KADIZ (대한민국 방공식별구역) ── 인천 FIR 경계에 정합.
  //    2013.12 확장: 마라도·홍도·이어도 상공 포함. 동서 경계는 기존 유지.
  {
    id: 'kadiz', name: 'KADIZ', loop: true,
    coords: [
      // NW 코너 (39°N ~ 123.5°E, 남북 경계 서단)
      [39.0, 123.5],
      // 서해 서측 (한반도 서쪽 해상, 중국 방향)
      [38.0, 123.0], [36.5, 123.2], [35.0, 123.5],
      // 남서 (마라도·홍도·이어도 포함)
      [33.5, 125.0], [32.12, 125.18],  // 이어도 (32°07'N 125°11'E)
      // 남측 (동쪽으로)
      [32.5, 127.5], [33.5, 128.8],
      // 동측 (동해, 독도 포함)
      [35.5, 130.0], [37.0, 131.0],
      [37.24, 131.87],  // 독도 (37°14'N 131°52'E)
      [38.3, 132.3],
      // NE 코너
      [39.0, 133.0],
    ],
  },
  // ── NLL 서해 (서해 5도 ~ 옹진반도 중간선) ──
  //    한강하구 교동도 → 연평도 → 대청/소청도 → 백령도 서북방
  {
    id: 'nll-west', name: 'NLL(서해)',
    coords: [
      [37.72, 126.35],  // 한강하구 교동도 앞
      [37.67, 125.95],  // 연평도 북단
      [37.60, 125.50],  // 대청/소청도 북단
      [37.62, 124.95],  // 백령도 북방
      [37.70, 124.65],  // 백령도 서북방 공해
    ],
  },
  // ── NLL 동해 (MDL 동해안 접점 ~ 동쪽 위도선, 38°36'N) ──
  { id: 'nll-east', name: 'NLL(동해)', coords: [[38.60, 128.40], [38.60, 132.50]] },
  // ── 한·중 중간선 (서해, 해군 감시 기준) ──
  //    양국 해안선 중간. 서해 폭 ~400km, 중간선 ~한반도 서안에서 200km 서쪽.
  { id: 'rok-prc-median', name: '한·중 중간선', coords: [[38.0, 123.5], [36.0, 123.7], [34.0, 124.5]] },
  // ── 한·중 어업협정선 ── (잠정조치수역 동측 경계)
  { id: 'rok-prc-fishery', name: '한·중 어업협정선', coords: [[37.5, 124.5], [35.5, 124.8], [33.5, 125.3]] },
  // ── 중국 잠정조치수역 외곽선 (동경 124도) ──
  { id: 'prc-124e', name: '중국 124°E선', coords: [[39.5, 124.0], [36.0, 124.0]] },
  // ── 대한해협 중간선 (부산 ~ 대마도) ──
  { id: 'ks-strait-median', name: '대한해협 중간선', coords: [[35.15, 129.05], [34.45, 129.40]] },
  // ── 한·일 EEZ 경계 (독도 서방) ──
  { id: 'rok-jpn-eez', name: '한·일 EEZ(독도)', coords: [[36.8, 131.2], [37.6, 131.2]] },
  // ── 조·러 해상 국경선 (두만강 하구 ~ 동남) ──
  { id: 'dprk-rus-border', name: '조·러 해상국경', coords: [[42.17, 130.67], [41.2, 131.4], [40.0, 132.5]] },
  // ── 동해 북방 대잠 초계선 (울릉·독도 북방 공해상) ──
  { id: 'eastsea-asw', name: '동해 북방작전선', coords: [[37.8, 130.0], [37.8, 132.0]] },
];

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
