"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

// 열람자에게는 [연마감](엑셀 출력·과거 이관)을 노출하지 않는다.
//   페이지 자체도 requireMutualManage 로 막혀 있으므로 탭 숨김은 안내 목적이다.
const TABS = [
  { href: "/hr/mutual/ledger", label: "장부", manageOnly: false },
  { href: "/hr/mutual/members", label: "회원", manageOnly: false },
  { href: "/hr/mutual/policy", label: "규정", manageOnly: false },
  { href: "/hr/mutual/closing", label: "연마감", manageOnly: true },
];

export default function MutualTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname() ?? "";
  const tabs = TABS.filter((t) => canManage || !t.manageOnly);
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={tabItemCls(path.startsWith(t.href))}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
