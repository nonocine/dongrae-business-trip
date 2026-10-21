"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

const TABS = [
  { href: "/bangka/members", label: "학생", exact: true },
  { href: "/bangka/members/guardians", label: "보호자" },
  { href: "/bangka/members/bulk", label: "일괄 등록" },
];

export default function BangkaTabs() {
  const path = usePathname() ?? "";
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={tabItemCls(t.exact ? path === t.href : path.startsWith(t.href))}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
