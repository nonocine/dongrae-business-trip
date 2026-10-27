import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { ABSENCE_STATUS_LABEL, absenceReasonLabel, type AbsenceRow } from "@/lib/bangkaAbsence";
import { BK_SCOPE_LABEL, type BkScope } from "@/lib/bangkaContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 전화공결관리대장(자체양식) 엑셀 — ?ym=2026-10 (없으면 전체). 전화로 받은 공결만.
export async function GET(request: Request) {
  if (!(await resolveBangkaAccess())) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const ym = new URL(request.url).searchParams.get("ym");
  let q = supabaseAdmin
    .from("bk_absences")
    .select("*, bk_students(name, school, grade, class_code)")
    .eq("channel", "phone")
    .order("start_date")
    .order("created_at");
  if (ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) {
    const [y, m] = ym.split("-").map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
    q = q.lt("start_date", next).gte("end_date", `${ym}-01`);
  }
  const { data, error } = await q;
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data ?? []) as (AbsenceRow & {
    bk_students: { name: string; school: string | null; grade: string | null; class_code: string } | null;
  })[];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("전화공결관리대장", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.mergeCells("A1:K1");
  ws.getCell("A1").value = `전화공결관리대장${ym ? ` (${ym.replace("-", "년 ")}월)` : ""}`;
  ws.getCell("A1").font = { bold: true, size: 15 };
  ws.getCell("A1").alignment = { horizontal: "center" };
  const head = ["번호", "접수일시", "받은 직원", "학생", "반", "학교·학년", "공결 기간", "사유 구분", "사유", "처리 상태", "결재(반려)자"];
  const hr = ws.addRow([]);
  ws.addRow(head);
  hr.height = 4;
  const kst = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 16).replace("T", " ");
  };
  rows.forEach((r, i) => {
    const st = r.bk_students;
    ws.addRow([
      i + 1,
      kst(r.created_at),
      r.received_by ?? "",
      st?.name ?? "",
      st ? BK_SCOPE_LABEL[st.class_code as BkScope] ?? st.class_code : "",
      [st?.school, st?.grade].filter(Boolean).join(" "),
      r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`,
      absenceReasonLabel(r.reason_type),
      r.reason ?? "",
      ABSENCE_STATUS_LABEL[r.status] + (r.status === "rejected" && r.reject_reason ? `(${r.reject_reason})` : ""),
      r.approved_by ?? "",
    ]);
  });
  const widths = [6, 17, 11, 10, 8, 16, 24, 12, 40, 16, 12];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.eachRow((row, n) => {
    if (n < 3) return;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      c.alignment = { vertical: "middle", wrapText: true, horizontal: n === 3 ? "center" : undefined };
      if (n === 3) {
        c.font = { bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } };
      }
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `전화공결관리대장${ym ? `_${ym}` : ""}.xlsx`;
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
