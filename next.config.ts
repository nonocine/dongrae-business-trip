import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 채용 지원서의 사진(최대 8MB) / 첨부서류(최대 16MB) 업로드는 Server Action
    // 기본 본문 크기 한도(1MB) 를 초과합니다. 20MB 까지 허용하여
    // framework 단에서 거부되는 일이 없도록 합니다.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  // 급여명세서 PDF(급여 3차)는 서버에서 나눔고딕 TTF 를 fs 로 읽습니다.
  // Vercel 서버리스 번들에 폰트가 포함되도록 급여 라우트에 강제 트레이싱합니다.
  outputFileTracingIncludes: {
    "/hr/salary": ["./lib/fonts/*.ttf"],
    "/hr/salary/**": ["./lib/fonts/*.ttf"],
  },
};

export default nextConfig;
