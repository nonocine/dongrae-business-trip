"use client";

import { usePathname } from "next/navigation";
import Tabs, { type TabItem } from "@/app/components/Tabs";

const TABS: TabItem[] = [
  { key: "/bangka/posts", href: "/bangka/posts", label: "공지·알림장", icon: "megaphone" },
  { key: "/bangka/meals", href: "/bangka/meals", label: "급식", icon: "tray" },
  { key: "/bangka/events", href: "/bangka/events", label: "연간일정", icon: "calendar" },
  { key: "/bangka/absences", href: "/bangka/absences", label: "공결", icon: "fileCheck" },
];

// pendingAbsences — 처리할 공결 수(신청·담임 확인 대기). 0 이면 배지 없음.
export default function BangkaContentTabs({ pendingAbsences }: { pendingAbsences: number }) {
  const path = usePathname() ?? "";
  const items = TABS.map((t) => (t.key === "/bangka/absences" ? { ...t, badge: pendingAbsences } : t));
  const current = TABS.find((t) => path.startsWith(t.key))?.key ?? "";
  return <Tabs ariaLabel="동래방카 콘텐츠" value={current} items={items} />;
}
