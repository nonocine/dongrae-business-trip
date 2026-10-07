import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { kstTodayYmd } from "@/lib/trainings";
import {
  trainingStatsByTraining,
  trainingStatsByEmployee,
  cellKey,
} from "@/lib/trainings";
import {
  loadSettlementList,
  loadSettlementCore,
  settlementFunding,
  type SettlementListRow,
} from "@/lib/settlementData";
import { loadPayrollRecords } from "@/lib/payrollData";
import {
  loadClubBudgetSummaries,
  loadClubExpensesInRange,
} from "@/lib/clubData";
import { loadAllAssets } from "@/lib/facilityData";
import { loadMailStats, loadMailStatusCounts } from "@/lib/mailStats";
import { MAIL_CATEGORY_INDEX } from "@/lib/mail";
import { fetchAllRentalsInMonth, summarizeRentals } from "@/lib/rentalData";
import { rentalFacility, type RentalRow, type RentalSummary } from "@/lib/rental";
import { loadTrainingMatrix, loadTrainingYears } from "@/lib/trainingMatrix";
import { loadBusinessResultRows } from "@/lib/businessResultsData";
import { calculateBusinessReportTotals } from "@/lib/businessResultsExport";
import { listSummaries } from "@/lib/contractServer";
import { contractStateLabel, type ContractSummary } from "@/lib/contractCore";

// =====================================================================
// 동업자씨 MCP 도구(읽기 전용) — Claude 커스텀 커넥터용.
//   * 데이터는 화면과 같은 lib 로더로만 읽습니다(새 쿼리 없음 — 메일 상태별
//     건수 loadMailStatusCounts 만 MCP 전용 count 쿼리).
//   * 응답은 사람이 읽는 요약 텍스트입니다. 금액은 천 단위 쉼표 + 기간 표기.
//   * ⚠️ 절대 내보내지 않는 것: 주민번호·계좌·개인별 급여/연봉·연봉계약서 내용·
//     인사평가·징계·경위서·강사 개인정보(이름 포함)·메일 본문/제목/보낸사람.
//     강사비는 재원·사업 단위 합계까지만, 급여는 월 합계까지만 냅니다.
//   * 쓰기 도구는 없습니다.
// =====================================================================

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

// 실패는 조용히 넘기지 않고 사유를 돌려줍니다.
async function run(name: string, fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: `[${name}] 조회 실패: ${msg}` }],
      isError: true,
    };
  }
}

// --- 서식 ------------------------------------------------------------
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const num = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "-";

function kstDateTime(iso: string | null): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// --- 기간 ------------------------------------------------------------
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 기간 [from, to] 이 걸치는 (연, 월) 목록.
function monthsBetween(from: string, to: string): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function resolveRange(from?: string, to?: string): { from: string; to: string } {
  const today = kstTodayYmd();
  const f = from && YMD.test(from) ? from : `${today.slice(0, 4)}-01-01`;
  const t = to && YMD.test(to) ? to : today;
  if (f > t) throw new Error(`기간이 거꾸로입니다: ${f} ~ ${t}`);
  if (monthsBetween(f, t).length > 36) throw new Error("기간은 최대 36개월까지 조회합니다.");
  return { from: f, to: t };
}

// 정산 기간이 조회 기간과 겹치는지. 기간이 비어 있는 정산은 포함하지 않고 따로 셉니다.
function settlementOverlaps(s: SettlementListRow, from: string, to: string): boolean | null {
  const a = s.period_start ?? s.period_end;
  const b = s.period_end ?? s.period_start;
  if (!a || !b) return null;
  return a <= to && b >= from;
}

const isTestTitle = (title: string) => title.includes("테스트");

