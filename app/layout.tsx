import type { Metadata, Viewport } from "next";
import "./globals.css";
import SplashScreen from "@/app/components/SplashScreen";
import RouteProgress from "@/app/components/RouteProgress";

export const metadata: Metadata = {
  title: "동업자씨 - 동래구청소년센터",
  description: "동래구청소년센터 업무 자동화 시스템",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // iOS 홈 화면 추가 시 앱처럼 동작 — capable / 상태바 / 타이틀.
  //   Next 는 표준 `mobile-web-app-capable` 를 내보내므로, 구형 iOS 호환을 위해
  //   deprecated 된 `apple-mobile-web-app-capable` 도 명시적으로 추가합니다.
  appleWebApp: {
    capable: true,
    title: "동업자씨",
    statusBarStyle: "black-translucent",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  openGraph: {
    title: "동업자씨 - 동래구청소년센터",
    description: "동래 업무 자동화 씨스템",
    images: ["/og-image.png"],
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a5f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-slate-900">
        <RouteProgress />
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
