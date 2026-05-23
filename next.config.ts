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
};

export default nextConfig;