// =====================================================================
// 1. spending_overview
// =====================================================================
async function spendingOverview(from: string, to: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`■ 지출 현황 (${from} ~ ${to})`);
  lines.push("");

  // --- 강사비 정산 ---
  const list = await loadSettlementList();
  const inRange: SettlementListRow[] = [];
  let noPeriod = 0;
  for (const s of list) {
    const o = settlementOverlaps(s, from, to);
    if (o === null) noPeriod += 1;
    else if (o) inRange.push(s);
  }
  const cores = await Promise.all(inRange.map((s) => loadSettlementCore(s.id)));
  const byFunding = new Map<string, { gross: number; ded: number; net: number; n: number }>();
  const byProject = new Map<string, { gross: number; n: number }>();
  let sGross = 0;
  let sDed = 0;
  let sNet = 0;
  let draftCount = 0;
  const testOnes: { title: string; gross: number }[] = [];
  for (const c of cores) {
    if (!c) continue;
    const gross = c.items.reduce((a, it) => a + it.gross_amount, 0);
    const ded = c.items.reduce((a, it) => a + it.deduction_amount, 0);
    const net = c.items.reduce((a, it) => a + it.net_amount, 0);
    sGross += gross;
    sDed += ded;
    sNet += net;
    if (c.status !== "confirmed") draftCount += 1;
    const f = byFunding.get(settlementFunding(c.title)) ?? { gross: 0, ded: 0, net: 0, n: 0 };
    f.gross += gross;
    f.ded += ded;
    f.net += net;
    f.n += 1;
    byFunding.set(settlementFunding(c.title), f);
    const p = byProject.get(c.projectName || "(사업 미지정)") ?? { gross: 0, n: 0 };
    p.gross += gross;
    p.n += 1;
    byProject.set(c.projectName || "(사업 미지정)", p);
    if (isTestTitle(c.title)) testOnes.push({ title: c.title, gross });
  }
  lines.push(`[1] 강사비 정산 — 총지급 ${won(sGross)} (공제 ${won(sDed)} / 실지급 ${won(sNet)})`);
  if (inRange.length === 0) {
    lines.push("  · 해당 기간 내역 없음");
  } else {
    lines.push(`  · 정산 ${inRange.length}건 (정산 기간이 조회 기간과 겹치는 건 기준${draftCount ? `, 미확정 ${draftCount}건 포함` : ""})`);
    lines.push("  · 재원별:");
    for (const [k, v] of byFunding)
      lines.push(`    - ${k}: 총지급 ${won(v.gross)} / 공제 ${won(v.ded)} / 실지급 ${won(v.net)} (${v.n}건)`);
    lines.push("  · 사업별:");
    for (const [k, v] of byProject) lines.push(`    - ${k}: 총지급 ${won(v.gross)} (${v.n}건)`);
    if (testOnes.length)
      lines.push(
        `  ※ 테스트용 포함: 제목에 '테스트'가 들어간 정산 ${testOnes.length}건(총지급 ${won(
          testOnes.reduce((a, t) => a + t.gross, 0)
        )})이 위 합계에 들어 있습니다. 거르지 않았습니다 — 삭제 여부는 화면에서 판단하세요.`
      );
  }
  if (noPeriod) lines.push(`  ※ 정산 기간이 비어 있어 기간 판정을 못 한 정산 ${noPeriod}건은 제외했습니다.`);
  lines.push("");

  // --- 급여(월 합계만) ---
  const months = monthsBetween(from, to);
  const payroll = await Promise.all(
    months.map(async ({ year, month }) => {
      const recs = await loadPayrollRecords(year, month);
      return {
        year,
        month,
        n: recs.length,
        pay: recs.reduce((a, r) => a + r.total_pay, 0),
        deduct: recs.reduce((a, r) => a + r.total_deduct, 0),
        net: recs.reduce((a, r) => a + r.net_pay, 0),
        confirmed: recs.length > 0 && recs.every((r) => !!r.confirmed_at),
      };
    })
  );
  const payTotal = payroll.reduce((a, p) => a + p.pay, 0);
  lines.push(`[2] 급여 — 지급총액 ${won(payTotal)} (월 합계 기준, 개인별 금액은 내보내지 않음)`);
  const payMonths = payroll.filter((p) => p.n > 0);
  if (payMonths.length === 0) lines.push("  · 해당 기간 내역 없음");
  for (const p of payMonths) {
    lines.push(
      `  · ${p.year}년 ${p.month}월: 지급 ${won(p.pay)} / 공제 ${won(p.deduct)} / 실지급 ${won(p.net)} — ${p.n}명, ${p.confirmed ? "확정" : "미확정 포함"}`
    );
  }
  const empty = payroll.filter((p) => p.n === 0).map((p) => `${p.year}.${p.month}`);
  if (payMonths.length > 0 && empty.length > 0)
    lines.push(`  · 급여 레코드 없는 달: ${empty.join(", ")}`);
  if (from.slice(8) !== "01" || nextDay(to).slice(8) !== "01")
    lines.push("  ※ 급여는 월 단위라, 기간이 걸친 달은 한 달 전체를 셉니다.");
  lines.push("");

  // --- 동아리 예산 ---
  const club = await loadClubExpensesInRange(from, nextDay(to));
  lines.push(`[3] 동아리 활동비 — 기간 내 집행 ${won(club.total)}`);
  if (club.total === 0 && club.byClub.size === 0) {
    lines.push("  · 해당 기간 집행 내역 없음");
  } else {
    lines.push("  · 재원별: " + [...club.byFunding].map(([k, v]) => `${k} ${won(v)}`).join(", "));
    for (const c of [...club.byClub.values()].sort((a, b) => b.amount - a.amount))
      lines.push(`    - ${c.name}: ${won(c.amount)}`);
  }
  const years = [...new Set(months.map((m) => m.year))];
  for (const y of years) {
    const sums = await loadClubBudgetSummaries(y);
    const plan = sums.reduce((a, s) => a + s.planTotal, 0);
    const spent = sums.reduce((a, s) => a + s.expenseTotal, 0);
    lines.push(
      `  · ${y}년 연간 계획 ${won(plan)} 대비 집행 ${won(spent)} (집행률 ${pct(spent, plan)}, 잔액 ${won(plan - spent)}) — 동아리별은 club_budget 도구`
    );
  }
  lines.push("");

  // --- 비품 구매 ---
  const assets = (await loadAllAssets()).filter(
    (a) => !!a.acquired_on && a.acquired_on >= from && a.acquired_on <= to
  );
  const bought = assets.filter((a) => a.acquisition_type === "구매");
  const transferred = assets.length - bought.length;
  const assetTotal = bought.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  lines.push(`[4] 비품 구매 — ${won(assetTotal)} (${bought.length}건, 취득일 기준)`);
  if (bought.length === 0) lines.push("  · 해당 기간 내역 없음");
  else {
    const bySrc = new Map<string, { amount: number; n: number }>();
    for (const a of bought) {
      const k = a.budget_source || "예산출처 미기재";
      const v = bySrc.get(k) ?? { amount: 0, n: 0 };
      v.amount += Number(a.amount) || 0;
      v.n += 1;
      bySrc.set(k, v);
    }
    lines.push("  · 예산출처별: " + [...bySrc].map(([k, v]) => `${k} ${won(v.amount)}(${v.n}건)`).join(", "));
  }
  if (transferred) lines.push(`  ※ 관리전환 ${transferred}건은 구매가 아니라 합계에서 뺐습니다.`);
  lines.push("  ※ 비품 대장에는 거래처 정보가 없습니다.");
  lines.push("");

  const total = sGross + payTotal + club.total + assetTotal;
  lines.push(`■ 전체 지출 합계: ${won(total)} (${from} ~ ${to})`);
  lines.push(
    `  = 강사비 ${won(sGross)} + 급여 ${won(payTotal)} + 동아리 ${won(club.total)} + 비품 ${won(assetTotal)}`
  );
  lines.push("  ※ 시스템에 기록된 지출만 모은 것입니다(ERP 회계 전체가 아님).");
  return lines.join("\n");
}

