import {
  buildAgreementExport,
  buildAwardExport,
  inYearRange,
  orgExportFilename,
  type OrgRecordKind,
} from "@/lib/orgRecords";
import { loadOrgAgreements, loadOrgAwards, resolveOrgRecordAccess } from "@/lib/orgRecordsServer";
import { buildOrgRecordsPdf } from "@/lib/orgRecordsPdf";
import { buildOrgRecordsDocx } from "@/lib/orgRecordsDocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 기관 대장 출력 — ?kind=agreements|awards&format=pdf|docx&from=YYYY&to=YYYY&mask=1
//   mask=1 은 수상 출력에서 청소년 수상자 이름을 "***" 로 가립니다(행감 제출용).
export async function GET(request: Request) {
  const ctx = await resolveOrgRecordAccess();
  if (!ctx) return new Response("기관 대장 접근 권한이 없습니다.", { status: 403 });

  const url = new URL(request.url);
  const kind: OrgRecordKind = url.searchParams.get("kind") === "awards" ? "awards" : "agreements";
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const year = (k: string) => {
    const n = Number(url.searchParams.get(k));
    return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null;
  };
  let from = year("from");
  let to = year("to");
  if (from != null && to != null && from > to) [from, to] = [to, from];

  const table =
    kind === "agreements"
      ? buildAgreementExport((await loadOrgAgreements(null)).filter((r) => inYearRange(r.agreed_on, from, to)))
      : buildAwardExport(
          (await loadOrgAwards(null)).filter((r) => inYearRange(r.awarded_on, from, to)),
          url.searchParams.get("mask") === "1",
        );

  const filename = orgExportFilename(kind, from, to, format);
  const body =
    format === "pdf" ? Buffer.from(await buildOrgRecordsPdf(table)) : new Uint8Array(await buildOrgRecordsDocx(table));
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
