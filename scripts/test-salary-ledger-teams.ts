// 급여대장 소속별 다운로드·출력 순서 검증 (2026-11 김혜지 팀장 요청).
//   실행: npm run test:salary-ledger
//   DB 없음 — 순수 함수 + 엑셀 빌더만 씁니다.
//   확인:
//     ① 전체 대장 총합계 = 센터·배치지도사·방과후아카데미 대장 총합계의 합(모든 금액 열)
//     ② 소속별 대장 직원을 합치면 전체 대장 직원과 같다(누락 0·중복 0)
//     ③ 소속별 대장에는 그 소속 직원만
//     ④ 저장 순서 적용 — 소속 그룹 안에서 저장 순서, 신규 직원은 맨 아래
//     ⑤ [직급순]·[소속순] 자동 정렬
//     ⑥ 소속 값 — 배치지도사 추가 + 기존 값(센터·방과후) 하위호환
import ExcelJS from "exceljs";
import {
  PAYROLL_TEAMS,
  TEAM_LABEL,
  applyPayrollOrder,
  normalizeSalaryExtra,
  parsePayrollOrder,
  resolveTeam,
  sortPayrollRows,
  sortStaffByGrade,
  sortStaffByTeam,
  type PayItem,
  type PayrollTeam,
} from "../lib/salary";
import {
  buildPayrollLedgerWorkbook,
  ledgerColsFromRecord,
  type LedgerRowInput,
} from "../lib/salaryLedger";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

type Staff = {
  driver_id: string;
  name: string;
  rank: string;
  team: PayrollTeam;
  grade: string;
  step: number;
};

const STAFF: Staff[] = [
  { driver_id: "d1", name: "가관장", rank: "관장", team: "center", grade: "3급", step: 20 },
  { driver_id: "d2", name: "나부장", rank: "부장", team: "center", grade: "4급", step: 15 },
  { driver_id: "d3", name: "다팀원", rank: "팀원", team: "center", grade: "6급", step: 3 },
  { driver_id: "d4", name: "라배치", rank: "지도사", team: "placement", grade: "6급", step: 7 },
  { driver_id: "d5", name: "마배치", rank: "지도사", team: "placement", grade: "5급", step: 2 },
  { driver_id: "d6", name: "바방과", rank: "팀장", team: "afterschool", grade: "5급", step: 9 },
  { driver_id: "d7", name: "사방과", rank: "팀원", team: "afterschool", grade: "7급", step: 1 },
  { driver_id: "d8", name: "아신규", rank: "팀원", team: "center", grade: "7급", step: 1 },
];

// 직원마다 다른 금액(합계 검증이 의미 있게). 명절휴가비(비고) 일부 포함.
function record(i: number) {
  const pay: PayItem[] = [
    { key: "base", label: "기본급", amount: 2_000_000 + i * 123_450 },
    { key: "meal_allowance", label: "급식비", amount: 140_000 },
    { key: "transport_allowance", label: "교통보조비", amount: 50_000 + i * 1000 },
  ];
  if (i % 3 === 0) pay.push({ key: "mgmt_allowance", label: "관리업무수당", amount: 90_000 + i });
  if (i % 2 === 0) pay.push({ key: "family_allowance", label: "가족수당", amount: 40_000 });
  if (i === 5) pay.push({ key: "holiday_bonus", label: "명절휴가비", amount: 300_000 });
  const ded: PayItem[] = [
    { key: "income_tax", label: "갑근세", amount: 30_000 + i * 777 },
    { key: "resident_tax", label: "주민세", amount: 3_000 + i * 77 },
    { key: "pension", label: "국민연금", amount: 100_000 + i * 10 },
    { key: "health", label: "국민건강", amount: 80_000 + i * 9 },
    { key: "longterm_care", label: "장기요양", amount: 10_000 + i },
    { key: "employment", label: "고용보험", amount: 20_000 + i * 3 },
    { key: "sangjo", label: "상조회비", amount: 10_000 },
  ];
  const total_pay = pay.reduce((s, x) => s + x.amount, 0);
  const total_deduct = ded.reduce((s, x) => s + x.amount, 0);
  return {
    pay_items: pay,
    deduct_items: ded,
    total_pay,
    total_deduct,
    net_pay: total_pay - total_deduct,
  };
}

// 엑셀 → { names, total(금액 열 4~18) }
async function readLedger(buf: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const names: string[] = [];
  let total: number[] = [];
  const subtotals: string[] = [];
  ws.eachRow((row, n) => {
    if (n <= 2) return;
    const c1 = row.getCell(1).value;
    const c3 = String(row.getCell(3).value ?? "");
    const money = Array.from({ length: 15 }, (_, k) => Number(row.getCell(4 + k).value ?? 0));
    if (typeof c1 === "number") names.push(c3);
    else if (c3 === "총합계" || String(c1) === "총합계") total = money;
    else subtotals.push(String(c1));
  });
  return { names, total, subtotals, title: String(ws.getCell(1, 1).value ?? "") };
}

