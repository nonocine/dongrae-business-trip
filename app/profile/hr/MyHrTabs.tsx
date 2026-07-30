"use client";

import { useEffect, useState, type ReactNode } from "react";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

// 마이페이지(내 인사기록) 탭 껍데기 — 데이터는 서버에서 받아 children 으로 꽂습니다
// (프레젠테이션 전용, 서버 액션·조회 로직과 무관).
export type MyHrTabKey = "info" | "certs" | "trainings";

const TABS: { key: MyHrTabKey; label: string }[] = [
  { key: "info", label: "내 정보" },
  { key: "certs", label: "증명서" },
  { key: "trainings", label: "내 의무교육" },
];

// 해시 → 탭 키. 새 해시(#info/#certs/#trainings)와 함께, 기존 북마크·대시보드
// 링크가 쓰던 섹션 앵커(#my-trainings/#my-certificates)도 같은 탭으로 매핑해
// 하위 호환을 유지합니다.
const HASH_TO_TAB: Record<string, MyHrTabKey> = {
  info: "info",
  profile: "info",
  certs: "certs",
  certificates: "certs",
  "my-certificates": "certs",
  trainings: "trainings",
  "my-trainings": "trainings",
};

function tabFromHash(hash: string): MyHrTabKey | null {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  return HASH_TO_TAB[key] ?? null;
}

export default function MyHrTabs({
  info,
  certs,
  trainings,
}: {
  info: ReactNode;
  certs: ReactNode;
  trainings: ReactNode;
}) {
  // 첫 렌더는 SSR 과 동일하게 기본 탭으로 두고, 마운트 후 해시를 반영합니다
  // (초기값에서 window 를 읽으면 하이드레이션 불일치가 납니다).
  const [tab, setTab] = useState<MyHrTabKey>("info");

  useEffect(() => {
    const sync = () => {
      const k = tabFromHash(window.location.hash);
      if (k) setTab(k);
    };
    sync();
    // 같은 페이지에 머무는 중 해시 링크(대시보드 → #my-trainings)를 눌러도 전환.
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function select(key: MyHrTabKey) {
    setTab(key);
    // 새로고침해도 같은 탭이 열리도록 해시만 교체(스크롤 점프·히스토리 오염 없음).
    window.history.replaceState(null, "", `#${key}`);
  }

  const panels: Record<MyHrTabKey, ReactNode> = { info, certs, trainings };

  return (
    <div>
      <div className={tabBarCls}>
        <nav className={tabNavCls} role="tablist" aria-label="내 인사기록">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`myhr-tab-${t.key}`}
              aria-selected={t.key === tab}
              aria-controls={`myhr-panel-${t.key}`}
              onClick={() => select(t.key)}
              className={tabItemCls(t.key === tab)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 패널은 모두 마운트한 채 숨김만 전환 — 인적사항에 작성 중인 내용이
          탭을 옮겨도 사라지지 않게 합니다. */}
      {TABS.map((t) => (
        <div
          key={t.key}
          id={`myhr-panel-${t.key}`}
          role="tabpanel"
          aria-labelledby={`myhr-tab-${t.key}`}
          hidden={t.key !== tab}
          className={t.key === tab ? "mt-5" : "hidden"}
        >
          {panels[t.key]}
        </div>
      ))}
    </div>
  );
}
