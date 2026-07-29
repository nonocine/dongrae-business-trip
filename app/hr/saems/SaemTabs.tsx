"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

const TABS = [
  { href: "/hr/saems/instructors", label: "강사 관리" },
  { href: "/hr/saems/programs", label: "프로그램 관리" },
  { href: "/hr/saems/logs", label: "근무일지 확정" },
];

export default function SaemTabs() {
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