// =====================================================================
// 2. settlement_detail
// =====================================================================
async function settlementDetail(id?: string, query?: string): Promise<string> {
  const list = await loadSettlementList();
  if (!id) {
    const q = (query ?? "").trim();
    const rows = q ? list.filter((s) => s.title.includes(q) || s.projectName.includes(q)) : list;
    if (rows.length === 0) return q ? `'${q}'에 맞는 정산이 없습니다.` : "등록된 정산이 없습니다.";
    const out = [`■ 강사비 정산 목록 (${rows.length}건) — 상세는 settlement_id 로 다시 호출`];
    for (const s of rows)
      out.push(
        `  · ${s.title} [${s.projectName}] ${s.period_start ?? "?"} ~ ${s.period_end ?? "?"} / ${s.status === "confirmed" ? "확정" : "작성 중"} / ${s.instructorCount}명 / 실지급 ${won(s.totalNet)} / id=${s.id}${isTestTitle(s.title) ? " (테스트용)" : ""}`
      );
    return out.join("\n");
  }
  const c = await loadSettlementCore(id);
  if (!c) return `정산을 찾을 수 없습니다 (id=${id}). settlement_id 없이 호출하면 목록을 볼 수 있습니다.`;
  const gross = c.items.reduce((a, it) => a + it.gross_amount, 0);
  const ded = c.items.reduce((a, it) => a + it.deduction_amount, 0);
  const net = c.items.reduce((a, it) => a + it.net_amount, 0);
  const programs = new Set(c.items.flatMap((it) => it.detail.map((d) => d.program_id ?? d.program_name)));
  const adjusted = c.items.reduce((n, it) => n + it.detail.filter((d) => d.adjusted === true).length, 0);
  return [
    `■ 정산: ${c.title}${isTestTitle(c.title) ? " (테스트용)" : ""}`,
    `  · 사업: ${c.projectName || "(미지정)"}`,
    `  · 재원: ${settlementFunding(c.title)} (정산 제목 기준)`,
    `  · 정산 기간: ${c.period_start ?? "?"} ~ ${c.period_end ?? "?"}`,
    `  · 상태: ${c.status === "confirmed" ? `확정 (${kstDateTime(c.confirmed_at)}${c.confirmed_by ? `, ${c.confirmed_by}` : ""})` : "작성 중(미확정)"}`,
    `  · 지급 대상: ${c.items.length}명 / 프로그램 ${programs.size}개${adjusted ? ` / 담당자 조정 ${adjusted}건` : ""}`,
    `  · 총지급 ${won(gross)} / 공제 ${won(ded)} / 실지급 ${won(net)}`,
    "  ※ 강사별 금액·계좌는 이 도구로 내보내지 않습니다. 화면(강사비 정산 상세)에서 확인하세요.",
  ].join("\n");
}

