"use client";

import { useEffect, useRef } from "react";
import { recordRecruitmentView } from "./actions";

// 공개 공고 상세를 실제로 연 브라우저에서 1회만 조회수 집계를 호출합니다.
//   * 클라이언트 마운트 시점에 호출 → SSR 프리렌더/프리페치로 인한 중복 집계 방지.
//   * 세션/중복 판정은 서버 액션(recordRecruitmentView)에서 처리하므로 여기선 단순 호출.
//   * 화면에 아무것도 렌더하지 않음.
export default function RecruitmentViewTracker({ slug }: { slug: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void recordRecruitmentView(slug);
  }, [slug]);
  return null;
}
