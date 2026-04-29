import * as XLSX from "xlsx";
import { isAdmin, listDrivingLogs } from "@/app/actions";
import { VEHICLE } from "@/lib/vehicle";

export const dynamic = "force-dynamic";

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day}`;
}

export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return new Response("관리자 권한이 필요합니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const monthRaw = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : "";

  const logs = await listDrivingLogs(month);
  // 양식과 동일하도록 일자 오름차순으로 정렬해 출력
  const rows = [...logs].reverse();

  const totalDistance = rows.reduce((s, r) => s + Number(r.distance), 0);

  const headerRows: (string | number)[][] = [
    [`${VEHICLE.centerName} 차량 운행일지`],
    [
      `차종: ${VEHICLE.model}`,
      `차량번호: ${VEHICLE.plate}`,
      `보험사: ${VEHICLE.insurer} (${VEHICLE.insurerPhone})`,
    ],
    [
      `조회 기간: ${month ? `${month.replace("-", "년 ")}월` : "전체"}`,
      `총 건수: ${rows.length}`,
      `총 운행거리: ${totalDistance.toFixed(1)} km`,
    ],
    [],
    [
      "운행일자",
      "운전자",
      "용무",
      "출발지",
      "목적지",
      "도착지",
      "운행거리(km)",
      "누적거리(km)",
      "확인/결재",
    ],
  ];

  const dataRows = rows.map((r) => [
    formatDate(r.driven_at),
    r.driver,
    r.purpose,
    VEHICLE.centerName,
    r.waypoint ?? "",
    VEHICLE.centerName,
    Number(r.distance),
    Number(r.total_distance),
    r.confirmed_by,
  ]);

  const aoa = [...headerRows, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 컬럼 폭
  ws["!cols"] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 24 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
  ];

  // 상단 타이틀 셀 병합
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 1, c: 3 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 6 }, e: { r: 1, c: 8 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
    { s: { r: 2, c: 3 }, e: { r: 2, c: 5 } },
    { s: { r: 2, c: 6 }, e: { r: 2, c: 8 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "운행일지");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const fileSuffix = month ? month : "전체";
  const filename = `동래구청소년센터_운행일지_${fileSuffix}.xlsx`;

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