// =====================================================================
// 3. club_budget
// =====================================================================
async function clubBudget(year: number): Promise<string> {
  const rows = await loadClubBudgetSummaries(year);
  if (rows.length === 0) return `${year}년: 운영 중인 동아리가 없습니다.`;
  const plan = rows.reduce((a, r) => a + r.planTotal, 0);
  const spent = rows.reduce((a, r) => a + r.expenseTotal, 0);
  const submitted = rows.filter((r) => r.planSubmittedAt).length;
  const out = [
    `■ ${year}년 동아리 예산 (${year}-01-01 ~ ${year}-12-31, 운영 중 ${rows.length}개)`,
    `  · 전체: 계획 ${won(plan)} / 집행 ${won(spent)} / 집행률 ${pct(spent, plan)} / 잔액 ${won(plan - spent)}`,
    `  · 계획서 제출 ${submitted}개 / 미제출 ${rows.length - submitted}개`,
    "",
  ];
  for (const r of [...rows].sort((a, b) => b.expenseTotal - a.expenseTotal || a.name.localeCompare(b.name, "ko"))) {
    const status = r.planTotal === 0 ? "예산계획 없음" : `집행률 ${pct(r.expenseTotal, r.planTotal)}, 잔액 ${won(r.planTotal - r.expenseTotal)}`;
    const over = r.planTotal > 0 && r.expenseTotal > r.planTotal ? " ⚠ 계획 초과" : "";
    out.push(
      `  · ${r.name}: 계획 ${won(r.planTotal)} / 집행 ${won(r.expenseTotal)} (${status})${over} / 계획서 ${r.planSubmittedAt ? `제출(${kstDateTime(r.planSubmittedAt).slice(0, 12).trim()})` : "미제출"}`
    );
  }
  return out.join("\n");
}

// =====================================================================
// 4. mail_summary
// =====================================================================
async function mailSummary(): Promise<string> {
  const [stats, counts] = await Promise.all([loadMailStats(), loadMailStatusCounts()]);
  const out = [
    `■ 공용 메일함 (조회 시각 ${kstDateTime(new Date().toISOString())})`,
    `  · 전체 ${num(counts.total)}건 (휴지통 제외): 미처리 ${num(counts.unread)} / 처리 중 ${num(counts.processing)} / 완료 ${num(counts.done)}`,
    `  · 아무도 열어보지 않은 메일 ${num(stats.unopenedCount)}건 — 분류별:`,
  ];
  for (const c of MAIL_CATEGORY_INDEX) out.push(`    - ${c}: ${num(stats.categoryUnopened[c] ?? 0)}건`);
  out.push(`  · 마지막 수집(네이버 접속): ${kstDateTime(stats.lastFetchedAt)}${stats.fetchStale ? " ⚠ 수집 지연" : ""}`);
  out.push(`  · 마지막 새 메일 도착: ${kstDateTime(stats.lastMailAt)}`);
  out.push("  ※ 메일 제목·본문·보낸사람은 이 도구로 내보내지 않습니다.");
  return out.join("\n");
}

