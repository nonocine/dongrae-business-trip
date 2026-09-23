import { requireMutualManage } from "@/lib/mutualAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildMutualYearWorkbook } from "@/lib/mutualExport";
import { normalizeKind, sumEntries, normalizeMemberStatus } from "@/lib/mutual";

// exceljs 는 Node 런타임. 라우트는 레이아웃 가드 밖 → 자체 재검증.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /hr/mutual/excel?year=2025
export async function GET(req: Request) {
  try {
    await requireMutualManage();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }

  const year = Number(new URL(req.url).searchParams.get("year"));
  if (!Number.isFinite(year) || year <= 1900)
    return new Response("연도가 올바르지 않습니다.", { status: 400 });

  const [{ data: rows }, { data: before }, { data: mems }] = await Promise.all([
    supabaseAdmin
      .from("mutual_ledger")
      .select("entry_date, kind, description, amount")
      .gte("entry_date", `${year}-01-01`)
      .lte("entry_date", `${year}-12-31`)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("mutual_ledger")
      .select("entry_date, kind, amount")
      .lt("entry_date", `${year}-01-01`),
    supabaseAdmin.from("mutual_members").select("employee_id, status, left_on"),
  ]);

  const entries = (rows ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      entry_date: String(x.entry_date ?? ""),
      kind: normalizeKind(x.kind),
      description: String(x.description ?? ""),
      amount: Math.round(Number(x.amount) || 0),
    };
  });
  if (entries.length === 0)
    return new Response(`${year}년 장부에 기입된 내역이 없습니다.`, { status: 404 });

  const carryOver = sumEntries(
    (before ?? []).map((r) => {
      const x = r as Record<string, unknown>;
      return {
        entry_date: String(x.entry_date ?? ""),
        kind: normalizeKind(x.kind),
        amount: Math.round(Number(x.amount) || 0),
      };
    })
  ).net;
  const totals = sumEntries(entries);

  // 회원명단 — 이름·생일·입사일은 인사기록에서 가져온다(상조회에 중복 저장 안 함).
  const memberRows = (mems ?? []).map((m) => m as Record<string, unknown>);
  const ids = memberRows.map((m) => String(m.employee_id ?? ""));
  const [{ data: drivers }, { data: profs }] = await Promise.all([
    ids.length
      ? supabaseAdmin.from("drivers").select("id, name").in("id", ids)
      : Promise.resolve({ data: [] as unknown[] }),
    ids.length
      ? supabaseAdmin
          .from("employee_profiles")
          .select("driver_id, birth_date, join_date")
          .in("driver_id", ids)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const nameById = new Map(
    (drivers ?? []).map((d) => [
      String((d as { id: string }).id),
      String((d as { name: string }).name ?? ""),
    ])
  );
  const profById = new Map(
    (profs ?? []).map((p) => {
      const x = p as Record<string, unknown>;
      return [
        String(x.driver_id ?? ""),
        {
          birthDate: (x.birth_date as string | null) ?? null,
          joinDate: (x.join_date as string | null) ?? null,
        },
      ];
    })
  );
  const all = memberRows.map((m) => {
    const id = String(m.employee_id ?? "");
    const prof = profById.get(id);
    return {
      name: nameById.get(id) ?? "(삭제된 직원)",
      birthDate: prof?.birthDate ?? null,
      joinDate: prof?.joinDate ?? null,
      leftOn: (m.left_on as string | null) ?? null,
      status: normalizeMemberStatus(m.status),
    };
  });
  const members = all
    .filter((m) => m.status !== "left")
    .sort((a, b) => (a.joinDate ?? "").localeCompare(b.joinDate ?? ""));
  const leftMembers = all
    .filter((m) => m.status === "left")
    .sort((a, b) => (a.leftOn ?? "").localeCompare(b.leftOn ?? ""));

  const buffer = await buildMutualYearWorkbook({
    year,
    orgName: "동래구청소년수련관",
    incomes: entries.filter((e) => e.kind === "income"),
    expenses: entries.filter((e) => e.kind === "expense"),
    carryOver,
    balance: carryOver + totals.net,
    members,
    leftMembers,
  });

  const filename = `상조회비_지출현황_${year}.xlsx`;
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
