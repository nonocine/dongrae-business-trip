import ExcelJS from "exceljs";
import { resolveDutyDashboardViewer } from "@/lib/erp/view";
import { loadLeaveTable } from "@/lib/erp/leaveTable";

// 직원별 연차·대휴 잔여 엑셀 — 복무·연차 대시보드와 같은 권한(관장 M0·hr 직무). 라우트는 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await resolveDutyDashboardViewer().catch(() => null))) return new Response("권한이 없습니다.", { status: 403 });
  const t = await loadLeaveTable();
  const rows = [...t.rows].sort((a, b) => (b.remaining ?? -1) - (a.remaining ?? -1) || a.name.localeCompare(b.name, "ko"));
  const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${t.year} 연차·대휴 잔여`);
  ws.addRow([`${t.year}년 직원별 연차·대휴 잔여 (ERP 기준)`]).font = { bold: true, size: 14 };
  ws.addRow([`출력 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 사용 = 올해 ERP 연가(결재 진행·완료) 합계 · 잔여 5일 이상 노랑, 10일 이상 주황`]);
  ws.addRow([]);
  const border = { top: { style: "thin" as const }, bottom: { style: "thin" as const }, left: { style: "thin" as const }, right: { style: "thin" as const } };
  const head = ws.addRow(["이름", "직급", "입사일", "첫해", "연차 부여", "사용", "잔여", "대휴 잔여", "마지막 동기화"]);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.border = border;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  });
  for (const r of rows) {
    const row = ws.addRow([r.name, r.rank ?? "", r.joinDate ?? "", r.firstYear ? "첫해" : "", r.allocation ?? "", r.used, r.remaining ?? "", r.compensatory ?? "", kst(r.syncedAt)]);
    row.eachCell((c) => (c.border = border));
    if (r.remaining != null && r.remaining >= 5)
      row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.remaining >= 10 ? "FFFED7AA" : "FFFEF08A" } };
  }
  for (const u of t.unlinked) {
    const row = ws.addRow([u.name, u.rank ?? "", u.joinDate ?? "", "", "ERP 연결 필요", "", "", "", ""]);
    row.font = { color: { argb: "FF888888" } };
    row.eachCell((c) => (c.border = border));
  }
  ws.columns.forEach((c, i) => (c.width = i === 8 ? 22 : 12));
  const buf = await wb.xlsx.writeBuffer();
  const filename = `연차대휴잔여_${t.year}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