// =====================================================================
// 5. rental_summary
// =====================================================================
function rentalLine(label: string, s: RentalSummary): string {
  return `${label} 확정 ${num(s.confirmed)}건(이용 ${num(s.personTotal)}명) / 신청 중 ${num(s.pending)} / 취소 ${num(s.cancelled)}`;
}

async function rentalSummary(fromMonth: string, toMonth: string): Promise<string> {
  const months = monthsBetween(`${fromMonth}-01`, `${toMonth}-01`);
  if (months.length > 12) throw new Error("대관 현황은 최대 12개월까지 조회합니다.");
  const out = [`■ 대관예약 현황 (${fromMonth} ~ ${toMonth}, 홈페이지 예약 사본 기준)`];
  const all: RentalRow[] = [];
  for (const { year, month } of months) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const rows = await fetchAllRentalsInMonth(ym, "all");
    all.push(...rows);
    if (rows.length === 0) {
      out.push(`  · ${ym}: 해당 기간 내역 없음`);
      continue;
    }
    const center = rows.filter((r) => rentalFacility(r) !== "onna");
    const onna = rows.filter((r) => rentalFacility(r) === "onna");
    out.push(`  · ${ym}: ${rentalLine("전체", summarizeRentals(rows))}`);
    out.push(`      ${rentalLine("센터", summarizeRentals(center))}`);
    out.push(`      ${rentalLine("온나", summarizeRentals(onna))}`);
    const rental = rows.filter((r) => r.reservation_type === "rental");
    const room = rows.filter((r) => r.reservation_type !== "rental");
    out.push(`      (구분) 시설 대관 확정 ${num(summarizeRentals(rental).confirmed)}건 / 청소년 공간 확정 ${num(summarizeRentals(room).confirmed)}건`);
  }
  if (months.length > 1 && all.length > 0) {
    out.push("");
    out.push(`  · 기간 합계: ${rentalLine("", summarizeRentals(all)).trim()}`);
  }
  out.push("  ※ 건수·인원은 '확정' 기준입니다. 신청자 정보는 내보내지 않습니다.");
  return out.join("\n");
}

// =====================================================================
// 6. training_status
// =====================================================================
async function trainingStatus(yearIn?: number): Promise<string> {
  let year = yearIn;
  if (!year) {
    const thisYear = Number(kstTodayYmd().slice(0, 4));
    const years = await loadTrainingYears();
    year = years.includes(thisYear) ? thisYear : years[0] ?? thisYear;
  }
  const m = await loadTrainingMatrix(year);
  if (m.trainings.length === 0) return `${year}년: 등록된(활성) 의무교육이 없습니다.`;
  const done = new Set(m.completions.map((c) => cellKey(c.training_id, c.driver_id)));
  const targetSets = new Map(Object.entries(m.targets).map(([k, v]) => [k, new Set(v)]));
  const byT = trainingStatsByTraining(m.trainings, m.employees, done, targetSets);
  const byE = trainingStatsByEmployee(m.trainings, m.employees, done, targetSets);

  let cells = 0;
  let notMet = 0;
  for (const s of byT.values()) {
    cells += s.target;
    notMet += s.notMet;
  }
  const out = [
    `■ ${year}년 법정의무교육 이수 현황 (기준일 ${m.today}, 재직 ${m.employees.length}명, 교육 ${m.trainings.length}개)`,
    `  · 전체 이수율 ${pct(cells - notMet, cells)} — 대상 ${num(cells)}건 중 이수 ${num(cells - notMet)} / 미이수 ${num(notMet)}`,
    "",
    "  [교육별]",
  ];
  for (const t of m.trainings) {
    const s = byT.get(t.id) ?? { target: 0, notMet: 0 };
    const due = t.due_date ? ` / 마감 ${t.due_date}${t.dday != null ? (t.dday >= 0 ? ` (D-${t.dday})` : ` (마감 ${-t.dday}일 지남)`) : ""}` : "";
    out.push(
      `  · ${t.name}: 대상 ${s.target}명 / 이수 ${s.target - s.notMet} / 미이수 ${s.notMet} / 이수율 ${pct(s.target - s.notMet, s.target)}${due}`
    );
  }
  out.push("");
  out.push("  [직원별 — 미이수가 있는 사람 먼저]");
  const emps = [...m.employees].sort((a, b) => {
    const sa = byE.get(a.driver_id)!;
    const sb = byE.get(b.driver_id)!;
    return sb.target - sb.done - (sa.target - sa.done) || a.name.localeCompare(b.name, "ko");
  });
  for (const e of emps) {
    const s = byE.get(e.driver_id) ?? { target: 0, done: 0 };
    if (s.target === 0) {
      out.push(`  · ${e.name}: 대상 교육 없음`);
      continue;
    }
    out.push(`  · ${e.name}: ${s.done}/${s.target} 이수${s.target - s.done ? ` (미이수 ${s.target - s.done})` : " ✓"}`);
  }
  return out.join("\n");
}

