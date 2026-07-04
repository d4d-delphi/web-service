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
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
