'use client';

import { useEffect, useRef, useState } from 'react';
import { Scenario, ThreatAsset, FriendlyAsset, LaunchConfig, MilitaryUnit, FriendlyFormation } from '@/types';
import { drawBoundaries } from '@/lib/boundaries';
import { trackAt, flownPath, fullPath, launchBearingDeg } from '@/lib/custody';

interface CesiumMapProps {
  scenario: Scenario | null;
  currentTime: number;
  destroyedAssets: string[];
  // 발사(H-0) 이후 커스터디 추적 상태. null이면 평시 지도.
  custody?: { launch: LaunchConfig; progress: number } | null;
}

// Asset-type → marker symbol
const THREAT_SYMBOL: Record<string, string> = {
  SAM: 'diamond',
  TEL: 'triangle',
  RADAR: 'radar',
  MISSILE_BASE: 'square',
  COMMAND: 'star',
};
const FRIENDLY_SYMBOL: Record<string, string> = {
  MISSILE: 'triangle',
  FIGHTER: 'chevron',
  ISR: 'circle',
  SHIP: 'ship',
  COMMAND: 'star',
  UAV: 'chevron',
};
const ORBAT_SYMBOL: Record<string, string> = {
  corps: 'star', division: 'square', brigade: 'square', regiment: 'square',
  battalion: 'circle', missile: 'triangle', air_defense: 'diamond', air: 'chevron',
  naval: 'ship', sf: 'circle', artillery: 'square', command: 'star', other: 'circle',
};
const FORMATION_SYMBOL: Record<string, string> = {
  fighter_wing: 'chevron', recon_wing: 'circle', army_corps: 'star', mobile_corps: 'star',
  missile_cmd: 'triangle', air_defense_cmd: 'diamond', sam_base: 'diamond', sigint: 'circle',
  naval: 'ship', command: 'star', other: 'circle',
};

// Draw a small military-style marker glyph onto a canvas for use as a
// Cesium billboard image (no external assets — CSP-safe, works offline).
const markerCanvasCache = new Map<string, HTMLCanvasElement>();

function markerCanvas(symbol: string, fill: string, outline: string): HTMLCanvasElement {
  const cacheKey = `${symbol}_${fill}_${outline}`;
  if (markerCanvasCache.has(cacheKey)) {
    return markerCanvasCache.get(cacheKey)!;
  }

  const size = 30;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.fillStyle = fill;
  ctx.shadowColor = fill;
  ctx.shadowBlur = 6;
  const r = 9;

  ctx.beginPath();
  switch (symbol) {
    case 'triangle':
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.8); ctx.lineTo(-r * 0.9, r * 0.8); ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
      break;
    case 'square':
      ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'chevron':
      ctx.moveTo(0, -r); ctx.lineTo(r, r * 0.9); ctx.lineTo(0, r * 0.3); ctx.lineTo(-r, r * 0.9); ctx.closePath();
      break;
    case 'ship':
      ctx.moveTo(-r, -r * 0.3); ctx.lineTo(r, -r * 0.3); ctx.lineTo(r * 0.6, r * 0.7); ctx.lineTo(-r * 0.6, r * 0.7); ctx.closePath();
      break;
    case 'star': {
      const spikes = 5, outer = r, inner = r * 0.45;
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 ? inner : outer;
        const a = (Math.PI / spikes) * i - Math.PI / 2;
        const fn = i ? 'lineTo' : 'moveTo';
        ctx[fn](Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      break;
    }
    case 'radar':
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.85);
      ctx.moveTo(0, 0); ctx.lineTo(r * 0.7, -r * 0.5);
      ctx.stroke();
      markerCanvasCache.set(cacheKey, c);
      return c;
    case 'circle':
    default:
      ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
      break;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  markerCanvasCache.set(cacheKey, c);
  return c;
}

// Render label text onto a canvas for use as a Cesium billboard image.
// Cesium 1.56+ draws entity labels via an SDF glyph atlas whose resolution
// mangles dense CJK (한글/한자) strokes — text comes out garbled. Rendering the
// text ourselves through the 2D canvas bypasses SDF entirely, so Korean stays
// crisp. Drawn at 2× for retina and displayed at scale 0.5.
const LABEL_RES = 2;
const LABEL_FONT = 'bold 13px sans-serif';
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 4;
const LABEL_LINE_H = 17;

