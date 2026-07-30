// =====================================================================
// 강사 명단 엑셀·백업 공용 — 데이터 로더 + exceljs 워크북(급여대장/비품 패턴).
//   * 가드 없음(라우트가 requireSaemAccess 후 호출). saem_* 만.
// =====================================================================

import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SAEM_DOC_SLOTS } from "@/lib/saem";
import {
  CRIME_CHECK_SLOT,
  crimeCheckState,
  crimeCheckLabel,
} from "@/lib/saemDocExpiry";
import { kstTodayYmd } from "@/lib/trainings";

export type InstructorExportRow = {
  id: string;
  name: string;
  phone: string;
  phoneLast4: string;
  email: string;
  bankName: string;
  bankAccount: string;
  accountHolder: string;
  statusLabel: string;
  joinState: string; // 미가입 / 임시비번 / 가입완료
  slots: Record<string, boolean>; // slotKey → 업로드 여부
  programs: string; // "프로젝트·차시·프로그램; ..."
  createdAt: string;
  // 성범죄경력조회 만료 관리(SA-14).
  crimeIssuedOn: string;
  crimeExpiresOn: string;
  crimeStatusLabel: string;
};

export async function loadInstructorExportRows(): Promise<InstructorExportRow[]> {
  const [{ data: ins }, { data: docs }, { data: progs }, { data: terms }, { data: projs }] =
    await Promise.all([
      supabaseAdmin.from("saem_instructors").select("*"),
      supabaseAdmin
        .from("saem_instructor_documents")
        .select("instructor_id, slot, issued_on"),
      supabaseAdmin.from("saem_programs").select("instructor_id, name, term_id, period_no, sort_order"),
      supabaseAdmin.from("saem_terms").select("id, name, project_id"),
      supabaseAdmin.from("saem_projects").select("id, name"),
    ]);

  const today = kstTodayYmd();
  const slotsByInstr = new Map<string, Set<string>>();
  const crimeIssued = new Map<string, string | null>();
  for (const d of docs ?? []) {
    const r = d as {
      instructor_id: string;
      slot: string;
      issued_on: string | null;
    };
    const s = slotsByInstr.get(r.instructor_id) ?? new Set<string>();
    s.add(r.slot);
    slotsByInstr.set(r.instructor_id, s);
    if (r.slot === CRIME_CHECK_SLOT)
      crimeIssued.set(r.instructor_id, r.issued_on ?? null);
  }
  const projName = new Map(
    (projs ?? []).map((p) => [(p as { id: string }).id, (p as { name: string }).name])
  );
  const termInfo = new Map(
    (terms ?? []).map((t) => {
      const r = t as { id: string; name: string; project_id: string };
      return [r.id, { name: r.name, project: projName.get(r.project_id) ?? "" }];
    })
  );
  const progsByInstr = new Map<
    string,
    { name: string; term_id: string; period_no: number | null; sort_order: number }[]
  >();
  for (const p of progs ?? []) {
    const r = p as {
      instructor_id: string | null;
      name: string;
      term_id: string;
      period_no: number | null;
      sort_order: number | null;
    };
    if (!r.instructor_id) continue;
    const list = progsByInstr.get(r.instructor_id) ?? [];
    list.push({
      name: r.name,
      term_id: r.term_id,
      period_no: r.period_no,
      sort_order: r.sort_order ?? 0,
    });
    progsByInstr.set(r.instructor_id, list);
  }

  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const rows: InstructorExportRow[] = (ins ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const id = String(r.id);
    const phone = digits(r.phone as string | null);
    const slotSet = slotsByInstr.get(id) ?? new Set<string>();
    const slots: Record<string, boolean> = {};
    for (const sl of SAEM_DOC_SLOTS) slots[sl.key] = slotSet.has(sl.key);
    const passwordSet = !!r.password_set_at;
    const mustChange = r.must_change_password === true;
    const crime = crimeCheckState(crimeIssued.get(id) ?? null, today);
    const myProgs = (progsByInstr.get(id) ?? [])
      .sort((a, b) => (a.period_no ?? 9999) - (b.period_no ?? 9999) || a.sort_order - b.sort_order)
      .map((p) => {
        const t = termInfo.get(p.term_id);
        return `${t?.project ?? ""}·${t?.name ?? ""}·${p.name}`;
      });
    return {
      id,
      name: String(r.name ?? ""),
      phone,
      phoneLast4: phone.slice(-4),
      email: String(r.email ?? ""),
      bankName: String(r.bank_name ?? ""),
      bankAccount: String(r.bank_account ?? ""),
      accountHolder: String(r.account_holder ?? ""),
      statusLabel: r.status === "inactive" ? "비활성" : "활성",
      joinState: !passwordSet ? "미가입" : mustChange ? "임시비번" : "가입완료",
      slots,
      programs: myProgs.join("; "),
      createdAt: String(r.created_at ?? "").slice(0, 10),
      crimeIssuedOn: crime.issuedOn ?? "",
      crimeExpiresOn: crime.expiresOn ?? "",
      crimeStatusLabel: crimeCheckLabel(crime),
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return rows;
}

const NAVY = "FF1F3A5F";

export async function buildInstructorsWorkbook(
  rows: InstructorExportRow[]
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터";
  const ws = wb.addWorksheet("강사명단", { views: [{ state: "frozen", ySplit: 1 }] });

  const headers = [
    "이름",
    "전화",
    "이메일",
    "은행",
    "계좌",
    "예금주",
    "상태",
    "가입상태",
    ...SAEM_DOC_SLOTS.map((s) => s.label),
    "성범죄경력 발급일",
    "성범죄경력 만료일",
    "성범죄경력 상태",
    "담당 프로그램",
    "등록일",
  ];
  const headerRow = ws.addRow(headers);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  for (const r of rows) {
    ws.addRow([
      r.name,
      r.phone,
      r.email,
      r.bankName,
      r.bankAccount,
      r.accountHolder,
      r.statusLabel,
      r.joinState,
      ...SAEM_DOC_SLOTS.map((s) => (r.slots[s.key] ? "O" : "X")),
      r.crimeIssuedOn,
      r.crimeExpiresOn,
      r.crimeStatusLabel,
      r.programs,
      r.createdAt,
    ]);
  }

  const widths = [
    10, 13, 20, 10, 16, 9, 7, 9,
    ...SAEM_DOC_SLOTS.map(() => 8),
    15, 15, 16,
    40, 12,
  ];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  // O/X 가운데 정렬.
  const slotStart = 9;
  for (let c = slotStart; c < slotStart + SAEM_DOC_SLOTS.length; c++) {
    ws.getColumn(c).alignment = { horizontal: "center" };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