// =====================================================================
// 7. business_results
// =====================================================================
async function businessResults(year: number, startMonth: number, endMonth: number): Promise<string> {
  const period = startMonth === endMonth ? `${year}년 ${startMonth}월` : `${year}년 ${startMonth}~${endMonth}월`;
  const rows = await loadBusinessResultRows(year, startMonth, endMonth);
  if (!rows.configured) return "사업실적 테이블이 아직 준비되지 않았습니다.";
  if (rows.results.length === 0 && rows.promotions.length === 0) return `${period}: 해당 기간 내역 없음`;

  const totalsOf = (results: typeof rows.results) =>
    calculateBusinessReportTotals({
      year,
      month: endMonth,
      startMonth,
      endMonth,
      orgName: "동래구청소년센터",
      results,
      promotions: [],
    });
  const all = totalsOf(rows.results);
  // 홍보 건수 — 화면(BusinessResultsDashboard)과 같은 count 합.
  const promoTotal = rows.promotions.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  const drafts = rows.results.filter((r) => r.status === "draft").length;
  const out = [
    `■ 사업실적 ${period}`,
    `  · 프로그램 실적 ${rows.results.length}건${drafts ? ` (작성 중 ${drafts}건 포함)` : ""}`,
    `  · 횟수 ${num(all.sessions)}회 / 운영일 ${num(all.operatingDays)}일 / 실인원 ${num(all.participants)}명 / 연인원 ${num(all.attendance)}명`,
    `  · 이용 ${num(all.totalUses)}건 (청소년 ${num(all.youthUses)} / 기타 ${num(all.otherUses)}, 청소년 비율 ${pct(all.youthUses, all.totalUses)})`,
    `  · 홍보 ${num(promoTotal)}건`,
    "",
    "  [분야별]",
  ];
  const cats = new Map<string, typeof rows.results>();
  for (const r of rows.results) cats.set(r.category, [...(cats.get(r.category) ?? []), r]);
  for (const [cat, list] of cats) {
    const t = totalsOf(list);
    out.push(
      `  · ${cat} (${new Set(list.map((r) => r.program_name)).size}개 사업): 횟수 ${num(t.sessions)} / 실인원 ${num(t.participants)} / 연인원 ${num(t.attendance)} / 이용 ${num(t.totalUses)}`
    );
  }
  if (startMonth !== endMonth) {
    out.push("");
    out.push("  [월별]");
    for (let mth = startMonth; mth <= endMonth; mth += 1) {
      const list = rows.results.filter((r) => r.report_month === mth);
      if (list.length === 0) {
        out.push(`  · ${mth}월: 내역 없음`);
        continue;
      }
      const t = totalsOf(list);
      out.push(`  · ${mth}월: ${list.length}건 / 횟수 ${num(t.sessions)} / 실인원 ${num(t.participants)} / 연인원 ${num(t.attendance)}`);
    }
  }
  return out.join("\n");
}

