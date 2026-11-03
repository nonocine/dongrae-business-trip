// 출처 ① 방과후아카데미 보호자 — 재원생(bk_students.status='active') 기준으로 고르고,
//   연결된 보호자에게 보냅니다. 대표 보호자만 / 모든 보호자.
//   보호자 상태(bk_guardians.status: invited·active·suspended) — 초대만 받고 가입 전(invited)도
//   번호가 있으면 포함, 사용중지(suspended)만 제외(관장 결정 2026-11). 탈퇴 상태 값은 없습니다.
//   사용: M0 또는 bangka 직무(학생·보호자 관리 화면과 같은 기준, lib/bangkaAccess).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bkClassLabel } from "@/lib/bangka";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import { idsOf, inChunks, str, type ResolvedPerson, type SmsSource } from "./types";

type Student = { id: string; name: string; grade: string | null; class_code: string };
type Link = { student_id: string; guardian_id: string; is_primary: boolean };
type Guardian = { id: string; name: string | null; phone: string | null };

async function loadAll() {
  const { data: stuData, error } = await supabaseAdmin
    .from("bk_students")
    .select("id, name, grade, class_code")
    .eq("status", "active")
    .order("class_code")
    .order("grade")
    .order("name");
  if (error) throw new Error(`학생 조회 실패: ${error.message}`);
  const students = (stuData ?? []) as Student[];
  const links = await inChunks(
    students.map((s) => s.id),
    async (chunk) => {
      const { data, error: e } = await supabaseAdmin
        .from("bk_guardian_students")
        .select("student_id, guardian_id, is_primary")
        .in("student_id", chunk);
      if (e) throw new Error(`보호자 연결 조회 실패: ${e.message}`);
      return (data ?? []) as Link[];
    },
  );
  const guardians = await loadGuardians([...new Set(links.map((l) => l.guardian_id))]);
  return { students, links, guardians };
}

// 보낼 수 있는 보호자(사용중지 제외) — id → 이름·번호.
const EXCLUDED_GUARDIAN_STATUSES = ["suspended"];
async function loadGuardians(ids: string[]) {
  const rows = await inChunks(ids, async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from("bk_guardians")
      .select("id, name, phone")
      .in("id", chunk)
      .not("status", "in", `(${EXCLUDED_GUARDIAN_STATUSES.join(",")})`);
    if (error) throw new Error(`보호자 조회 실패: ${error.message}`);
    return (data ?? []) as Guardian[];
  });
  return new Map(rows.map((g) => [g.id, { name: str(g.name), phone: g.phone }]));
}

function guardiansOf(
  studentId: string,
  mode: string,
  links: Link[],
  guardians: Map<string, { name: string; phone: string | null }>,
) {
  return links.filter(
    (l) =>
      l.student_id === studentId &&
      (mode === "all" || l.is_primary) &&
      guardians.has(l.guardian_id) &&
      isValidSmsPhone(normalizeSmsPhone(guardians.get(l.guardian_id)?.phone ?? "")),
  );
}

export const bkGuardiansSource: SmsSource = {
  key: "bk-guardians",
  label: "방과후아카데미 보호자",
  icon: "🏫",
  description: "이음반·지음반 재원생 보호자",
  pickerType: "list",
  color: "blue",
  canUse: (u) => u.isM0 || u.roles.includes("bangka"),

  async loadOptions(_u, { filter }) {
    const { students, links, guardians } = await loadAll();
    const cls = filter.class ?? "all";
    const grade = filter.grade ?? "all";
    const mode = filter.mode === "all" ? "all" : "primary";
    const grades = [...new Set(students.map((s) => s.grade ?? "").filter(Boolean))].sort();
    const classes = [...new Set(students.map((s) => s.class_code))].sort();
    return {
      filters: [
        {
          key: "class",
          label: "반",
          kind: "select",
          value: cls,
          options: [{ value: "all", label: "전체" }, ...classes.map((c) => ({ value: c, label: bkClassLabel(c) }))],
        },
        {
          key: "grade",
          label: "학년",
          kind: "select",
          value: grade,
          options: [{ value: "all", label: "전체" }, ...grades.map((g) => ({ value: g, label: g }))],
        },
        {
          key: "mode",
          label: "보호자",
          kind: "radio",
          value: mode,
          options: [
            { value: "primary", label: "대표 보호자만" },
            { value: "all", label: "모든 보호자" },
          ],
        },
      ],
      items: students
        .filter((s) => (cls === "all" || s.class_code === cls) && (grade === "all" || s.grade === grade))
        .map((s) => {
          const n = guardiansOf(s.id, mode, links, guardians).length;
          return {
            id: s.id,
            name: s.name,
            sub: `${bkClassLabel(s.class_code)} · ${s.grade || "-"} · ${n > 0 ? `보호자 ${n}명` : "번호 없음"}`,
            hasPhone: n > 0,
          };
        }),
      note: "같은 보호자는 한 번만 보냅니다. 초대만 받은 보호자도 번호가 있으면 받고, 사용중지 보호자는 빠집니다.",
    };
  },

  async resolvePhones(_u, sel) {
    const mode = sel.filter?.mode === "all" ? "all" : "primary";
    const { students, links, guardians } = await loadAll();
    const wanted = new Set(idsOf(sel));
    const picked = students.filter((s) => wanted.has(s.id));
    const people: ResolvedPerson[] = [];
    const seen = new Set<string>();
    for (const s of picked) {
      const gs = guardiansOf(s.id, mode, links, guardians);
      if (gs.length === 0) {
        people.push({ key: `bk-student:${s.id}`, name: `${s.name} 보호자`, phone: null, ref: { source: "bk-guardians", ref_id: null, phone: null } });
        continue;
      }
      for (const l of gs) {
        if (seen.has(l.guardian_id)) continue;
        seen.add(l.guardian_id);
        const g = guardians.get(l.guardian_id)!;
        people.push({
          key: `bk-guardians:${l.guardian_id}`,
          name: `${g.name || "보호자"}(${s.name})`,
          phone: g.phone,
          ref: { source: "bk-guardians", ref_id: l.guardian_id, phone: null },
        });
      }
    }
    return {
      label: `방과후 보호자${mode === "all" ? "(모두)" : ""} · 학생 ${picked.length}명`,
      short: "방과후 보호자",
      people,
    };
  },

  async resolveRefs(ids) {
    return loadGuardians(ids);
  },
};
