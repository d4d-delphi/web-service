import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NL-COP | 다중출처 융합 지휘통제',
  description: '다영역 상황인식 시스템 - Deploy 4 Defence',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Cesium widgets CSS — rendered early so the map container styles are
            ready before the engine finishes booting. */}
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
        {/* Preload the multi-MB Cesium engine. It is normally injected late, by
            CesiumMap's useEffect (loadCesiumScript → <script src="/cesium/Cesium.js">).
            Without this preload the browser cannot start downloading it until the
            main bundle + the CesiumMap dynamic chunk have been fetched, parsed, and
            mounted — a 3-step waterfall that dominates time-to-first-map-render.
            Preloading starts the transfer in parallel with the Next.js bundles, and
            the later injected <script> is served from the preload cache. */}
        <link rel="preload" href="/cesium/Cesium.js" as="script" />
        {/* The basemap imagery tiles are served from CartoDB's CDN; warm DNS/TLS so
            the first tile request (issued the moment the Viewer is constructed) does
            not wait on a fresh handshake. */}
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" />
        <link rel="dns-prefetch" href="https://basemaps.cartocdn.com" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