// =====================================================================
// 8. contract_status
// =====================================================================
async function contractStatus(year?: number): Promise<string> {
  const kinds = [
    { kind: "employment" as const, label: "근로계약서" },
    { kind: "salary" as const, label: "연봉계약서" },
  ];
  const out = [`■ 계약서 진행 현황${year ? ` (${year}년)` : " (전체 연도)"}`];
  for (const k of kinds) {
    let rows: ContractSummary[] = await listSummaries(k.kind);
    if (year) rows = rows.filter((r) => r.year === String(year));
    out.push("");
    out.push(`  [${k.label}] ${rows.length}건`);
    if (rows.length === 0) {
      out.push("  · 해당 기간 내역 없음");
      continue;
    }
    const byState = new Map<string, string[]>();
    for (const r of rows) {
      const st = contractStateLabel(r);
      byState.set(st, [...(byState.get(st) ?? []), r.employee_name]);
    }
    for (const [st, names] of byState) {
      const showNames = st !== "체결 완료" && st !== "무효";
      out.push(`  · ${st}: ${names.length}건${showNames ? ` — ${names.join(", ")}` : ""}`);
    }
  }
  out.push("");
  out.push("  ※ 계약 내용·금액은 이 도구로 내보내지 않습니다.");
  return out.join("\n");
}

