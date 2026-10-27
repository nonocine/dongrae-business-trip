"use client";

import { usePathname } from "next/navigation";
import Tabs, { type TabItem } from "@/app/components/Tabs";

// 열람자에게는 [연마감](엑셀 출력·과거 이관)을 노출하지 않는다.
//   페이지 자체도 requireMutualManage 로 막혀 있으므로 탭 숨김은 안내 목적이다.
const TABS: (TabItem & { manageOnly: boolean })[] = [
  { key: "/hr/mutual/ledger", href: "/hr/mutual/ledger", label: "장부", icon: "bookOpen", manageOnly: false },
  { key: "/hr/mutual/members", href: "/hr/mutual/members", label: "회원", icon: "users", manageOnly: false },
  { key: "/hr/mutual/policy", href: "/hr/mutual/policy", label: "규정", icon: "scale", manageOnly: false },
  { key: "/hr/mutual/closing", href: "/hr/mutual/closing", label: "연마감", icon: "archive", manageOnly: true },
];

export default function MutualTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname() ?? "";
  const tabs = TABS.filter((t) => canManage || !t.manageOnly);
  const current = tabs.find((t) => path.startsWith(t.key))?.key ?? "";
  return <Tabs ariaLabel="상조회" value={current} items={tabs} />;
}