let _measureCtx: CanvasRenderingContext2D | null = null;
function measureLabel(text: string): number {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx!.font = LABEL_FONT;
  return Math.ceil(_measureCtx!.measureText(text).width);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const labelCanvasCache = new Map<string, { image: HTMLCanvasElement; width: number; height: number }>();

// Returns a canvas + its CSS (unscaled) width/height so callers can size the
// billboard and the declutter step can reason about the on-screen box.
function labelCanvas(text: string, fill: string, bg: string): { image: HTMLCanvasElement; width: number; height: number } {
  const cacheKey = `${text}_${fill}_${bg}`;
  if (labelCanvasCache.has(cacheKey)) {
    return labelCanvasCache.get(cacheKey)!;
  }

  const tw = measureLabel(text);
  const cssW = tw + LABEL_PAD_X * 2;
  const cssH = LABEL_LINE_H + LABEL_PAD_Y * 2;
  const c = document.createElement('canvas');
  c.width = cssW * LABEL_RES;
  c.height = cssH * LABEL_RES;
  const ctx = c.getContext('2d')!;
  ctx.scale(LABEL_RES, LABEL_RES);

  ctx.fillStyle = bg;
  roundRectPath(ctx, 0, 0, cssW, cssH, 3);
  ctx.fill();

  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(text, LABEL_PAD_X, cssH / 2 + 0.5);

  const result = { image: c, width: cssW, height: cssH };
  labelCanvasCache.set(cacheKey, result);
  return result;
}

// Add a text label as a separate billboard entity (id `${baseId}-label`) so the
// declutter pass can toggle it independently of the marker icon. `below` places
// the label under the anchor instead of above it.
function addLabelEntity(
  Cesium: any,
  viewer: any,
  baseId: string,
  position: any,
  text: string,
  fill: string,
  bg: string,
  below = false,
  show = false,
) {
  const { image, width } = labelCanvas(text, fill, bg);
  viewer.entities.add({
    id: `${baseId}-label`,
    position,
    properties: { labelWidth: width },
    billboard: {
      image,
      scale: 1 / LABEL_RES,
      show,
      verticalOrigin: below ? Cesium.VerticalOrigin.TOP : Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, below ? 14 : -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

// Continuous patrol motion for recon assets (정찰기 / 정찰선). Aircraft fly a wide
// racetrack orbit; ships crawl a slow, tight patrol box. Driven by performance.now()
// so it animates every frame without React re-renders (same approach as the event
// pulse). Returns Cesium properties for the entity position and billboard heading.
function patrolMotion(
  Cesium: any,
  base: { lat: number; lng: number },
  profile: 'air' | 'sea',
  seed: number,
) {
  const coslat = Math.cos((base.lat * Math.PI) / 180) || 1;
  // Ellipse radii in degrees of latitude (rLng > rLat → elongated racetrack).
  const rLat = profile === 'air' ? 0.32 : 0.06;
  const rLng = profile === 'air' ? 0.55 : 0.11;
  const period = profile === 'air' ? 26000 : 72000; // ms per full loop
  const w = (2 * Math.PI) / period;
  const phase = seed * 1.7; // desync assets so they don't fly in lockstep

  const position = new Cesium.CallbackProperty(() => {
    const a = w * performance.now() + phase;
    const lat = base.lat + rLat * Math.cos(a);
    const lng = base.lng + (rLng * Math.sin(a)) / coslat;
    return Cesium.Cartesian3.fromDegrees(lng, lat, 0);
  }, false);

  // Heading = tangent of the ellipse, so the glyph faces its direction of travel.
  const rotation = new Cesium.CallbackProperty(() => {
    const a = w * performance.now() + phase;
    const vEast = rLng * Math.cos(a); // ∝ d(east)/dt
    const vNorth = -rLat * Math.sin(a); // ∝ d(north)/dt
    const bearing = Math.atan2(vEast, vNorth); // 0 = north, +clockwise
    return -bearing; // Cesium billboard rotation is CCW-positive; glyphs point north
  }, false);

  return { position, rotation };
}

function loadCesiumScript(): Promise<any> {
  return new Promise((resolve, reject) => {
    // Already loaded
    if ((window as any).Cesium) {
      resolve((window as any).Cesium);
      return;
    }

    const script = document.createElement('script');
    script.src = '/cesium/Cesium.js';
    script.onload = () => {
      const Cesium = (window as any).Cesium;
      if (Cesium) {
        resolve(Cesium);
      } else {
        reject(new Error('Cesium failed to load'));
      }
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// 적 ORBAT(전투서열) 부대 로드 — /api/orbat(서버 fs 미러)에서 1회 fetch 후 모듈 캐시.
let orbatUnitsCache: MilitaryUnit[] | null = null;
async function loadOrbatUnits(): Promise<MilitaryUnit[]> {
  if (orbatUnitsCache) return orbatUnitsCache;
  try {
    const r = await fetch('/api/orbat');
    if (!r.ok) return [];
    orbatUnitsCache = ((await r.json()) as { units: MilitaryUnit[] }).units ?? [];
  } catch {
    orbatUnitsCache = [];
  }
  return orbatUnitsCache;
}

// 아군(ROK/USFK) 전투서열 부대 로드 — /api/blue-formations(서버 fs 미러)에서 1회 fetch 후 캐시.
let friendlyFormationsCache: FriendlyFormation[] | null = null;
async function loadFriendlyFormations(): Promise<FriendlyFormation[]> {
  if (friendlyFormationsCache) return friendlyFormationsCache;
  try {
    const r = await fetch('/api/blue-formations');
    if (!r.ok) return [];
    friendlyFormationsCache = ((await r.json()) as { units: FriendlyFormation[] }).units ?? [];
  } catch {
    friendlyFormationsCache = [];
  }
  return friendlyFormationsCache;
}

export default function CesiumMap({ scenario, currentTime, destroyedAssets, custody }: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevPhaseRef = useRef<number | null>(null);
  // 커스터디 카메라: 최초 진입 시 극적 스웝(flyTo) 후 프레임마다 추종(setView).
  const custodyEngagedAtRef = useRef<number | null>(null);
  const lastPulseKeyRef = useRef<string | null>(null);
  // Latest currentTime, read by the entity-build effect (which isn't keyed on it)
  // to set the initial visibility of time-gated observation markers.
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // React StrictMode (dev) mounts twice and the init is async — without this
    // guard two viewers race onto one container and entities attach to the
    // stale/destroyed one, so nothing paints. `cancelled` ensures exactly one
    // live viewer, and that `loaded` flips only once that viewer exists.
    let cancelled = false;

    const initCesium = async () => {
      try {
        const Cesium = await loadCesiumScript();
        if (cancelled || viewerRef.current) return;
        cesiumRef.current = Cesium;

        Cesium.Ion.defaultAccessToken = '';

        // CartoDB "dark matter" tiles — dark, low-color, and crisp at every
        // zoom. @2x (retina) endpoint at 512px for extra sharpness.
        // Note: requires internet at runtime.
        const baseLayer = new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
            subdomains: 'abcd',
            tileWidth: 512,
            tileHeight: 512,
            maximumLevel: 20,
            credit: '© OpenStreetMap contributors © CARTO',
          }),
        );

        const viewer = new Cesium.Viewer(containerRef.current!, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          vrButton: false,
          infoBox: false,
          selectionIndicator: false,
          baseLayer,
          // Flat 2D map (still CesiumJS) instead of the 3D globe.
          sceneMode: Cesium.SceneMode.SCENE2D,
        });

        // Render at the device pixel ratio — Cesium defaults to CSS pixels,
        // which looks soft/low-res on retina/hi-DPI displays.
        viewer.useBrowserRecommendedResolution = false;
        viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);

        // Dark theme
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0e1a');
        viewer.scene.globe.enableLighting = false;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b0f16');
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
        if (viewer.scene.sun) viewer.scene.sun.show = false;
        if (viewer.scene.moon) viewer.scene.moon.show = false;
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

        // Initial camera - Korean Peninsula
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(127.5, 38.0, 1500000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-60),
            roll: 0,
          },
        });

        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        setLoaded(true);

        // 라벨 hover 토글: 기본 숨김, 마우스 오버한 엔티티의 -label 만 노출.
        const hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        let lastLabelId: string | null = null;
        hoverHandler.setInputAction((movement: any) => {
          const picked = viewer.scene.pick(movement.endPosition);
          let baseId: string | null = null;
          if (Cesium.defined(picked) && picked.id) {
            const eid = typeof picked.id === 'object' ? picked.id.id : picked.id;
            if (eid && !eid.endsWith('-label') && !eid.endsWith('-radius') && viewer.entities.getById(`${eid}-label`)) {
              baseId = eid;
            }
          }
          const labelId = baseId ? `${baseId}-label` : null;
          if (labelId !== lastLabelId) {
            if (lastLabelId) {
              const e = viewer.entities.getById(lastLabelId);
              if (e && e.billboard) e.billboard.show = false;
            }
            if (labelId) {
              const e = viewer.entities.getById(labelId);
              if (e && e.billboard) e.billboard.show = true;
            }
            lastLabelId = labelId;
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      } catch (err: any) {
        console.error('Cesium init error:', err);
        setError(err.message || 'Failed to load map');
      }
    };

    initCesium();

    return () => {
      cancelled = true;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // Update entities when scenario changes (full rebuild only on scenario swap)
  const prevScenarioIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    // Only rebuild all entities if the scenario itself has changed (e.g. ID changed)
    if (prevScenarioIdRef.current === scenario.id) return;
    prevScenarioIdRef.current = scenario.id;

    viewer.entities.removeAll();

    // Threat assets (red) - initialized as non-destroyed. Destruction is managed incrementally by another effect.
    scenario.threats.forEach((threat: ThreatAsset) => {
      viewer.entities.add({
        id: threat.id,
        position: Cesium.Cartesian3.fromDegrees(threat.position.lng, threat.position.lat, 0),
        billboard: {
          image: markerCanvas(
            THREAT_SYMBOL[threat.type] || 'circle',
            '#ef4444',
            '#7f1d1d',
          ),
          scale: 1,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
        },
      });
      addLabelEntity(
        Cesium,
        viewer,
        threat.id,
        Cesium.Cartesian3.fromDegrees(threat.position.lng, threat.position.lat, 0),
        threat.name,
        '#ffffff',
        'rgba(10,14,26,0.72)',
      );

      // Threat radius
      if (threat.threatRadius && threat.threatRadius > 0) {
        viewer.entities.add({
          id: `${threat.id}-radius`,
          position: Cesium.Cartesian3.fromDegrees(threat.position.lng, threat.position.lat, 0),
          ellipse: {
            semiMinorAxis: threat.threatRadius * 1000,
            semiMajorAxis: threat.threatRadius * 1000,
            material: Cesium.Color.RED.withAlpha(0.08),
            outline: true,
            outlineColor: Cesium.Color.RED.withAlpha(0.4),
            outlineWidth: 2,
            height: 0,
          },
        });
      }
    });

    // Friendly assets (blue)
    scenario.friendlies.forEach((friendly: FriendlyAsset, i: number) => {
      const profile: 'air' | 'sea' | null =
        friendly.type === 'SHIP'
          ? 'sea'
          : friendly.type === 'ISR' || friendly.type === 'UAV' || friendly.type === 'FIGHTER'
            ? 'air'
            : null;
      const motion = profile ? patrolMotion(Cesium, friendly.position, profile, i) : null;
      const position = motion
        ? motion.position
        : Cesium.Cartesian3.fromDegrees(friendly.position.lng, friendly.position.lat, 0);

      viewer.entities.add({
        id: friendly.id,
        position,
        billboard: {
          image: markerCanvas(FRIENDLY_SYMBOL[friendly.type] || 'circle', '#3b82f6', '#22d3ee'),
          scale: 1,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          ...(motion ? { rotation: motion.rotation } : {}),
        },
      });
      addLabelEntity(
        Cesium,
        viewer,
        friendly.id,
        position,
        friendly.name,
        '#22d3ee',
        'rgba(10,14,26,0.72)',
      );
    });

    // 적 ORBAT(전투서열) 부대 마커 — 적 오더 오브 배틀 상시 표시 (전장 중심 사고)
    loadOrbatUnits().then((units) => {
      units
        .filter((u) => u.hqLat != null && u.hqLng != null)
        .forEach((u) => {
          const slug = (u.designation || 'unit').replace(/\s+/g, '-');
          const id = `orbat-${slug}`;
          if (viewer.entities.getById(id)) return;
          const pos = Cesium.Cartesian3.fromDegrees(u.hqLng as number, u.hqLat as number, 0);
          // SA-2/SA-5(air_defense)만 채색(빨강), 나머지 적 부대는 무채색(회색)으로 통일.
          const isSam = u.unitType === 'air_defense';
          const fill = isSam ? '#7f1d1d' : '#6b7280';
          const outline = isSam ? '#450a0a' : '#374151';
          viewer.entities.add({
            id,
            position: pos,
            billboard: {
              image: markerCanvas(ORBAT_SYMBOL[u.unitType] || 'circle', fill, outline),
              scale: 0.9,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
            },
          });
          addLabelEntity(Cesium, viewer, id, pos, u.designation, '#9ca3af', 'rgba(10,14,26,0.72)');
          // SA-5 장거리 방공 위협반경(150km, 흰색 투명 원)
          if (u.designation.includes('SA-5')) {
            viewer.entities.add({
              id: `${id}-radius`,
              position: pos,
              ellipse: {
                semiMinorAxis: 150000,
                semiMajorAxis: 150000,
                material: Cesium.Color.WHITE.withAlpha(0.07),
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
                outlineWidth: 1,
                height: 0,
              },
            });
          }
        });
    });

    // 아군(ROK/USFK) 전투서열 부대 마커 — 청색(공수 양면). 정밀 좌표 비공개 → 행정구역 수준.
    loadFriendlyFormations().then((units) => {
      units
        .filter((u) => u.hqLat != null && u.hqLng != null)
        .forEach((u) => {
          const slug = (u.designation || 'f-unit').replace(/\s+/g, '-');
          const id = `blue-${slug}`;
          if (viewer.entities.getById(id)) return;
          const pos = Cesium.Cartesian3.fromDegrees(u.hqLng as number, u.hqLat as number, 0);
          const outline = u.side === 'usfk' ? '#1e293b' : '#334155';
          viewer.entities.add({
            id,
            position: pos,
            billboard: {
              image: markerCanvas(FORMATION_SYMBOL[u.formationType] || 'circle', '#475569', outline),
              scale: 0.9,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
            },
          });
          addLabelEntity(Cesium, viewer, id, pos, u.designation, '#9ca3af', 'rgba(10,14,26,0.72)');
        });
    });

    // 대한민국 방공/해상 경계선(KADIZ·NLL·해상경계) — 흰색 폴리라인
    drawBoundaries(Cesium, viewer);

    // Observation markers (amber dots)
    scenario.timeline.forEach((event) => {
      if (!event.position) return;
      viewer.entities.add({
        id: `obs-${event.id}`,
        position: Cesium.Cartesian3.fromDegrees(event.position.lng, event.position.lat, 0),
        show: event.timestamp <= currentTimeRef.current,
        point: {
          pixelSize: 7,
          color: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.9),
          outlineColor: Cesium.Color.fromCssColorString('#3a2a06'),
          outlineWidth: 1.5,
        },
      });
    });
  }, [scenario, loaded]);

  // Handle destroyed assets incrementally (Flicker-free asset update)
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const viewer = viewerRef.current;

    scenario.threats.forEach((threat: ThreatAsset) => {
      const isDestroyed = destroyedAssets.includes(threat.id);
      const threatEntity = viewer.entities.getById(threat.id);
      
      if (threatEntity && threatEntity.billboard) {
        // Update marker image and scale without destroying the entity
        threatEntity.billboard.image = markerCanvas(
          THREAT_SYMBOL[threat.type] || 'circle',
          isDestroyed ? '#6b7280' : '#ef4444',
          isDestroyed ? '#374151' : '#7f1d1d',
        ) as any;
        threatEntity.billboard.scale = (isDestroyed ? 0.8 : 1) as any;
      }

      // Hide or show the threat radius circle depending on whether it is destroyed
      const radiusEntity = viewer.entities.getById(`${threat.id}-radius`);
      if (radiusEntity) {
        radiusEntity.show = !isDestroyed;
      }
    });
  }, [scenario, loaded, destroyedAssets]);

  // Time-gate observation markers as playback advances (cheap show/hide toggle).
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded) return;
    const viewer = viewerRef.current;
    scenario.timeline.forEach((event) => {
      if (!event.position) return;
      const ent = viewer.entities.getById(`obs-${event.id}`);
      if (ent) ent.show = event.timestamp <= currentTime;
    });
  }, [scenario, currentTime, loaded]);

  // Pulsing marker on the currently-active timeline event's location
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    // Most recent event at/before currentTime
    const past = scenario.timeline.filter((e) => e.timestamp <= currentTime);
    const active = past.length ? past[past.length - 1] : null;

    // Resolve a position: prefer the event's own MGRS-parsed position (Supabase
    // observations), else fall back to a related asset's position (mock data).
    let pos: { lat: number; lng: number } | null = null;
    if (active?.position) {
      pos = active.position;
    } else if (active) {
      for (const id of active.relatedAssets || []) {
        const asset =
          scenario.threats.find((x) => x.id === id) ||
          scenario.friendlies.find((x) => x.id === id);
        if (asset) {
          pos = asset.position;
          break;
        }
      }
    }

    const removePulse = () => {
      const p = viewer.entities.getById('active-event-pulse');
      if (p) viewer.entities.remove(p);
      const l = viewer.entities.getById('active-event-pulse-label');
      if (l) viewer.entities.remove(l);
    };

    const existing = viewer.entities.getById('active-event-pulse');
    if (!active || !pos) {
      removePulse();
      lastPulseKeyRef.current = null;
      return;
    }

    // Rebuild only when the active event changes (not every frame)
    if (existing && lastPulseKeyRef.current === active.id) return;
    removePulse();

    const period = 1600;
    const amber = '#f59e0b';
    const phase = () => (performance.now() % period) / period; // 0..1

    viewer.entities.add({
      id: 'active-event-pulse',
      position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 0),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => 4000 + phase() * 32000, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => 4000 + phase() * 32000, false),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString(amber).withAlpha(0.35 * (1 - phase())),
            false,
          ),
        ),
        height: 0,
      },
      point: {
        pixelSize: 11,
        color: Cesium.Color.fromCssColorString(amber),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
    });
    addLabelEntity(
      Cesium,
      viewer,
      'active-event-pulse',
      Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 0),
      `▶ ${active.title}`,
      '#fde68a',
      'rgba(58,42,6,0.85)',
      true,
    );
    lastPulseKeyRef.current = active.id;
  }, [scenario, currentTime, loaded]);

  // Screen-space label declutter — Cesium doesn't declutter entity labels, so
  // project each marker to screen coords and hide any label whose box collides
  // with a higher-priority one already placed. Marker icons always stay shown;
  // labels reappear as the camera zooms into a region.
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    const scene = viewer.scene;

    const threatIds = new Set(scenario.threats.map((t) => t.id));
    const friendlyIds = new Set(scenario.friendlies.map((f) => f.id));
    const priority = (id: string) =>
      id === 'active-event-pulse' ? 0 : threatIds.has(id) ? 1 : friendlyIds.has(id) ? 2 : 3;

    const toWindow =
      Cesium.SceneTransforms.worldToWindowCoordinates ||
      Cesium.SceneTransforms.wgs84ToWindowCoordinates;

    let last = 0;
    const declutter = () => {
      const now = performance.now();
      if (now - last < 120) return; // throttle
      last = now;

      const time = Cesium.JulianDate.now();
      const items: any[] = [];
      for (const e of viewer.entities.values) {
        const id = e.id as string;
        if (!id.endsWith('-label') || !e.billboard || !e.position) continue;
        const world = e.position.getValue(time);
        if (!world) continue;
        const win = toWindow(scene, world);
        if (!win) continue;
        const baseId = id.slice(0, -'-label'.length);
        const w = e.properties?.labelWidth?.getValue(time) ?? 26;
        items.push({ e, win, w, pri: priority(baseId) });
      }
      items.sort((a, b) => a.pri - b.pri);

      const placed: { l: number; r: number; t: number; b: number }[] = [];
      const cw = scene.canvas.clientWidth;
      const ch = scene.canvas.clientHeight;
      for (const it of items) {
        const w = it.w;
        const h = 20;
        const anchorY = it.win.y - 14; // label sits above the marker point
        const box = { l: it.win.x - w / 2, r: it.win.x + w / 2, t: anchorY - h, b: anchorY };
        const off = it.win.x < 0 || it.win.y < 0 || it.win.x > cw || it.win.y > ch;
        let collide = false;
        if (!off) {
          for (const p of placed) {
            if (box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t) {
              collide = true;
              break;
            }
          }
        }
        const show = false; // hover-only: declutter가 라벨 표시를 덮어쓰지 않도록 항상 false
        if (it.e.billboard.show !== show) it.e.billboard.show = show;
        if (show) placed.push(box);
      }
    };

    const remove = scene.postRender.addEventListener(declutter);
    return () => remove();
  }, [scenario, loaded]);

  // Camera: 발사(H-0) 전까지는 초기 줌아웃 한반도 뷰를 그대로 유지한다.
  // 단계전환마다 목표점으로 날아가던 flyTo는 비활성화하고, 카메라 이동은
  // 발사 후 커스터디(비행 추적) 효과에서만 일어난다.
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded) return;
    const currentPhase = scenario.phases.find(
      (p) => currentTime >= p.startTime && currentTime < p.endTime
    );
    // 단계 추적만 유지(커스터디 종료 후 되감기 등에서 상태 정합성용). 카메라는 움직이지 않는다.
    if (currentPhase) prevPhaseRef.current = currentPhase.id;
  }, [scenario, currentTime, loaded]);

  // 커스터디(비행 추적) 오버레이 — 발사 후 미사일 궤적/마커를 그리고 카메라가 추종.
  useEffect(() => {
    if (!viewerRef.current || !loaded || !cesiumRef.current) return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    const amber = '#f59e0b';

    const CUSTODY_IDS = ['custody-path-full', 'custody-path-flown', 'custody-missile'];
    const clear = () => {
      for (const id of CUSTODY_IDS) {
        const e = viewer.entities.getById(id);
        if (e) viewer.entities.remove(e);
      }
    };

    if (!custody) {
      clear();
      // 발사 추적 중이었다면(카메라가 미사일을 따라 이동한 상태) H-0 이전으로
      // 되감긴 것이므로 초기 줌아웃 한반도 뷰로 복귀시킨다.
      if (custodyEngagedAtRef.current != null) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(127.5, 38.0, 1500000),
          duration: 1.2,
        });
      }
      custodyEngagedAtRef.current = null;
      return;
    }

    const { launch, progress } = custody;
    const t = trackAt(launch, progress);

    // 예측 전체 궤적(흐린 점선) — 최초 1회 생성.
    if (!viewer.entities.getById('custody-path-full')) {
      viewer.entities.add({
        id: 'custody-path-full',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            fullPath(launch).flatMap((p) => [p.lng, p.lat]),
          ),
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(amber).withAlpha(0.35),
            dashLength: 12,
          }),
        },
      });
    }

    // 비행 완료 궤적(밝은 실선) — 매 틱 갱신.
    const flownPos = Cesium.Cartesian3.fromDegreesArray(
      flownPath(launch, progress).flatMap((p) => [p.lng, p.lat]),
    );
    const flownEnt = viewer.entities.getById('custody-path-flown');
    if (flownEnt) {
      flownEnt.polyline.positions = flownPos;
    } else {
      viewer.entities.add({
        id: 'custody-path-flown',
        polyline: {
          positions: flownPos,
          width: 3,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(amber).withAlpha(0.95),
          ),
        },
      });
    }

    // 미사일 마커(진행 방향으로 회전).
    const carto = Cesium.Cartesian3.fromDegrees(t.lng, t.lat, 0);
    const missile = viewer.entities.getById('custody-missile');
    if (missile) {
      missile.position = carto;
    } else {
      viewer.entities.add({
        id: 'custody-missile',
        position: carto,
        billboard: {
          image: markerCanvas('chevron', '#fde68a', '#dc2626'),
          scale: 1.3,
          rotation: -Cesium.Math.toRadians(launchBearingDeg(launch)),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // 카메라: 최초 진입은 극적 스웝(flyTo), 스웝이 끝난 뒤부터 프레임마다 추종.
    const FOLLOW_RANGE = 700000;
    const dest = Cesium.Cartesian3.fromDegrees(t.lng, t.lat, FOLLOW_RANGE);
    const orientation = { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 };
    const now = performance.now();
    if (custodyEngagedAtRef.current == null) {
      custodyEngagedAtRef.current = now;
      viewer.camera.flyTo({ destination: dest, orientation, duration: 1.8 });
    } else if (now - custodyEngagedAtRef.current > 1900) {
      viewer.camera.setView({ destination: dest, orientation });
    }
  }, [custody, loaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a]">
          <div className="text-center">
            {error ? (
              <p className="text-red-400 text-sm">{error}</p>
            ) : (
              <>
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                <p className="text-gray-400 text-sm">지도 로딩 중...</p>
              </>
            )}
          </div>
        </div>
      )}
      {/* Overlay */}
      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded px-3 py-1.5 text-xs">
        <span className="text-gray-400">NL-COP</span>
        <span className="text-amber-400 ml-2">
          {scenario ? scenario.name : '시나리오 미선택'}
        </span>
      </div>
    </div>
  );
}
