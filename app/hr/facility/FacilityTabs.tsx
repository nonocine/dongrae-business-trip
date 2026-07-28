"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

const TABS = [
  { href: "/hr/facility/assets", label: "비품관리" },
  { href: "/hr/facility/locations", label: "장소관리" },
  { href: "/hr/facility/safety", label: "안전점검" },
];

export default function FacilityTabs() {
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
