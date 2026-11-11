import ExcelJS from "exceljs";
import { loadPromotionBoard, resolveLeavePromotionAccess, type NoticeInfo, type PromotionRow } from "@/lib/leavePromotionServer";
import { DELIVERY_LABEL, STEP_LABEL, TRACK_LABEL, type StepState } from "@/lib/leavePromotion";
import { buildPromotionReportPdf } from "@/lib/leavePromotionPdf";

// 연차 사용촉진 연도별 이행 현황 보고서 — 직원별 단계·날짜·방식·미사용·소멸.
//   GET /hr/leave-plans/promotion-report?year=2026&format=xlsx|pdf
//   라우트는 페이지 가드 밖 → 자체 재검증(관장·hr·인사 파일 열람).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "이름",
  "부서",
  "구분",
  "미사용(ERP)",
  "1차 상태",
  "1차 발송일",
  "1차 방식",
  "1차 박제 일수",
  "계획서 제출일",
  "계획 미이행 일",
  "2차 상태",
  "2차 발송일",
  "2차 방식",
  "2차 지정일",
  "소멸 예정",
];
const WIDTHS = [7, 9, 6, 6, 7, 7, 9, 6, 7, 10, 7, 7, 9, 12, 6];

const n = (v: number | null | undefined) => (v == null ? "" : Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
const st = (s: StepState | "na") => (s === "na" ? "해당 없음" : STEP_LABEL[s]);
const sent = (x: NoticeInfo | null) => (x?.sentAt ? new Date(new Date(x.sentAt).getTime() + 9 * 3600000).toISOString().slice(0, 10) : "");
const method = (x: NoticeInfo | null) =>
  x?.method ? `${DELIVERY_LABEL[x.method]}${x.erpDocumentNumber != null ? ` (${x.erpDocumentNumber}호)` : ""}` : "";

function cells(r: PromotionRow): string[] {
  return [
    r.name,
    r.department ?? "",
    TRACK_LABEL[r.track],
    n(r.unusedErp),
    st(r.stage1State),
    sent(r.stage1),
    method(r.stage1),
    n(r.stage1?.unusedDays),
    r.plan?.submittedAt ? r.plan.submittedAt.slice(0, 10) : "",
    r.missedDates.join(", "),
    st(r.stage2State),
    sent(r.stage2),
    method(r.stage2),
    (r.stage2?.designatedDates ?? []).join(", "),
    n(r.forfeitDays),
  ];
}

export async function GET(req: Request) {
  if (!(await resolveLeavePromotionAccess().catch(() => null))) return new Response("권한이 없습니다.", { status: 403 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  if (!Number.isFinite(year) || year < 2000) return new Response("연도가 올바르지 않습니다.", { status: 400 });
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const board = await loadPromotionBoard(year);
  const rows = board.rows.map(cells);
  const stamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subtitle = `근로기준법 제61조 · 취업규칙 제28조⑤·제29조 · 미사용/소멸 예정은 ERP 연차 잔여 기준 · 출력 ${stamp}`;
  const filename = `연차사용촉진_이행현황_${year}.${format}`;
  const disp = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

  if (format === "pdf") {
    const bytes = await buildPromotionReportPdf({
      title: `${year}년 연차 사용촉진 이행 현황`,
      subtitle,
      headers: HEADERS,
      widths: WIDTHS,
      rows,
    });
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": disp, "Cache-Control": "no-store" },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${year} 이행 현황`);
  ws.addRow([`${year}년 연차 사용촉진 이행 현황`]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { size: 9, color: { argb: "FF666666" } };
  ws.addRow([]);
  const head = ws.addRow(HEADERS);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
  for (const r of rows) {
    const row = ws.addRow(r);
    row.eachCell((c) => {
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      c.alignment = { vertical: "top", wrapText: true };
    });
  }
  ws.columns.forEach((col, i) => (col.width = Math.max(8, WIDTHS[i] * 1.6)));
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disp,
      "Cache-Control": "no-store",
    },
  });
}
