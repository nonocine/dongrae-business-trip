"use client";

import { usePathname } from "next/navigation";
import Tabs from "@/app/components/Tabs";

export default function BangkaTabs() {
  const path = usePathname() ?? "";
  const current = path.startsWith("/bangka/members/guardians")
    ? "guardians"
    : path.startsWith("/bangka/members/bulk")
      ? "bulk"
      : "students";
  return (
    <Tabs
      ariaLabel="학생·보호자 관리"
      value={current}
      items={[
        { key: "students", href: "/bangka/members", label: "학생", icon: "backpack" },
        { key: "guardians", href: "/bangka/members/guardians", label: "보호자", icon: "users" },
        { key: "bulk", href: "/bangka/members/bulk", label: "일괄 등록", icon: "fileUp" },
      ]}
    />
  );
}
