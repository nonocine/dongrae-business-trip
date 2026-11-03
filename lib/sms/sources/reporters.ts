// 출처 ⑥ 기자 — 보도자료 기자 명단(press_reporters) 전체 또는 개별.
//   번호: press_reporters.phone.
//   사용: 관장 권한만 — 기자 명단은 관장 전용(docs/PRESS_AUTOMATION.md, 메뉴 managerAdmin).
//   나중에 넓히려면 canUse 한 줄만 바꾸면 됩니다.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import { idsOf, inChunks, str, type SmsSource } from "./types";

type Reporter = { id: string; name: string | null; outlet: string | null; phone: string | null };

async function loadReporters(ids?: string[]): Promise<Reporter[]> {
  if (ids)
    return inChunks(ids, async (chunk) => {
      const { data, error } = await supabaseAdmin
        .from("press_reporters")
        .select("id, name, outlet, phone")
        .in("id", chunk);
      if (error) throw new Error(`기자 조회 실패: ${error.message}`);
      return (data ?? []) as Reporter[];
    });
  const { data, error } = await supabaseAdmin
    .from("press_reporters")
    .select("id, name, outlet, phone")
    .order("outlet")
    .order("name");
  if (error) throw new Error(`기자 조회 실패: ${error.message}`);
  return (data ?? []) as Reporter[];
}

export const reportersSource: SmsSource = {
  key: "reporters",
  label: "기자",
  icon: "📰",
  description: "보도자료 기자 명단",
  pickerType: "list",
  color: "amber",
  canUse: (u) => u.isPressAdmin,

  async loadOptions() {
    const list = await loadReporters();
    return {
      filters: [],
      bulkLabel: "기자 전체 담기",
      items: list.map((r) => ({
        id: r.id,
        name: str(r.name) || "(이름 없음)",
        sub: r.outlet ?? undefined,
        hasPhone: isValidSmsPhone(normalizeSmsPhone(r.phone ?? "")),
      })),
    };
  },

  async resolvePhones(_u, sel) {
    const list = await loadReporters(idsOf(sel));
    return {
      label: `기자 ${list.length}명`,
      short: "기자",
      people: list.map((r) => ({
        key: `reporters:${r.id}`,
        name: `${str(r.name) || "기자"}${r.outlet ? `(${r.outlet})` : ""}`,
        phone: r.phone,
        ref: { source: "reporters", ref_id: r.id, phone: null },
      })),
    };
  },

  async resolveRefs(ids) {
    const list = await loadReporters(ids);
    return new Map(list.map((r) => [r.id, { name: str(r.name), phone: r.phone }]));
  },
};