// =====================================================================
// 등록
// =====================================================================
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export function registerDongraeTools(server: McpServer): void {
  server.registerTool(
    "spending_overview",
    {
      title: "지출 현황(돈 흐름)",
      description:
        "동래구청소년센터 시스템에 기록된 '돈이 나간 기록'을 한 흐름으로 모아 기간별로 보여줍니다. " +
        "강사비 정산(재원: 보조금/운영비, 사업별 합계), 급여(월별 총액만), 동아리 활동비(계획 대비 집행), 비품 구매(예산출처별)의 출처별 합계와 전체 합계. " +
        "'예산 흐름 보고해줘', '이번 달 얼마 나갔어?', '상반기 지출 정리해줘', '보조금으로 강사비 얼마 썼어?' 같은 질문에 쓰세요. " +
        "기간을 안 주면 올해 1월 1일~오늘. 개인별 급여·강사별 금액은 내보내지 않습니다.",
      inputSchema: z.object({
        from: z.string().optional().describe("시작일 YYYY-MM-DD (기본: 올해 1월 1일)"),
        to: z.string().optional().describe("종료일 YYYY-MM-DD, 포함 (기본: 오늘)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ from, to }) =>
      run("spending_overview", async () => {
        const r = resolveRange(from, to);
        return spendingOverview(r.from, r.to);
      })
  );

  server.registerTool(
    "settlement_detail",
    {
      title: "강사비 정산 상세",
      description:
        "강사비 정산 한 건의 지급 대상 인원수·총지급/공제/실지급 합계·재원(보조금/운영비)·사업·확정 상태를 보여줍니다. " +
        "settlement_id 없이 부르면 정산 목록(id 포함)을 돌려주므로, 먼저 목록을 보고 id 로 다시 부르세요. query 로 제목·사업명 검색. " +
        "'3차시 강사비 정산 어떻게 됐어?', '강사비 정산 목록 보여줘' 같은 질문에 쓰세요. 강사별 금액·계좌·이름은 내보내지 않습니다.",
      inputSchema: z.object({
        settlement_id: z.string().optional().describe("정산 id (목록에서 확인)"),
        query: z.string().optional().describe("목록 검색어(정산 제목·사업명 일부)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ settlement_id, query }) =>
      run("settlement_detail", () => settlementDetail(settlement_id, query))
  );

  server.registerTool(
    "club_budget",
    {
      title: "동아리 예산·집행",
      description:
        "청소년동아리별 한 해 예산계획 대비 집행액·집행률·잔액과 계획서 제출 여부를 보여줍니다. " +
        "'동아리 예산 얼마 남았어?', '동아리 실적 분석해줘(예산 집행 쪽)', '계획서 안 낸 동아리 있어?' 같은 질문에 쓰세요. 기본은 올해.",
      inputSchema: z.object({
        year: z.number().int().min(2020).max(2100).optional().describe("연도 (기본: 올해)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ year }) =>
      run("club_budget", () => clubBudget(year ?? Number(kstTodayYmd().slice(0, 4))))
  );

  server.registerTool(
    "mail_summary",
    {
      title: "공용 메일함 현황",
      description:
        "센터 공용 메일함의 전체/미처리/처리 중/완료 건수, 분류별(공문·회계 등) 아무도 안 연 메일 수, 마지막 수집 시각과 수집 지연 여부를 보여줍니다. " +
        "'메일 밀린 거 있어?', '미처리 메일 몇 건이야?', '메일 수집 잘 되고 있어?' 같은 질문에 쓰세요. 메일 제목·본문은 내보내지 않습니다.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => run("mail_summary", mailSummary)
  );

  server.registerTool(
    "rental_summary",
    {
      title: "대관예약 현황",
      description:
        "홈페이지 대관·청소년 공간 예약을 월별로 센터 본관/사직동 온나로 나눠 확정·신청 중·취소 건수와 이용인원을 보여줍니다. " +
        "'이번 달 대관 몇 건이야?', '온나 공간 이용 현황 알려줘', '취소 많이 됐어?' 같은 질문에 쓰세요. 기본은 이번 달, 최대 12개월.",
      inputSchema: z.object({
        from_month: z.string().optional().describe("시작 월 YYYY-MM (기본: 이번 달)"),
        to_month: z.string().optional().describe("끝 월 YYYY-MM, 포함 (기본: 시작 월)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ from_month, to_month }) =>
      run("rental_summary", async () => {
        const cur = kstTodayYmd().slice(0, 7);
        const f = from_month && YM.test(from_month) ? from_month : cur;
        const t = to_month && YM.test(to_month) ? to_month : f;
        if (f > t) throw new Error(`기간이 거꾸로입니다: ${f} ~ ${t}`);
        return rentalSummary(f, t);
      })
  );

  server.registerTool(
    "training_status",
    {
      title: "법정의무교육 이수 현황",
      description:
        "직원 법정의무교육의 교육별 대상·이수·미이수 인원과 이수율, 마감일, 직원별 이수 건수(미이수자 우선)를 보여줍니다. " +
        "'교육 수료 현황 알려줘', '의무교육 안 들은 사람 누구야?', '이수율 얼마야?' 같은 질문에 쓰세요. 기본은 올해(없으면 최근 연도).",
      inputSchema: z.object({
        year: z.number().int().min(2020).max(2100).optional().describe("연도"),
      }),
      annotations: READ_ONLY,
    },
    async ({ year }) => run("training_status", () => trainingStatus(year))
  );

  server.registerTool(
    "business_results",
    {
      title: "사업실적 집계",
      description:
        "프로그램 사업실적을 연·월(또는 기간)별로 모아 횟수·운영일·실인원·연인원·청소년 이용 비율·홍보 건수와 분야별·월별 집계를 보여줍니다. " +
        "'9월 사업실적 정리해줘', '올해 상반기 실적 분야별로', '청소년 비율 얼마야?' 같은 질문에 쓰세요. 기본은 이번 달.",
      inputSchema: z.object({
        year: z.number().int().min(2020).max(2100).optional().describe("연도 (기본: 올해)"),
        start_month: z.number().int().min(1).max(12).optional().describe("시작 월 (기본: 이번 달)"),
        end_month: z.number().int().min(1).max(12).optional().describe("끝 월, 포함 (기본: 시작 월)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ year, start_month, end_month }) =>
      run("business_results", async () => {
        const today = kstTodayYmd();
        const y = year ?? Number(today.slice(0, 4));
        const s = start_month ?? Number(today.slice(5, 7));
        const e = end_month ?? s;
        if (s > e) throw new Error(`월 범위가 거꾸로입니다: ${s} ~ ${e}`);
        return businessResults(y, s, e);
      })
  );

  server.registerTool(
    "contract_status",
    {
      title: "계약서 진행 현황",
      description:
        "근로계약서·연봉계약서의 진행 상태별 건수(작성 중·서명 대기·센터장 서명 대기·체결 완료·무효)와, 아직 끝나지 않은 건의 직원 이름을 보여줍니다. " +
        "'계약서 서명 안 한 사람 있어?', '연봉계약서 어디까지 됐어?' 같은 질문에 쓰세요. year 로 연도를 좁힐 수 있습니다. 계약 내용·금액은 내보내지 않습니다.",
      inputSchema: z.object({
        year: z.number().int().min(2020).max(2100).optional().describe("계약 연도 (없으면 전체)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ year }) => run("contract_status", () => contractStatus(year))
  );
}
