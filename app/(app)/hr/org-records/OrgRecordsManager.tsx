"use client";

import { useState } from "react";
import {
  ORG_RECORD_TABS,
  type OrgAgreement,
  type OrgAward,
  type OrgRecordTab,
} from "@/lib/orgRecords";
import type { PartnerOption, StaffOption } from "@/app/(app)/hr/org-records/actions";
import AgreementsTab from "@/app/(app)/hr/org-records/AgreementsTab";
import AwardsTab from "@/app/(app)/hr/org-records/AwardsTab";
import Tabs from "@/app/components/Tabs";
import type { TabIconName } from "@/app/components/TabIcon";

// 기관 대장 — 탭 껍데기.
//   탭 목록은 lib/orgRecords 의 ORG_RECORD_TABS 하나로 정합니다. 새 탭(공모사업
//   선정·기관 방문·대외 협력)은 거기 한 줄 + 아래 TAB_BODY 에 컴포넌트 하나.



// 탭 아이콘 — lib/orgRecords 의 이모지(icon)는 다른 화면용으로 두고, 탭 줄은 선 아이콘으로.
const ORG_RECORD_TAB_ICON: Record<OrgRecordTab, TabIconName> = {
  agreements: "handshake",
  awards: "trophy",
};

export default function OrgRecordsManager({
  initialTab,
  agreements,
  awards,
  partners,
  staff,
  today,
}: {
  today: string;
  initialTab: OrgRecordTab;
  agreements: OrgAgreement[];
  awards: OrgAward[];
  partners: PartnerOption[];
  staff: StaffOption[];
}) {
  const [tab, setTab] = useState<OrgRecordTab>(initialTab);

  const select = (key: OrgRecordTab) => {
    setTab(key);
    // 새로고침·공유해도 같은 탭이 열리도록 주소만 바꿉니다(서버 왕복 없음).
    window.history.replaceState(null, "", `?tab=${key}`);
  };

  const counts: Record<OrgRecordTab, number> = {
    agreements: agreements.length,
    awards: awards.length,
  };

  const TAB_BODY: Record<OrgRecordTab, React.ReactNode> = {
    agreements: <AgreementsTab today={today} rows={agreements} partners={partners} staff={staff} />,
    awards: <AwardsTab rows={awards} staff={staff} />,
  };

  return (
    <div className="space-y-4">
      {/* 관장 피드백 — "올리기 버튼이 안 보인다". 진입점을 글로 한 번 더 알려 줍니다. */}
      <p className="rounded-lg border border-rule bg-card px-3 py-2 text-sm text-ink-body">
        📎 각 줄의 <span className="font-semibold text-navy">[+ 올리기]</span>로 협약서·상장 스캔본과 사진을 올릴 수
        있습니다
      </p>
      <Tabs
        ariaLabel="기관 대장 종류"
        value={tab}
        onChange={select}
        items={ORG_RECORD_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          icon: ORG_RECORD_TAB_ICON[t.key],
          count: counts[t.key],
        }))}
      />
      {TAB_BODY[tab]}
    </div>
  );
}
