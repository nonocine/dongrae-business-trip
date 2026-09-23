"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

// 정산은 금액을 다루므로 관리 권한(M0·saem 직무)에게만 보입니다.
const TABS = [
  { href: "/hr/saems/instructors", label: "강사 관리" },
  { href: "/hr/saems/programs", label: "프로그램 관리" },
  { href: "/hr/saems/enrollments", label: "수강생" },
  { href: "/hr/saems/logs", label: "근무일지 확정" },
  { href: "/hr/saems/settlements", label: "정산", manage: true },
  { href: "/hr/saems/certificates", label: "강의확인증" },
];

export default function SaemTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname() ?? "";
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {TABS.filter((t) => !t.manage || canManage).map((t) => (
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
