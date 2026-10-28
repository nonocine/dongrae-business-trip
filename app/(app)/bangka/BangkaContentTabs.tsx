"use client";

import { usePathname } from "next/navigation";
import Tabs, { type TabItem } from "@/app/components/Tabs";

const TABS: TabItem[] = [
  { key: "/bangka/posts", href: "/bangka/posts", label: "공지·알림장", icon: "megaphone" },
  { key: "/bangka/meals", href: "/bangka/meals", label: "급식", icon: "tray" },
  { key: "/bangka/events", href: "/bangka/events", label: "연간일정", icon: "calendar" },
  { key: "/bangka/absences", href: "/bangka/absences", label: "공결", icon: "fileCheck" },
  { key: "/bangka/talk", href: "/bangka/talk", label: "방카톡", icon: "messageSquare" },
];

// pendingAbsences — 처리할 공결 수(신청·담임 확인 대기), openTalks — 방카톡 미답변 수. 0 이면 배지 없음.
export default function BangkaContentTabs({ pendingAbsences, openTalks }: { pendingAbsences: number; openTalks: number }) {
  const path = usePathname() ?? "";
  const badges: Record<string, number> = { "/bangka/absences": pendingAbsences, "/bangka/talk": openTalks };
  const items = TABS.map((t) => (t.key in badges ? { ...t, badge: badges[t.key] } : t));
  const current = TABS.find((t) => path.startsWith(t.key))?.key ?? "";
  return <Tabs ariaLabel="동래방카 콘텐츠" value={current} items={items} />;
}
