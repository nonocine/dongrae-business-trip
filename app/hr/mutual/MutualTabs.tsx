"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

const TABS = [
  { href: "/hr/mutual/ledger", label: "장부" },
  { href: "/hr/mutual/members", label: "회원" },
  { href: "/hr/mutual/closing", label: "연마감" },
];

export default function MutualTabs() {
  const path = usePathname() ?? "";
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {TABS.map((t) => (
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
