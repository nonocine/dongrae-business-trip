"use server";

// =====================================================================
// 강사비 지출표 — 조회 전용 서버 액션.
//
//   * 읽는 테이블: saem_settlements / saem_settlement_items / saem_projects /
//     saem_instructors. 전부 RLS 0개라 service_role 경유 — 이 파일의 게이트가
//     유일한 방어선입니다.
//   * 권한: M0 또는 accounting(회계) 직무. 급여 모듈과 같은 게이트를 씁니다
//     (lib/salaryAccess.ts). 계좌번호와 지급 금액이 나오는 화면이라,
//     f44f0ef 에서 연 강사관리 '열람'(resolveSaemView) 수준으로는 열지 않습니다.
//   * 쓰기 없음 — 정산 생성·확정·재계산 흐름은 건드리지 않습니다.
//   * 금액은 저장된 값을 그대로 읽습니다. 다시 계산하지 않습니다.
//   * 주민번호는 rrn_mask 만 읽습니다. rrn_enc 는 '등록 여부' 판정에만 쓰고
//     값을 밖으로 내보내지 않습니다(복호화하지 않습니다).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSalaryAccess } from "@/lib/salaryAccess";
import { kstTodayYmd } from "@/lib/trainings";
import {
  payoutBlockers,
  filterPayoutRows,
  monthRange,
  type PayoutRow,
  type PayoutStatus,
  type PayoutFilters,
} from "@/lib/instructorPayout";

const SETT = "saem_settlements";
const ITEM = "saem_settlement_items";
const PROJ = "saem_projects";
const INSTR = "saem_instructors";

export type PayoutOption = { id: string; label: string };

export type PayoutData = {
  rows: PayoutRow[];
  projects: PayoutOption[];
  settlements: PayoutOption[]; // 기간·사업 필터를 적용하기 전의 전체 목록
  today: string;
  defaultRange: { from: string; to: string };
};

function statusOf(v: unknown): PayoutStatus {
  return v === "confirmed" ? "confirmed" : "draft";
}

