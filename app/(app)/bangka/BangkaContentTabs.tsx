"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

const TABS = [
  { href: "/bangka/posts", label: "공지·알림장" },
  { href: "/bangka/meals", label: "급식" },
  { href: "/bangka/events", label: "연간일정" },
  { href: "/bangka/absences", label: "공결" },
];

export default function BangkaContentTabs() {
  const path = usePathname() ?? "";
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={tabItemCls(path.startsWith(t.href))}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
