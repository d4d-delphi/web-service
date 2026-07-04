'use client';

import { useEffect, useRef, useState } from 'react';
import { Scenario, ThreatAsset, FriendlyAsset } from '@/types';

interface CesiumMapProps {
  scenario: Scenario | null;
  currentTime: number;
  destroyedAssets: string[];
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

// Draw a small military-style marker glyph onto a canvas for use as a
// Cesium billboard image (no external assets — CSP-safe, works offline).
function markerCanvas(symbol: string, fill: string, outline: string): HTMLCanvasElement {
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
      return c;
    case 'circle':
    default:
      ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
      break;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  return c;
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

export default function CesiumMap({ scenario, currentTime, destroyedAssets }: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevPhaseRef = useRef<number | null>(null);
  const lastPulseKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const initCesium = async () => {
      try {
        const Cesium = await loadCesiumScript();
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

        viewerRef.current = viewer;
        setLoaded(true);
      } catch (err: any) {
        console.error('Cesium init error:', err);
        setError(err.message || 'Failed to load map');
      }
    };

    initCesium();

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // Update entities when scenario or destroyed assets change
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    viewer.entities.removeAll();

    // Threat assets (red)
    scenario.threats.forEach((threat: ThreatAsset) => {
      const isDestroyed = destroyedAssets.includes(threat.id);

      viewer.entities.add({
        id: threat.id,
        position: Cesium.Cartesian3.fromDegrees(threat.position.lng, threat.position.lat, 0),
        billboard: {
          image: markerCanvas(
            THREAT_SYMBOL[threat.type] || 'circle',
            isDestroyed ? '#6b7280' : '#ef4444',
            isDestroyed ? '#374151' : '#7f1d1d',
          ),
          scale: isDestroyed ? 0.8 : 1,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
        },
        label: {
          text: threat.name,
          font: '11px sans-serif',
          scale: 0.5,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15),
        },
      });

      // Threat radius
      if (threat.threatRadius && threat.threatRadius > 0 && !isDestroyed) {
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
    scenario.friendlies.forEach((friendly: FriendlyAsset) => {
      viewer.entities.add({
        id: friendly.id,
        position: Cesium.Cartesian3.fromDegrees(friendly.position.lng, friendly.position.lat, 0),
        billboard: {
          image: markerCanvas(FRIENDLY_SYMBOL[friendly.type] || 'circle', '#3b82f6', '#22d3ee'),
          scale: 1,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
        },
        label: {
          text: friendly.name,
          font: '11px sans-serif',
          scale: 0.5,
          fillColor: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15),
        },
      });
    });
  }, [scenario, loaded, destroyedAssets]);

  // Pulsing marker on the currently-active timeline event's location
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    // Most recent event at/before currentTime
    const past = scenario.timeline.filter((e) => e.timestamp <= currentTime);
    const active = past.length ? past[past.length - 1] : null;

    // Resolve a position from the event's related assets
    let pos: { lat: number; lng: number } | null = null;
    if (active) {
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

    const existing = viewer.entities.getById('active-event-pulse');
    if (!active || !pos) {
      if (existing) viewer.entities.remove(existing);
      lastPulseKeyRef.current = null;
      return;
    }

    // Rebuild only when the active event changes (not every frame)
    if (existing && lastPulseKeyRef.current === active.id) return;
    if (existing) viewer.entities.remove(existing);

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
      label: {
        text: `▶ ${active.title}`,
        font: 'bold 12px sans-serif',
        scale: 0.6,
        fillColor: Cesium.Color.fromCssColorString('#fde68a'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 16),
      },
    });
    lastPulseKeyRef.current = active.id;
  }, [scenario, currentTime, loaded]);

  // Camera fly on phase change
  useEffect(() => {
    if (!viewerRef.current || !scenario || !loaded || !cesiumRef.current) return;

    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    const currentPhase = scenario.phases.find(
      (p) => currentTime >= p.startTime && currentTime < p.endTime
    );

    if (currentPhase && currentPhase.id !== prevPhaseRef.current && currentPhase.cameraTarget) {
      prevPhaseRef.current = currentPhase.id;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          currentPhase.cameraTarget.lng,
          currentPhase.cameraTarget.lat,
          currentPhase.cameraTarget.range || 500000
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: 2,
      });
    }
  }, [scenario, currentTime, loaded]);

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
