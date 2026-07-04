'use client';

import { useEffect, useRef, useState } from 'react';
import { Scenario, ThreatAsset, FriendlyAsset } from '@/types';

interface CesiumMapProps {
  scenario: Scenario | null;
  currentTime: number;
  destroyedAssets: string[];
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
        point: {
          pixelSize: isDestroyed ? 8 : 12,
          color: isDestroyed ? Cesium.Color.GRAY.withAlpha(0.5) : Cesium.Color.RED.withAlpha(0.9),
          outlineColor: isDestroyed ? Cesium.Color.GRAY : Cesium.Color.DARKRED,
          outlineWidth: 2,
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
        point: {
          pixelSize: 10,
          color: Cesium.Color.DODGERBLUE,
          outlineColor: Cesium.Color.CYAN,
          outlineWidth: 2,
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
