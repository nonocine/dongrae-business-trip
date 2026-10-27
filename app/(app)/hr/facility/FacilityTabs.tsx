"use client";

import { usePathname } from "next/navigation";
import Tabs, { type TabItem } from "@/app/components/Tabs";

const TABS: TabItem[] = [
  { key: "/hr/facility/assets", href: "/hr/facility/assets", label: "비품관리", icon: "package" },
  { key: "/hr/facility/locations", href: "/hr/facility/locations", label: "장소관리", icon: "mapPin" },
  { key: "/hr/facility/safety", href: "/hr/facility/safety", label: "안전점검", icon: "shieldCheck" },
  // 운행기록은 읽기 전용 — 작성·수정은 동래카 앱에서 합니다.
  { key: "/hr/facility/driving", href: "/hr/facility/driving", label: "운행기록", icon: "car" },
  // 대관예약도 읽기 전용 — 작성·수정은 홈페이지에서 합니다.
  { key: "/hr/facility/rentals", href: "/hr/facility/rentals", label: "대관예약", icon: "calendarClock" },
];

export default function FacilityTabs() {
  const path = usePathname() ?? "";
  const current = TABS.find((t) => path.startsWith(t.key))?.key ?? "";
  return <Tabs ariaLabel="시설관리" value={current} items={TABS} />;
}
