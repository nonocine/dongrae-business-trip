import { requireFacilityAccess } from "@/lib/facilityAccess";
import { listAssets } from "@/app/hr/facility/actions";
import { buildFacilityAssetsWorkbook } from "@/lib/facilityLedger";
import { kstTodayYmd } from "@/lib/trainings";
import type {
  AssetFilters,
  AssetStatus,
  AcquisitionType,
} from "@/lib/facility";

// exceljs 는 Node 런타임 필요. 대장은 매 요청 최신값으로.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 권한 — 라우트는 layout 가드를 거치지 않으므로 여기서 반드시 재검증.
  try {
    await requireFacilityAccess();
  } catch {
    return new Response("시설관리 권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const p = url.searchParams;

  // 화면 필터를 쿼리로 받아 서버에서 동일 적용(단일 출처 listAssets).
  const yearRaw = p.get("year");
  const statusRaw = (p.get("status") ?? "all") as AssetStatus;
  const acqRaw = p.get("acq");
  const filters: AssetFilters = {
    year: yearRaw && yearRaw !== "all" ? Number(yearRaw) : "all",
    location: p.get("location") || "all",
    budget_source: p.get("budget") || "all",
    acquisition_type:
      acqRaw === "구매" || acqRaw === "관리전환"
        ? (acqRaw as AcquisitionType)
        : "all",
    status: ["all", "active", "disposed"].includes(statusRaw)
      ? statusRaw
      : "all",
    q: p.get("q") || "",
  };

  const assets = await listAssets(filters);

  const today = kstTodayYmd();
  // 필터가 걸려 있으면 제목에 표기(검수/구분용).
  const parts: string[] = [];
  if (filters.year && filters.year !== "all") parts.push(`${filters.year}년`);
  if (filters.location && filters.location !== "all") parts.push(String(filters.location));
  if (filters.budget_source && filters.budget_source !== "all")
    parts.push(String(filters.budget_source));
  if (filters.acquisition_type && filters.acquisition_type !== "all")
    parts.push(String(filters.acquisition_type));
  if (filters.status === "active") parts.push("사용중");
  else if (filters.status === "disposed") parts.push("불용");
  const suffix = parts.length ? ` (${parts.join(" · ")})` : "";
  const title = `동래구청소년센터 비품대장${suffix} — ${today}`;

  const buffer = await buildFacilityAssetsWorkbook({ title, assets });

  const filename = `비품대장_${today}.xlsx`;
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
