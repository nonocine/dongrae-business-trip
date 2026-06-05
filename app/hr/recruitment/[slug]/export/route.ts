import ExcelJS from "exceljs";
import {
  loadReportData,
  STATUS_LABEL,
  SCREENING_MAX,
  INTERVIEW_MAX,
  TOTAL_MAX,
} from "@/lib/recruitmentReport";

// exceljs 는 Node 런타임 필요. 채점 데이터는 매 요청 최신값으로.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 휴대전화 11자리면 010-1234-5678 형태로. 그 외는 원문.
function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (/^01\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return raw;
}

// 점수 셀 — 숫자면 소수1자리 number, 없으면 빈 칸.
function scoreCell(n: number | null): number | string {
  if (n == null) return "";
  return Math.round(n * 10) / 10;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await loadReportData(slug); // 미인증 시 내부에서 '/' redirect
  if (!data) {
    return new Response("공고를 찾을 수 없습니다.", { status: 404 });
  }
  const { posting, applicants, interviewReviewers } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = "동래구청소년센터 채용시스템";
  const ws = wb.addWorksheet("채용 집계", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  // 헤더 구성 — 면접 위원 수에 따라 열이 늘어남.
  const headers = [
    "순위",
    "접수번호",
    "이름",
    "연락처",
    "지원분야",
    `서류 (/${SCREENING_MAX})`,
    ...interviewReviewers.map((r) => `면접·${r} (/${INTERVIEW_MAX})`),
    `면접 평균 (/${INTERVIEW_MAX})`,
    `합계 (/${TOTAL_MAX})`,
    "상태",
  ];

  // 1행: 제목(병합), 2행: 부제, 3행: 헤더.
  const titleRow = ws.addRow([`${posting.title} — 채용 심사 집계표`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, headers.length);

  const subRow = ws.addRow([
    `채용분야: ${posting.field || "-"}    모집 ${posting.recruit_count}명    접수 ${applicants.length}명`,
  ]);
  subRow.font = { size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, headers.length);

  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F3A5F" }, // navy
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });

  for (const a of applicants) {
    const row = ws.addRow([
      a.rank,
      a.applicant_number,
      a.name,
      fmtPhone(a.phone),
      posting.field,
      scoreCell(a.screeningAvg),
      ...interviewReviewers.map((r) => {
        const s = a.interviewByReviewer.get(r);
        if (!s) return "";
        if (s.is_absent) return "불참";
        return scoreCell(s.total);
      }),
      scoreCell(a.interviewAvg),
      scoreCell(a.total),
      STATUS_LABEL[a.status],
    ]);
    // 합계 열 강조.
    const totalCol = headers.length - 1;
    row.getCell(totalCol).font = { bold: true };
    row.alignment = { vertical: "middle" };
  }

  // 열 너비.
  const widths = [
    6, // 순위
    14, // 접수번호
    10, // 이름
    16, // 연락처
    16, // 지원분야
    10, // 서류
    ...interviewReviewers.map(() => 14),
    12, // 면접평균
    12, // 합계
    10, // 상태
  ];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // 숫자 열 가운데 정렬(순위 + 점수 열).
  const numericCols = [
    1,
    6,
    ...interviewReviewers.map((_, i) => 7 + i),
    7 + interviewReviewers.length,
    8 + interviewReviewers.length,
  ];
  for (const c of numericCols) {
    ws.getColumn(c).alignment = { horizontal: "center", vertical: "middle" };
  }

  // 헤더 행 기준 자동 필터.
  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: headers.length },
  };

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `ERP_채용집계_${posting.slug}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
