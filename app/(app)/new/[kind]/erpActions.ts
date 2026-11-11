"use server";

// 활동(외근·출장) 작성 — ERP 출장·외근 제안. 작성자 본인(세션) 것만, 진행·완료만.
//   읽기 전용(ERP·DB 쓰기 없음). 저장은 직원이 확인 후 평소처럼 합니다.
import { erpLastSyncedAt, loadDutiesOverlapping, resolveErpViewer } from "@/lib/erp/view";
import { FIELD_TYPES, dutyCoversDay, dutyTimeText } from "@/lib/erp/duty";

export type ErpFieldSuggestion = { dutyId: number; type: "출장" | "외근"; location: string; time: string };

export async function getMyErpFieldDuties(date: string): Promise<{
  linked: boolean;
  items: ErpFieldSuggestion[];
  syncedAt: string | null;
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return { linked: false, items: [], syncedAt: null };
  const viewer = await resolveErpViewer();
  // 현재+이전 ERP 계정 모두(팀 이동 발령 전 계정의 출장·외근도).
  if (!viewer?.erpIds.length) return { linked: false, items: [], syncedAt: null };
  const [duties, syncedAt] = await Promise.all([
    loadDutiesOverlapping(date, date, { employeeIds: viewer.erpIds }),
    erpLastSyncedAt("duties"),
  ]);
  const items: ErpFieldSuggestion[] = duties
    .filter((d) => FIELD_TYPES.has((d.type_name ?? "").trim()) && dutyCoversDay(d.start_at, d.end_at, date))
    .map((d) => ({
      dutyId: d.duty_id,
      type: (d.type_name ?? "").trim() === "출장" ? "출장" : "외근",
      location: (d.location ?? "").trim(),
      time: dutyTimeText(d.start_at, d.end_at),
    }));
  return { linked: true, items, syncedAt };
}
