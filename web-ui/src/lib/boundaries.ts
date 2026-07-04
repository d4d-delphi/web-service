// 대한민국 방공/해상 경계선(Cesium 흰색 폴리라인). 공개 자료 기반 근사 좌표(OSINT 수준).
// 기준: KADIZ=인천 FIR 경계 정합(2013 확장, 이어도/마라도/홍도 포함).
//       NLL 서해=서해 5도(연평·대청·소청·백령·우도)와 옹진반도 중간선.
// 모두 흰색.

// [lat, lng] 쌍.
const BOUNDARIES: { id: string; name: string; loop?: boolean; coords: [number, number][] }[] = [
  // ── KADIZ (대한민국 방공식별구역) ── 인천 FIR 경계에 정합.
  //    2013.12 확장: 마라도·홍도·흑산도·이어도 상공 포함. 동측은 울릉도·독도까지 확장.
  //    폐곡선 좌표는 matplotlib 2D 플롯 반복 검증으로 한국반도에 정합
  //    (서안 ~2도 버퍼, 이어도 SW 혀, 남안 인천 FIR 대각, 동안 울릉도·독도 포함, NE 132.5°E).
  {
    id: 'kadiz', name: 'KADIZ', loop: true,
    coords: [
      [39.0, 124.0],     // NW 코너 (남북 경계 서단)
      [38.0, 123.5],     // 서안 (서해 북단)
      [37.0, 124.0],     // 서안
      [36.0, 124.5],     // 서안
      [34.7, 124.9],     // SW 진입 (홍도·흑산도 서방)
      [32.12, 125.18],   // 이어도 (남단 기준)
      [33.0, 127.5],     // 제주·마라도 남방
      [34.0, 128.8],     // 대한해협 (남안)
      [34.7, 129.7],     // SE (부산 남방 해상)
      [36.0, 130.5],     // 동안 (울릉도 포함)
      [37.24, 131.87],   // 독도 (동단 기준)
      [38.5, 132.5],     // NE 접근
      [39.0, 132.5],     // NE 코너
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
  // ── 일본 EEZ 경계 (독도 서방) ──
  { id: 'jpn-eez', name: 'Japan EEZ', coords: [[36.8, 131.2], [37.6, 131.2]] },
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
