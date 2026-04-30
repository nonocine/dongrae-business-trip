import * as XLSX from "xlsx";
import { isAdmin, listActivities } from "@/app/actions";
import {
  ACTIVITY_KINDS,
  ACTIVITY_LABEL,
  TRANSPORT_LABEL,
  type Activity,
  type ActivityKind,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

function formatDate(d: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day}`;
}

function formatRange(start: string | null, end: string | null) {
  if (!start) return "";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

function transportLabel(t: string | null): string {
  if (!t) return "";
  return TRANSPORT_LABEL[t as keyof typeof TRANSPORT_LABEL] ?? t;
}

type SheetSpec = {
  name: string;
  headers: string[];
  cols: number[];
  rowFor(a: Activity): (string | number)[];
};

const SHEETS: Record<ActivityKind, SheetSpec> = {
  outside_work: {
    name: "외근",
    headers: [
      "날짜",
      "장소",
      "작성자",
      "동행자",
      "외근 목적",
      "이동수단",
      "교통비",
      "외근 내용",
      "결과 및 성과",
      "작성일",
    ],
    cols: [12, 22, 10, 18, 24, 10, 10, 36, 36, 12],
    rowFor: (a) => [
      formatDate(a.start_date),
      a.location ?? "",
      a.author,
      a.companion.join(", "),
      a.purpose,
      transportLabel(a.transport_type),
      a.transport_cost ?? "",
      a.content,
      a.result,
      a.created_at ? a.created_at.slice(0, 10).replaceAll("-", ".") : "",
    ],
  },
  business_trip: {
    name: "출장",
    headers: [
      "기간",
      "출장지",
      "작성자",
      "동행자",
      "출장 목적",
      "이동수단",
      "교통비",
      "숙박",
      "숙박비",
      "출장 내용",
      "결과 및 성과",
      "작성일",
    ],
    cols: [22, 22, 10, 18, 24, 10, 10, 8, 10, 36, 36, 12],
    rowFor: (a) => [
      formatRange(a.start_date, a.end_date),
      a.location ?? "",
      a.author,
      a.companion.join(", "),
      a.purpose,
      transportLabel(a.transport_type),
      a.transport_cost ?? "",
      a.accommodation ? "있음" : "",
      a.accommodation_cost ?? "",
      a.content,
      a.result,
      a.created_at ? a.created_at.slice(0, 10).replaceAll("-", ".") : "",
    ],
  },
  domestic_training: {
    name: "국내연수",
    headers: [
      "기간",
      "연수 기관",
      "연수 장소",
      "과정명",
      "작성자",
      "동행자",
      "연수 목적",
      "교통비",
      "연수비",
      "연수 내용",
      "결과 및 성과",
      "작성일",
    ],
    cols: [22, 22, 22, 22, 10, 18, 24, 10, 10, 36, 36, 12],
    rowFor: (a) => [
      formatRange(a.start_date, a.end_date),
      a.organization ?? "",
      a.location ?? "",
      a.course_name ?? "",
      a.author,
      a.companion.join(", "),
      a.purpose,
      a.transport_cost ?? "",
      a.training_cost ?? "",
      a.content,
      a.result,
      a.created_at ? a.created_at.slice(0, 10).replaceAll("-", ".") : "",
    ],
  },
  overseas_training: {
    name: "해외연수",
    headers: [
      "출국/귀국일",
      "국가",
      "도시",
      "연수 기관",
      "과정명",
      "작성자",
      "동행자",
      "연수 목적",
      "비자 정보",
      "교통비",
      "숙박비",
      "연수비",
      "연수 내용",
      "결과 및 성과",
      "작성일",
    ],
    cols: [22, 14, 14, 22, 22, 10, 18, 24, 16, 10, 10, 10, 36, 36, 12],
    rowFor: (a) => [
      formatRange(a.start_date, a.end_date),
      a.country ?? "",
      a.city ?? "",
      a.organization ?? "",
      a.course_name ?? "",
      a.author,
      a.companion.join(", "),
      a.purpose,
      a.visa_info ?? "",
      a.transport_cost ?? "",
      a.accommodation_cost ?? "",
      a.training_cost ?? "",
      a.content,
      a.result,
      a.created_at ? a.created_at.slice(0, 10).replaceAll("-", ".") : "",
    ],
  },
  education: {
    name: "교육",
    headers: [
      "날짜",
      "장소",
      "작성자",
      "교육 분류",
      "강사",
      "교육 시간",
      "참석자 수",
      "교육 목적",
      "교육 내용",
      "결과 및 성과",
      "작성일",
    ],
    cols: [12, 22, 10, 10, 14, 10, 10, 24, 36, 36, 12],
    rowFor: (a) => [
      formatDate(a.start_date),
      a.location ?? "",
      a.author,
      a.education_type ?? "",
      a.instructor ?? "",
      a.education_hours ?? "",
      a.attendees_count ?? "",
      a.purpose,
      a.content,
      a.result,
      a.created_at ? a.created_at.slice(0, 10).replaceAll("-", ".") : "",
    ],
  },
};

const HEADER_FILL: Record<ActivityKind, string> = {
  outside_work: "DBEAFE", // blue-100
  business_trip: "EDE9FE", // violet-100
  domestic_training: "D1FAE5", // emerald-100
  overseas_training: "CFFAFE", // cyan-100
  education: "FEF3C7", // amber-100
};

export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return new Response("관리자 권한이 필요합니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const monthRaw = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : "";

  const all = await listActivities({ month });

  const wb = XLSX.utils.book_new();

  for (const kind of ACTIVITY_KINDS) {
    const spec = SHEETS[kind];
    const rows = all
      .filter((a) => a.kind === kind)
      .reverse()
      .map(spec.rowFor);
    const aoa = [
      [`${ACTIVITY_LABEL[kind]} 활동`],
      [
        `조회 기간: ${month ? `${month.replace("-", "년 ")}월` : "전체"}`,
        `총 건수: ${rows.length}`,
      ],
      [],
      spec.headers,
      ...rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = spec.cols.map((wch) => ({ wch }));

    // Header cell fill (시트별 색상 구분)
    const headerRowIdx = 3; // 0-based
    for (let c = 0; c < spec.headers.length; c++) {
      const cell = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      if (ws[cell]) {
        // SheetJS community 빌드는 셀 스타일을 무시하지만, 일부 환경에서 적용됨.
        (ws[cell] as { s?: unknown }).s = {
          fill: { patternType: "solid", fgColor: { rgb: HEADER_FILL[kind] } },
          font: { bold: true },
          alignment: { horizontal: "center", vertical: "center" },
        };
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, spec.name);
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const monthLabel = month
    ? `${month.slice(0, 4)}년${Number(month.slice(5, 7))}월`
    : "전체";
  const filename = `활동일지_${monthLabel}.xlsx`;

  return new Response(arrayBuffer, {
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
