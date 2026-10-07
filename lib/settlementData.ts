import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SettlementProgramDetail } from "@/lib/settlement";

// =====================================================================
// 강사비 정산 조회 — 화면(settlementActions)과 MCP 가 같은 쿼리를 씁니다.
//   * 권한 확인은 호출부 책임입니다. 화면은 requireSaemAccess() 뒤에,
//     MCP 는 토큰 확인 뒤에 이 함수를 부릅니다.
//   * 강사 개인정보(이름·연락처·계좌·주민번호)는 여기서 읽지 않습니다.
//     화면이 필요하면 settlementActions 가 따로 붙입니다.
// =====================================================================

const PROJ = "saem_projects";
const SETT = "saem_settlements";
const ITEM = "saem_settlement_items";

export type SettlementStatus = "draft" | "confirmed";

export type SettlementListRow = {
  id: string;
  projectName: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  status: SettlementStatus;
  instructorCount: number;
  totalNet: number;
};

export async function loadSettlementList(): Promise<SettlementListRow[]> {
  const { data: setts } = await supabaseAdmin
    .from(SETT)
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (setts ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];

  const projIds = [...new Set(rows.map((r) => String(r.project_id)))];
  const { data: projs } = await supabaseAdmin
    .from(PROJ)
    .select("id, name")
    .in("id", projIds);
  const projName = new Map(
    (projs ?? []).map((p) => [
      String((p as { id: string }).id),
      String((p as { name: string }).name ?? ""),
    ])
  );

  const settIds = rows.map((r) => String(r.id));
  const { data: items } = await supabaseAdmin
    .from(ITEM)
    .select("settlement_id, net_amount")
    .in("settlement_id", settIds);
  const agg = new Map<string, { count: number; net: number }>();
  for (const it of items ?? []) {
    const sid = String((it as { settlement_id: string }).settlement_id);
    const a = agg.get(sid) ?? { count: 0, net: 0 };
    a.count += 1;
    a.net += Number((it as { net_amount: number }).net_amount ?? 0);
    agg.set(sid, a);
  }

  return rows.map((r) => {
    const id = String(r.id);
    const a = agg.get(id) ?? { count: 0, net: 0 };
    return {
      id,
      projectName: projName.get(String(r.project_id)) ?? "",
      title: String(r.title ?? ""),
      period_start: (r.period_start as string | null) ?? null,
      period_end: (r.period_end as string | null) ?? null,
      status: r.status === "confirmed" ? "confirmed" : "draft",
      instructorCount: a.count,
      totalNet: a.net,
    };
  });
}

export function parseSettlementDetail(v: unknown): SettlementProgramDetail[] {
  if (Array.isArray(v)) return v as SettlementProgramDetail[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as SettlementProgramDetail[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// 정산 1건 — 머리(사업·제목·기간·상태)와 강사별 금액 행(이름 없이 id 만).
export type SettlementCoreItem = {
  instructor_id: string;
  detail: SettlementProgramDetail[];
  gross_amount: number;
  deduction_rate: number;
  deduction_amount: number;
  net_amount: number;
  adjusted: boolean;
};
export type SettlementCore = {
  id: string;
  projectName: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  status: SettlementStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  items: SettlementCoreItem[];
};

export async function loadSettlementCore(
  id: string
): Promise<SettlementCore | null> {
  if (!id) return null;
  const { data: sett } = await supabaseAdmin
    .from(SETT)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!sett) return null;
  const r = sett as Record<string, unknown>;

  const { data: proj } = await supabaseAdmin
    .from(PROJ)
    .select("name")
    .eq("id", String(r.project_id))
    .maybeSingle();

  const { data: itemRows } = await supabaseAdmin
    .from(ITEM)
    .select("*")
    .eq("settlement_id", id);
  const items = ((itemRows ?? []) as Record<string, unknown>[]).map((it) => {
    const detail = parseSettlementDetail(it.detail);
    return {
      instructor_id: String(it.instructor_id),
      detail,
      gross_amount: Number(it.gross_amount ?? 0),
      deduction_rate: Number(it.deduction_rate ?? 0),
      deduction_amount: Number(it.deduction_amount ?? 0),
      net_amount: Number(it.net_amount ?? 0),
      // adjusted 컬럼이 없던 시기 대비 — detail 로도 판정한다.
      adjusted: it.adjusted === true || detail.some((d) => d.adjusted === true),
    };
  });

  return {
    id: String(r.id),
    projectName: (proj as { name?: string } | null)?.name ?? "",
    title: String(r.title ?? ""),
    period_start: (r.period_start as string | null) ?? null,
    period_end: (r.period_end as string | null) ?? null,
    status: r.status === "confirmed" ? "confirmed" : "draft",
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    confirmed_by: (r.confirmed_by as string | null) ?? null,
    items,
  };
}

// 재원 — 정산 제목에 적힌 구분(예: "3차시 강사비(보조금)"). 제목에 없으면 미분류.
export type SettlementFunding = "보조금" | "운영비" | "미분류";
export function settlementFunding(title: string): SettlementFunding {
  if (title.includes("보조금")) return "보조금";
  if (title.includes("운영비")) return "운영비";
  return "미분류";
}
