"use client";

import { usePathname } from "next/navigation";
import Tabs, { type TabItem } from "@/app/components/Tabs";

// 정산은 금액을 다루므로 관리 권한(M0·saem 직무)에게만 보입니다.
const TABS: (TabItem & { manage?: boolean })[] = [
  { key: "/hr/saems/instructors", href: "/hr/saems/instructors", label: "강사 관리", icon: "graduationCap" },
  { key: "/hr/saems/programs", href: "/hr/saems/programs", label: "프로그램 관리", icon: "layers" },
  { key: "/hr/saems/enrollments", href: "/hr/saems/enrollments", label: "수강생", icon: "users" },
  { key: "/hr/saems/logs", href: "/hr/saems/logs", label: "근무일지 확정", icon: "clipboardCheck" },
  { key: "/hr/saems/settlements", href: "/hr/saems/settlements", label: "정산", icon: "wallet", manage: true },
  { key: "/hr/saems/certificates", href: "/hr/saems/certificates", label: "강의확인증", icon: "award" },
];

export default function SaemTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname() ?? "";
  const tabs = TABS.filter((t) => !t.manage || canManage);
  const current = tabs.find((t) => path.startsWith(t.key))?.key ?? "";
  return <Tabs ariaLabel="강사·프로그램 관리" value={current} items={tabs} />;
}