// 전체 줄을 한 번에 읽어 옵니다. 정산 4건·항목 17건 규모라 페이지 루프가
//   필요 없지만, 1,000행 상한(lib 메모)에 걸리면 조용히 잘리므로 건수를
//   확인할 수 있게 한 번에 읽고 길이를 그대로 씁니다.
async function loadAllRows(): Promise<PayoutRow[]> {
  const [{ data: setts }, { data: items }] = await Promise.all([
    supabaseAdmin
      .from(SETT)
      .select("id, project_id, title, period_start, period_end, status"),
    supabaseAdmin
      .from(ITEM)
      .select(
        "settlement_id, instructor_id, gross_amount, deduction_rate, deduction_amount, net_amount, adjusted, detail"
      ),
  ]);

  const settRows = (setts ?? []) as Record<string, unknown>[];
  const itemRows = (items ?? []) as Record<string, unknown>[];
  if (!settRows.length || !itemRows.length) return [];

  const projIds = [...new Set(settRows.map((s) => String(s.project_id)))];
  const insIds = [...new Set(itemRows.map((i) => String(i.instructor_id)))];

  const [{ data: projs }, { data: ins }] = await Promise.all([
    supabaseAdmin.from(PROJ).select("id, name").in("id", projIds),
    supabaseAdmin
      .from(INSTR)
      // rrn_enc 는 값을 쓰지 않고 '있는지' 만 봅니다 — 복호화하지 않습니다.
      .select(
        "id, name, bank_name, bank_account, account_holder, rrn_mask, rrn_enc"
      )
      .in("id", insIds),
  ]);

  const projName = new Map(
    (projs ?? []).map((p) => {
      const o = p as Record<string, unknown>;
      return [String(o.id), String(o.name ?? "")];
    })
  );
  const insById = new Map(
    (ins ?? []).map((i) => {
      const o = i as Record<string, unknown>;
      return [String(o.id), o];
    })
  );
  const settById = new Map(settRows.map((s) => [String(s.id), s]));

  const out: PayoutRow[] = [];
  for (const it of itemRows) {
    const sett = settById.get(String(it.settlement_id));
    if (!sett) continue; // 고아 항목 — 정산이 지워진 경우
    const person = insById.get(String(it.instructor_id));
    const status = statusOf(sett.status);
    const bankName = (person?.bank_name as string | null) ?? null;
    const bankAccount = (person?.bank_account as string | null) ?? null;
    const accountHolder = (person?.account_holder as string | null) ?? null;
    const rrnMask = (person?.rrn_mask as string | null) ?? null;
    const hasRrn = Boolean(
      (person?.rrn_enc as string | null)?.trim() || rrnMask?.trim()
    );
    const net = Number(it.net_amount ?? 0);

    // adjusted 컬럼이 없던 시기 대비 — detail 로도 판정합니다
    //   (getSettlement 과 같은 기준).
    const detail = Array.isArray(it.detail)
      ? (it.detail as Record<string, unknown>[])
      : [];
    const adjusted =
      it.adjusted === true || detail.some((d) => d?.adjusted === true);

    out.push({
      key: `${String(it.settlement_id)}|${String(it.instructor_id)}`,
      settlementId: String(it.settlement_id),
      settlementTitle: String(sett.title ?? ""),
      projectId: String(sett.project_id ?? ""),
      projectName: projName.get(String(sett.project_id)) ?? "",
      periodStart: (sett.period_start as string | null) ?? null,
      periodEnd: (sett.period_end as string | null) ?? null,
      status,
      instructorId: String(it.instructor_id),
      name: String(person?.name ?? "(이름 없음)"),
      bankName,
      bankAccount,
      accountHolder,
      rrnMask,
      hasRrn,
      gross: Number(it.gross_amount ?? 0),
      deductionRate: Number(it.deduction_rate ?? 0),
      deduction: Number(it.deduction_amount ?? 0),
      net,
      adjusted,
      blockers: payoutBlockers({
        bankName,
        bankAccount,
        accountHolder,
        hasRrn,
        net,
        status,
      }),
    });
  }
  return out;
}

// 화면 진입용 — 전체 줄 + 필터 옵션을 한 번에 내려보냅니다.
//   줄 수가 정산 항목 수(17건 규모)라 전부 내려도 가볍고, 기간·사업을
//   바꿀 때마다 서버를 다시 때리지 않아 회계 담당의 조작이 즉시 반응합니다.
export async function getPayoutData(): Promise<PayoutData> {
  await requireSalaryAccess();
  const rows = await loadAllRows();
  const today = kstTodayYmd();

  const projects = [
    ...new Map(rows.map((r) => [r.projectId, r.projectName])).entries(),
  ]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  // 재원 목록은 기간 늦은 순 — 최근 것이 위로.
  const settlements = [
    ...new Map(
      rows.map((r) => [
        r.settlementId,
        {
          label: `${r.settlementTitle}${
            r.periodStart ? ` (${r.periodStart} ~ ${r.periodEnd ?? ""})` : ""
          }`,
          sort: r.periodEnd ?? r.periodStart ?? "",
        },
      ])
    ).entries(),
  ]
    .map(([id, v]) => ({ id, label: v.label, sort: v.sort }))
    .sort((a, b) => b.sort.localeCompare(a.sort))
    .map(({ id, label }) => ({ id, label }));

  return {
    rows,
    projects,
    settlements,
    today,
    defaultRange: monthRange(today.slice(0, 7)),
  };
}

// 엑셀 라우트 전용 — 라우트는 레이아웃 가드 밖이라 자체적으로 권한을
//   재검증한 뒤 이 함수를 부릅니다(요청마다 다시 읽습니다).
export async function getPayoutRowsFor(f: PayoutFilters): Promise<PayoutRow[]> {
  await requireSalaryAccess();
  return filterPayoutRows(await loadAllRows(), f);
}