async function main() {
  // ⑥ 소속 값.
  chk("배치지도사 라벨", TEAM_LABEL.placement === "배치지도사");
  chk("그룹 순서 센터→배치지도사→방과후", PAYROLL_TEAMS.join(",") === "center,placement,afterschool");
  chk("extra.team placement 저장 유지", normalizeSalaryExtra({ team: "placement" }).team === "placement");
  chk("기존 값 afterschool 유지", normalizeSalaryExtra({ team: "afterschool" }).team === "afterschool");
  chk("잘못된 값 → 미지정", normalizeSalaryExtra({ team: "xx" }).team === "");
  chk("resolveTeam placement", resolveTeam({ team: "placement", name: "김소연" }) === "placement");
  chk("resolveTeam 미지정 시드 유지", resolveTeam({ team: "", name: "김소연" }) === "afterschool");

  // ④ 저장 순서: d3 를 맨 앞으로, d8(신규)은 저장 순서에 없음.
  const savedOrder = ["d3", "d2", "d1", "d5", "d4", "d7", "d6"];
  const rows = STAFF.map((s, i) => ({ ...s, ...record(i) }));
  const sorted = sortPayrollRows(rows, savedOrder);
  const got = sorted.map((r) => r.driver_id).join(",");
  chk(
    "저장 순서 + 소속 그룹 + 신규 맨 아래",
    got === "d3,d2,d1,d8,d5,d4,d7,d6",
    got,
  );
  const panel = applyPayrollOrder(STAFF, savedOrder).map((s) => s.driver_id);
  chk("순서 화면 — 신규는 목록 맨 아래", panel[panel.length - 1] === "d8", panel.join(","));
  chk("저장값 파싱 — 중복·잘못된 값 제거", parsePayrollOrder('["a","b","a",1,null]').join(",") === "a,b");
  chk("저장값 파싱 — 깨진 JSON → 빈 순서", parsePayrollOrder("{oops").length === 0);

  // ⑤ 자동 정렬.
  const byGrade = sortStaffByGrade(STAFF).map((s) => s.name);
  chk("직급순 — 3급 먼저, 같은 급은 호봉 높은 순", byGrade.slice(0, 3).join(",") === "가관장,나부장,바방과", byGrade.join(","));
  const byTeam = sortStaffByTeam(STAFF).map((s) => s.team);
  const teamSortedOk = byTeam.every(
    (t, i) => i === 0 || PAYROLL_TEAMS.indexOf(byTeam[i - 1]) <= PAYROLL_TEAMS.indexOf(t),
  );
  chk("소속순 — 센터→배치지도사→방과후", teamSortedOk, byTeam.join(","));
  chk(
    "소속순 — 같은 소속 안 기존 순서 유지",
    sortStaffByTeam(STAFF).filter((s) => s.team === "center").map((s) => s.driver_id).join(",") === "d1,d2,d3,d8",
  );

  // ①②③ 대장.
  const ledgerRows: LedgerRowInput[] = sorted.map((r) => {
    const { cols, note } = ledgerColsFromRecord(r);
    return { team: r.team, name: r.name, rank: r.rank, cols, note };
  });
  const all = await readLedger(
    await buildPayrollLedgerWorkbook({ year: 2026, month: 11, draft: false, rows: ledgerRows }),
  );
  chk("전체 대장 — 소속 소계 3개", all.subtotals.filter((x) => x.endsWith("소계")).length === 3, all.subtotals.join("/"));
  chk("전체 대장 — 행 순서 = 저장 순서", all.names.join(",") === sorted.map((r) => r.name).join(","));

  const sum = new Array(15).fill(0);
  const teamNames: string[] = [];
  for (const team of PAYROLL_TEAMS) {
    const t = await readLedger(
      await buildPayrollLedgerWorkbook({ year: 2026, month: 11, draft: false, rows: ledgerRows, team }),
    );
    const expect = STAFF.filter((s) => s.team === team).map((s) => s.name).sort();
    chk(`${TEAM_LABEL[team]} 대장 — 그 소속 직원만`, [...t.names].sort().join(",") === expect.join(","), t.names.join(","));
    chk(`${TEAM_LABEL[team]} 대장 — 제목에 소속`, t.title.endsWith(`(${TEAM_LABEL[team]})`), t.title);
    t.total.forEach((v, k) => (sum[k] += v));
    teamNames.push(...t.names);
  }
  chk(
    "전체 총합계 = 소속별 총합계의 합(15개 금액 열 모두)",
    all.total.length === 15 && all.total.every((v, k) => v === sum[k]),
    `전체 ${all.total[14]} / 합 ${sum[14]}`,
  );
  const dup = teamNames.filter((n, i) => teamNames.indexOf(n) !== i);
  const missing = all.names.filter((n) => !teamNames.includes(n));
  chk("소속별 합치면 누락 0", missing.length === 0, missing.join(","));
  chk("소속별 합치면 중복 0", dup.length === 0 && teamNames.length === all.names.length, dup.join(","));
  const expectedNet = rows.reduce((s, r) => s + r.net_pay, 0);
  chk("총합계 차인지급액 = 레코드 합", all.total[14] === expectedNet, `${all.total[14]} vs ${expectedNet}`);

  // 소속에 직원이 없는 경우 — 빈 대장(총합계 0).
  const empty = await readLedger(
    await buildPayrollLedgerWorkbook({
      year: 2026,
      month: 11,
      draft: true,
      rows: ledgerRows.filter((r) => r.team !== "placement"),
      team: "placement",
    }),
  );
  chk("직원 없는 소속 — 행 0", empty.names.length === 0);

  console.log(failed ? `\n✘ 실패 ${failed}건` : "\n✔ 모두 통과");
  process.exit(failed ? 1 : 0);
}

main();
