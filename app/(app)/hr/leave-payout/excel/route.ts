import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadPayoutRun, resolvePayoutAccess, RUNS } from "@/lib/leavePayoutServer";
import { PAYOUT_CATEGORY_LABEL, WAGE_ITEM_LABEL } from "@/lib/leavePayout";

// 연차수당 산정표 엑셀 — 급여 담당용. 시트1 직원별 줄, 시트2 계산 근거.
//   GET /hr/leave-payout/excel?runId=uuid — 라우트는 페이지 가드 밖 → 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await resolvePayoutAccess().catch(() => null))) return new Response("권한이 없습니다.", { status: 403 });
  const runId = new URL(req.url).searchParams.get("runId") ?? "";
  const { data: r } = await supabaseAdmin.from(RUNS).select("year").eq("id", runId).maybeSingle();
  if (!r) return new Response("산정표를 찾을 수 없습니다.", { status: 404 });
  const { run, lines } = await loadPayoutRun(Number((r as { year: number }).year));
  if (!run || run.id !== runId) return new Response("유효한 산정표가 아닙니다(무효 처리됨).", { status: 404 });

  const wb = new ExcelJS.Workbook();
  const border = { top: { style: "thin" as const }, bottom: { style: "thin" as const }, left: { style: "thin" as const }, right: { style: "thin" as const } };
  const ws = wb.addWorksheet("연차수당");
  ws.addRow([`${run.title} (${run.status === "confirmed" ? "확정" : "작성 중"})`]).font = { bold: true, size: 14 };
  ws.addRow([`포함 항목: ${Object.entries(run.wage_basis).filter(([, v]) => v).map(([k]) => WAGE_ITEM_LABEL[k as keyof typeof WAGE_ITEM_LABEL]).join(", ")} · 시간급 = 월 통상임금 ÷ 209, 일급 = 시간급 × 8`]);
  ws.addRow([]);
  const head = ws.addRow(["이름", "부서", "구분", "미사용 일수", "출처", "월 통상임금", "시간급", "일급", "금액", "제외", "제외 사유"]);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.border = border;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  });
  for (const l of lines) {
    const row = ws.addRow([
      l.name,
      l.department ?? "",
      PAYOUT_CATEGORY_LABEL[l.category],
      l.unused_days,
      l.unused_source === "manual" ? "직접 입력" : "ERP",
      l.monthly_ordinary_wage ?? "",
      l.hourly_ordinary_wage ?? "",
      l.daily_ordinary_wage ?? "",
      l.excluded ? 0 : l.amount,
      l.excluded ? "제외" : "",
      l.exclude_reason ?? "",
    ]);
    row.eachCell((c) => (c.border = border));
  }
  const total = ws.addRow(["합계", "", "", "", "", "", "", "", lines.filter((l) => !l.excluded).reduce((a, l) => a + l.amount, 0)]);
  total.font = { bold: true };
  [6, 7, 8, 9].forEach((i) => (ws.getColumn(i).numFmt = "#,##0"));
  ws.columns.forEach((c) => (c.width = 14));

  const ws2 = wb.addWorksheet("계산 근거");
  const h2 = ws2.addRow(["이름", "구분", "기준일", "ERP 잔여", "예정 사용", "예정 차감", "연봉계약서", "구간", "항목", "월액", "포함", "근거", "계산식", "오류"]);
  h2.font = { bold: true };
  for (const l of lines) {
    const s = l.calc_snapshot;
    const items = s.items?.length ? s.items : [null];
    items.forEach((it, i) => {
      ws2.addRow([
        i === 0 ? l.name : "",
        i === 0 ? PAYOUT_CATEGORY_LABEL[l.category] : "",
        i === 0 ? s.basis_date : "",
        i === 0 ? s.erp_remaining ?? "" : "",
        i === 0 ? s.planned_days : "",
        i === 0 ? (s.planned_deducted ? "차감" : "") : "",
        i === 0 ? s.contract?.contract_date ?? (s.contract ? "" : "없음") : "",
        i === 0 ? s.contract?.segment ?? "" : "",
        it?.label ?? "",
        it?.monthly ?? "",
        it ? (s.included.includes(it.key) ? "포함" : "제외") : "",
        it?.basis ?? "",
        i === 0 ? s.formula ?? "" : "",
        i === 0 ? (s.errors ?? []).join(" · ") : "",
      ]);
    });
  }
  ws2.getColumn(10).numFmt = "#,##0";
  ws2.columns.forEach((c, i) => (c.width = i === 12 ? 60 : 14));

  const buf = await wb.xlsx.writeBuffer();
  const filename = `연차수당_${run.year}_${run.status === "confirmed" ? "확정" : "작성중"}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
