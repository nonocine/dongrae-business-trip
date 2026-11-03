// 출처 ③ 강사 — [활동 중 강사 전체] 또는 [동래미래 차시 → 그 차시 담당 강사만].
//   번호: saem_instructors.phone. 상태 'active' 만.
//   사용: M0 또는 saem 직무(강사 휴대전화 열람 기준과 같음, lib/saemAccess).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import { academyTermLabel, loadAcademyTerms, loadTermPrograms } from "./saem-academy";
import { idsOf, inChunks, str, type SmsSource } from "./types";

type Instructor = { id: string; name: string; phone: string | null };

async function loadActive(): Promise<Instructor[]> {
  const { data, error } = await supabaseAdmin
    .from("saem_instructors")
    .select("id, name, phone")
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(`강사 조회 실패: ${error.message}`);
  return (data ?? []) as Instructor[];
}

export const instructorsSource: SmsSource = {
  key: "instructors",
  label: "강사",
  icon: "🧑‍🏫",
  description: "활동 중 강사 · 차시 담당 강사",
  pickerType: "list",
  color: "amber",
  canUse: (u) => u.isM0 || u.roles.includes("saem"),

  async loadOptions(_u, { filter }) {
    const terms = await loadAcademyTerms();
    const scope = filter.scope && terms.some((t) => t.id === filter.scope) ? filter.scope : "all";
    let list = await loadActive();
    const programNames = new Map<string, string[]>();
    if (scope !== "all") {
      const programs = await loadTermPrograms([scope]);
      for (const p of programs) {
        if (!p.instructor_id) continue;
        programNames.set(p.instructor_id, [...(programNames.get(p.instructor_id) ?? []), p.name]);
      }
      list = list.filter((i) => programNames.has(i.id));
    }
    return {
      filters: [
        {
          key: "scope",
          label: "범위",
          kind: "select",
          value: scope,
          options: [
            { value: "all", label: "활동 중 강사 전체" },
            ...terms.map((t) => ({ value: t.id, label: `동래미래 ${academyTermLabel(t)} 담당 강사` })),
          ],
        },
      ],
      bulkLabel: scope === "all" ? "활동 중 강사 전체 담기" : "이 차시 담당 강사 모두 담기",
      items: list.map((i) => ({
        id: i.id,
        name: i.name,
        sub: programNames.get(i.id)?.join(", "),
        hasPhone: isValidSmsPhone(normalizeSmsPhone(i.phone ?? "")),
      })),
    };
  },

  async resolvePhones(_u, sel) {
    const wanted = new Set(idsOf(sel));
    const list = (await loadActive()).filter((i) => wanted.has(i.id));
    const scope = sel.filter?.scope;
    let label = `강사 ${list.length}명`;
    if (scope && scope !== "all") {
      const term = (await loadAcademyTerms()).find((t) => t.id === scope);
      if (term) label = `강사 · ${term.name} 담당 ${list.length}명`;
    }
    return {
      label,
      short: "강사",
      people: list.map((i) => ({
        key: `instructors:${i.id}`,
        name: i.name,
        phone: i.phone,
        ref: { source: "instructors", ref_id: i.id, phone: null },
      })),
    };
  },

  async resolveRefs(ids) {
    const rows = await inChunks(ids, async (chunk) => {
      const { data, error } = await supabaseAdmin
        .from("saem_instructors")
        .select("id, name, phone")
        .in("id", chunk)
        .eq("status", "active");
      if (error) throw new Error(`강사 조회 실패: ${error.message}`);
      return (data ?? []) as Instructor[];
    });
    return new Map(rows.map((r) => [r.id, { name: str(r.name), phone: r.phone }]));
  },
};
