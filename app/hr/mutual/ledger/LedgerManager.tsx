"use client";

// =====================================================================
// MU-2. 상조회 장부 — 세입/세출 2단 표(기존 엑셀 레이아웃) + 실시간 잔액
//   + 월별 소계 + 월 회비 자동 기입 + 지출/세입 추가 + 행 수정·삭제
// MU-3. 상단 배너 — Cron 알림과 같은 내용(생일 축하금 대상·연말상여 제안).
// =====================================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getLedger,
  previewMonthlyFee,
  addMonthlyFee,
  addLedgerEntry,
  updateLedgerEntry,
  deleteLedgerEntry,
  type LedgerView,
  type LedgerRow,
  type LedgerInput,
  type MemberOption,
} from "@/app/hr/mutual/ledgerActions";
import {
  CHILDBIRTH_METHOD_LABEL,
  MUTUAL_FEE,
  RETIREMENT_TIERS,
  SNACK_UNIT,
  YEAR_END_BONUS_UNIT,
  birthdaySnackAmount,
  buildDescription,
  childbirthAmount,
  formatKRW,
  mutualCategories,
  mutualCategory,
  mutualCategoryLabel,
  type ChildbirthMethod,
  type MutualKind,
} from "@/lib/mutual";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const thCls = "px-2 py-1.5 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-1.5 align-middle text-sm text-ink-body";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const md = (d: string) => (d.length >= 10 ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d);

type Modal =
  | { kind: "fee"; month: number }
  | { kind: "entry"; entryKind: MutualKind; row: LedgerRow | null }
  | null;

export default function LedgerManager({ initial }: { initial: LedgerView }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [modal, setModal] = useState<Modal>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function reload(year = data.year) {
    setData(await getLedger(year));
  }
  function changeYear(next: number) {
    setMsg(null);
    start(async () => setData(await getLedger(next)));
  }
  function run(
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>,
    okText: string,
    confirmText?: string
  ) {
    if (confirmText && !confirm(confirmText)) return;
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setMsg({ ok: true, text: okText });
      setModal(null);
      await reload();
      router.refresh();
    });
  }

  // 세입·세출을 각각 날짜순으로 — 기존 엑셀처럼 좌(세입)·우(세출) 2단.
  const incomes = useMemo(
    () => data.rows.filter((r) => r.kind === "income"),
    [data.rows]
  );
  const expenses = useMemo(
    () => data.rows.filter((r) => r.kind === "expense"),
    [data.rows]
  );
  const maxLen = Math.max(incomes.length, expenses.length);
  const pairs = Array.from({ length: maxLen }, (_, i) => ({
    income: incomes[i] ?? null,
    expense: expenses[i] ?? null,
  }));

  const nextFeeMonth = data.feeMonths.findIndex((v) => !v) + 1;

  return (
    <div className="space-y-5">
      {/* MU-3 배너 */}
      {(data.birthdaysSoon.length > 0 || data.yearEndBonus?.eligible) && (
        <section className={`${noticeWarning} space-y-1`}>
          {data.birthdaysSoon.map((b) => (
            <p key={`${b.name}-${b.birthDate}`}>
              🎂 <b>{b.name}</b>({b.monthDay}) —{" "}
              {b.dday === 0 ? "오늘" : `${b.dday}일 뒤`} 생일 · 축하금 60,000 지급
              대상
            </p>
          ))}
          {data.yearEndBonus?.eligible && (
            <p>
              🎁 연말 상여 조건 충족 — 잔액 {formatKRW(data.balance)}원, 회원{" "}
              {data.yearEndBonus.members}명 × {formatKRW(YEAR_END_BONUS_UNIT)} ={" "}
              <b>{formatKRW(data.yearEndBonus.total)}원</b>
            </p>
          )}
        </section>
      )}

      {/* 연도·요약 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={data.year}
            onChange={(e) => changeYear(Number(e.target.value))}
            className={selCls}
            aria-label="연도"
          >
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || nextFeeMonth === 0}
              onClick={() =>
                setModal({ kind: "fee", month: nextFeeMonth || 1 })
              }
              className={btnPrimary}
              title={
                nextFeeMonth === 0
                  ? "12개월 모두 기입되었습니다."
                  : `${nextFeeMonth}월 회비를 기입합니다.`
              }
            >
              월 회비 기입
              {nextFeeMonth > 0 && (
                <span className="ml-1 text-[10px] font-normal opacity-80">
                  ({nextFeeMonth}월)
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                setModal({ kind: "entry", entryKind: "expense", row: null })
              }
              className={btnSecondary}
            >
              지출 추가
            </button>
            <button
              type="button"
              onClick={() =>
                setModal({ kind: "entry", entryKind: "income", row: null })
              }
              className={btnSecondary}
            >
              세입 추가
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="전년 이월" value={formatKRW(data.carryOver)} />
          <Stat label="세입 합계" value={formatKRW(data.totals.income)} />
          <Stat label="세출 합계" value={formatKRW(data.totals.expense)} />
          <Stat label="현재 잔액" value={formatKRW(data.balance)} tone="navy" />
        </div>
        <p className="mt-2 text-xs text-ink-hint">
          잔액 = 이월 {formatKRW(data.carryOver)} + 세입{" "}
          {formatKRW(data.totals.income)} − 세출 {formatKRW(data.totals.expense)} ·
          활동 회원 {data.activeMembers}명 (월 회비{" "}
          {formatKRW(data.activeMembers * MUTUAL_FEE)}원)
        </p>

        {/* 월 회비 기입 현황 */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {MONTHS.map((m) => (
            <span
              key={m}
              className={data.feeMonths[m - 1] ? badgeSuccess : badgeNeutral}
              title={
                data.feeMonths[m - 1]
                  ? `${m}월 회비 기입됨`
                  : `${m}월 회비 미기입`
              }
            >
              {m}월{data.feeMonths[m - 1] ? " ✓" : ""}
            </span>
          ))}
        </div>
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 세입 | 세출 2단 표 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold text-ink">
          {data.year}년 장부 ({data.rows.length}건)
        </h3>
        {data.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-hint">
            기입된 내역이 없습니다. [월 회비 기입]으로 시작하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b-2 border-navy/30">
                  <th className={`${thCls} bg-navy-soft/30`} colSpan={4}>
                    세 입
                  </th>
                  <th className={`${thCls} bg-stamp-soft/40`} colSpan={4}>
                    세 출
                  </th>
                </tr>
                <tr className="border-b border-line">
                  <th className={thCls}>날짜</th>
                  <th className={thCls}>적요</th>
                  <th className={`${thCls} text-right`}>금액</th>
                  <th className={`${thCls} w-14`}></th>
                  <th className={thCls}>날짜</th>
                  <th className={thCls}>적요</th>
                  <th className={`${thCls} text-right`}>금액</th>
                  <th className={`${thCls} w-14`}></th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <Side
                      row={p.income}
                      onEdit={(row) =>
                        setModal({ kind: "entry", entryKind: "income", row })
                      }
                      onDelete={(row) =>
                        run(
                          () => deleteLedgerEntry(row.id),
                          "행을 삭제했습니다.",
                          `"${row.description}" (${formatKRW(row.amount)}원) 행을 삭제할까요?`
                        )
                      }
                      pending={pending}
                    />
                    <Side
                      row={p.expense}
                      onEdit={(row) =>
                        setModal({ kind: "entry", entryKind: "expense", row })
                      }
                      onDelete={(row) =>
                        run(
                          () => deleteLedgerEntry(row.id),
                          "행을 삭제했습니다.",
                          `"${row.description}" (${formatKRW(row.amount)}원) 행을 삭제할까요?`
                        )
                      }
                      pending={pending}
                    />
                  </tr>
                ))}
                <tr className="border-t-2 border-navy/30 bg-surface font-semibold">
                  <td className={tdCls} colSpan={2}>
                    세입 합계
                  </td>
                  <td className={`${tdCls} text-right text-navy`}>
                    {formatKRW(data.totals.income)}
                  </td>
                  <td className={tdCls} />
                  <td className={tdCls} colSpan={2}>
                    세출 합계
                  </td>
                  <td className={`${tdCls} text-right text-stamp`}>
                    {formatKRW(data.totals.expense)}
                  </td>
                  <td className={tdCls} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 월별 소계 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold text-ink">월별 소계</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={thCls}>월</th>
                {MONTHS.map((m) => (
                  <th key={m} className={`${thCls} text-right`}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <MonthRow
                label="세입"
                values={data.monthly.map((m) => m.income)}
                tone="navy"
              />
              <MonthRow
                label="세출"
                values={data.monthly.map((m) => m.expense)}
                tone="stamp"
              />
              <MonthRow
                label="누적 잔액"
                values={data.monthly.reduce<number[]>((acc, m, i) => {
                  acc.push((i === 0 ? data.carryOver : acc[i - 1]) + m.net);
                  return acc;
                }, [])}
                bold
              />
            </tbody>
          </table>
        </div>
      </section>

      {modal?.kind === "fee" && (
        <FeeModal
          year={data.year}
          feeMonths={data.feeMonths}
          initialMonth={modal.month}
          onClose={() => setModal(null)}
          onDone={async (text) => {
            setModal(null);
            setMsg({ ok: true, text });
            await reload();
            router.refresh();
          }}
        />
      )}

      {modal?.kind === "entry" && (
        <EntryModal
          year={data.year}
          today={data.today}
          entryKind={modal.entryKind}
          row={modal.row}
          members={data.memberOptions}
          activeMembers={data.activeMembers}
          onClose={() => setModal(null)}
          onDone={async (text) => {
            setModal(null);
            setMsg({ ok: true, text });
            await reload();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// 2단 표의 한쪽(날짜·적요·금액·관리). row 가 없으면 빈 칸.
function Side({
  row,
  onEdit,
  onDelete,
  pending,
}: {
  row: LedgerRow | null;
  onEdit: (row: LedgerRow) => void;
  onDelete: (row: LedgerRow) => void;
  pending: boolean;
}) {
  if (!row)
    return (
      <>
        <td className={tdCls} />
        <td className={tdCls} />
        <td className={tdCls} />
        <td className={tdCls} />
      </>
    );
  return (
    <>
      <td className={`${tdCls} whitespace-nowrap font-mono text-xs`}>
        {md(row.entry_date)}
      </td>
      <td className={tdCls}>
        <span className="text-ink">{row.description}</span>
        <span className="ml-1 text-[10px] text-ink-hint">
          {mutualCategoryLabel(row.category)}
        </span>
        {row.created_by && (
          <span className="ml-1 text-[10px] text-ink-hint">
            · {row.created_by}
          </span>
        )}
      </td>
      <td className={`${tdCls} whitespace-nowrap text-right font-mono`}>
        {formatKRW(row.amount)}
      </td>
      <td className={`${tdCls} whitespace-nowrap text-right`}>
        <button
          type="button"
          onClick={() => onEdit(row)}
          className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface"
        >
          수정
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDelete(row)}
          className="ml-1 rounded border border-stamp px-1.5 py-0.5 text-[10px] text-stamp hover:bg-stamp-soft"
        >
          삭제
        </button>
      </td>
    </>
  );
}

function MonthRow({
  label,
  values,
  tone,
  bold,
}: {
  label: string;
  values: number[];
  tone?: "navy" | "stamp";
  bold?: boolean;
}) {
  const color =
    tone === "navy" ? "text-navy" : tone === "stamp" ? "text-stamp" : "text-ink";
  return (
    <tr className="border-b border-line/60">
      <td className={`${tdCls} font-semibold`}>{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`${tdCls} text-right font-mono text-xs ${color} ${
            bold ? "font-bold" : ""
          }`}
        >
          {v === 0 && !bold ? "-" : formatKRW(v)}
        </td>
      ))}
    </tr>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "navy";
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tone === "navy"
          ? "border-navy/30 bg-navy-soft/30"
          : "border-line bg-surface/60"
      }`}
    >
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="mt-0.5 font-mono text-base font-bold text-ink">{value}원</p>
    </div>
  );
}

// =====================================================================
// 월 회비 기입 — 회원 수 × 15,000 자동 계산 → 확인 후 1행 기입.
// =====================================================================
function FeeModal({
  year,
  feeMonths,
  initialMonth,
  onClose,
  onDone,
}: {
  year: number;
  feeMonths: boolean[];
  initialMonth: number;
  onClose: () => void;
  onDone: (text: string) => void | Promise<void>;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [preview, setPreview] = useState<{
    members: number;
    amount: number;
    description: string;
    entryDate: string;
  } | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(m: number) {
    setErr(null);
    setPreview(null);
    start(async () => {
      const res = await previewMonthlyFee({ year, month: m });
      if (!res.ok) return setErr(res.message);
      setPreview(res);
      setAmount(String(res.amount));
      setDescription(res.description);
      setEntryDate(res.entryDate);
    });
  }

  function submit() {
    setErr(null);
    start(async () => {
      const res = await addMonthlyFee({
        year,
        month,
        amount: Number(amount),
        description,
        entryDate,
      });
      if (!res.ok) return setErr(res.message);
      await onDone(`${month}월 회비 ${formatKRW(res.amount)}원을 기입했습니다.`);
    });
  }

  const taken = feeMonths[month - 1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">{year}년 월 회비 기입</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">월</span>
            <select
              value={month}
              onChange={(e) => {
                const m = Number(e.target.value);
                setMonth(m);
                setPreview(null);
              }}
              className={`${selCls} mt-1`}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m} disabled={feeMonths[m - 1]}>
                  {m}월{feeMonths[m - 1] ? " (기입됨)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => load(month)}
            disabled={pending || taken}
            className={btnSecondary}
          >
            회원 수로 계산
          </button>
        </div>

        {taken && (
          <p className={`mt-3 ${noticeWarning}`}>
            {month}월 회비는 이미 기입되어 있습니다. 다른 달을 고르세요.
          </p>
        )}

        {preview && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg border border-line bg-surface/60 px-3 py-2 text-sm text-ink-body">
              활동 회원 <b>{preview.members}명</b> × {formatKRW(MUTUAL_FEE)}원 ={" "}
              <b className="text-navy">{formatKRW(preview.amount)}원</b>
            </p>
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                금액 (미납 등 예외 시 수정)
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inCls} mt-1`}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                적요
              </span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`${inCls} mt-1`}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                기입일
              </span>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className={`${inCls} mt-1`}
              />
            </label>
          </div>
        )}

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !preview || taken}
            className={btnPrimary}
          >
            {pending ? "기입 중…" : "기입"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 세입·세출 추가/수정 — 사유(카테고리) 선택 시 금액·적요 자동.
// =====================================================================
function EntryModal({
  year,
  today,
  entryKind,
  row,
  members,
  activeMembers,
  onClose,
  onDone,
}: {
  year: number;
  today: string;
  entryKind: MutualKind;
  row: LedgerRow | null;
  members: MemberOption[];
  activeMembers: number;
  onClose: () => void;
  onDone: (text: string) => void | Promise<void>;
}) {
  const cats = mutualCategories(entryKind);
  const [category, setCategory] = useState(row?.category ?? cats[0]?.key ?? "");
  const [entryDate, setEntryDate] = useState(
    row?.entry_date ?? (today.slice(0, 4) === String(year) ? today : `${year}-01-01`)
  );
  const [employeeId, setEmployeeId] = useState(row?.employee_id ?? "");
  const [amount, setAmount] = useState(row ? String(row.amount) : "");
  const [description, setDescription] = useState(row?.description ?? "");
  // 프리셋 보조 입력.
  const [headCount, setHeadCount] = useState(String(activeMembers));
  const [birthdayCount, setBirthdayCount] = useState("1");
  const [childOrder, setChildOrder] = useState("1");
  const [childMethod, setChildMethod] = useState<ChildbirthMethod>("linear");
  const [tierKey, setTierKey] = useState(RETIREMENT_TIERS[0]?.key ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const cat = mutualCategory(category);
  const memberName =
    members.find((m) => m.employee_id === employeeId)?.name ?? null;

  // 규정 금액 — 사유·보조 입력이 바뀌면 다시 계산해 제안한다.
  const suggested = useMemo(() => {
    if (!cat) return null;
    switch (cat.rule.type) {
      case "fixed":
        return cat.rule.amount;
      case "per_head":
        return cat.key === "birthday_snack"
          ? birthdaySnackAmount(Number(headCount), Number(birthdayCount))
          : Math.max(0, Math.round(Number(headCount) || 0)) * cat.rule.unit;
      case "childbirth":
        return childbirthAmount(Number(childOrder), childMethod, cat.rule.base);
      case "tier":
        return RETIREMENT_TIERS.find((t) => t.key === tierKey)?.amount ?? null;
      case "free":
        return null;
    }
  }, [cat, headCount, birthdayCount, childOrder, childMethod, tierKey]);

  // 사유를 바꾸면 금액·적요를 프리셋으로 갈아끼운다(수정 중이던 값은 유지 안 함).
  function pickCategory(key: string) {
    setCategory(key);
    const c = mutualCategory(key);
    if (!c) return;
    if (c.rule.type === "fixed") setAmount(String(c.rule.amount));
    else if (c.rule.type === "free") setAmount("");
    setDescription(buildDescription(key, memberName));
  }
  function pickEmployee(id: string) {
    setEmployeeId(id);
    const name = members.find((m) => m.employee_id === id)?.name ?? null;
    // 적요 자동 생성 — 담당이 직접 고친 적요는 덮지 않도록 템플릿일 때만.
    const auto = buildDescription(category, memberName);
    if (!description || description === auto || description === cat?.label)
      setDescription(buildDescription(category, name));
  }

  function applySuggested() {
    if (suggested != null) setAmount(String(suggested));
  }

  function submit() {
    setErr(null);
    const input: LedgerInput = {
      entryDate,
      kind: entryKind,
      category,
      description,
      amount: Number(amount),
      employeeId: employeeId || null,
    };
    start(async () => {
      const res = row
        ? await updateLedgerEntry(row.id, input)
        : await addLedgerEntry(input);
      if (!res.ok) return setErr(res.message);
      await onDone(row ? "행을 수정했습니다." : "행을 추가했습니다.");
    });
  }

  const kindLabel = entryKind === "income" ? "세입" : "세출";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-4 w-full max-w-lg rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {kindLabel} {row ? "수정" : "추가"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        <div className="space-y-2.5">
          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              사유 *
            </span>
            <select
              value={category}
              onChange={(e) => pickCategory(e.target.value)}
              className={`${inCls} mt-1`}
            >
              {cats.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            {cat?.note && (
              <span className="mt-1 block text-[11px] text-ink-hint">
                {cat.note}
              </span>
            )}
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              대상 직원
            </span>
            <select
              value={employeeId}
              onChange={(e) => pickEmployee(e.target.value)}
              className={`${inCls} mt-1`}
            >
              <option value="">(없음)</option>
              {members.map((m) => (
                <option key={m.employee_id} value={m.employee_id}>
                  {m.name}
                  {m.status === "paused" ? " (일시정지)" : ""}
                </option>
              ))}
            </select>
          </label>

          {/* 프리셋 보조 입력 */}
          {cat?.rule.type === "per_head" && cat.key === "birthday_snack" && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-navy/30 bg-navy-soft/20 p-2.5">
              <label className="block">
                <span className="block text-[11px] font-semibold text-navy">
                  당일 근무인원
                </span>
                <input
                  type="number"
                  min={0}
                  value={headCount}
                  onChange={(e) => setHeadCount(e.target.value)}
                  className={`${inCls} mt-1`}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-navy">
                  생일자 수
                </span>
                <input
                  type="number"
                  min={1}
                  value={birthdayCount}
                  onChange={(e) => setBirthdayCount(e.target.value)}
                  className={`${inCls} mt-1`}
                />
              </label>
              <p className="col-span-2 text-[11px] text-ink-hint">
                {headCount || 0}명 × {formatKRW(SNACK_UNIT)} ×{" "}
                {birthdayCount || 1} ={" "}
                <b className="text-navy">{formatKRW(suggested ?? 0)}원</b>
              </p>
            </div>
          )}

          {cat?.rule.type === "per_head" && cat.key === "year_end_bonus" && (
            <div className="rounded-lg border border-navy/30 bg-navy-soft/20 p-2.5">
              <label className="block">
                <span className="block text-[11px] font-semibold text-navy">
                  지급 인원
                </span>
                <input
                  type="number"
                  min={0}
                  value={headCount}
                  onChange={(e) => setHeadCount(e.target.value)}
                  className={`${inCls} mt-1`}
                />
              </label>
              <p className="mt-1 text-[11px] text-ink-hint">
                {headCount || 0}명 × {formatKRW(YEAR_END_BONUS_UNIT)} ={" "}
                <b className="text-navy">{formatKRW(suggested ?? 0)}원</b>
              </p>
            </div>
          )}

          {cat?.rule.type === "childbirth" && (
            <div className="space-y-2 rounded-lg border border-navy/30 bg-navy-soft/20 p-2.5">
              <label className="block">
                <span className="block text-[11px] font-semibold text-navy">
                  산정방식
                </span>
                <select
                  value={childMethod}
                  onChange={(e) =>
                    setChildMethod(e.target.value as ChildbirthMethod)
                  }
                  className={`${inCls} mt-1`}
                >
                  <option value="linear">
                    {CHILDBIRTH_METHOD_LABEL.linear}
                  </option>
                  <option value="double">
                    {CHILDBIRTH_METHOD_LABEL.double}
                  </option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-navy">
                  출산차수
                </span>
                <input
                  type="number"
                  min={1}
                  value={childOrder}
                  onChange={(e) => setChildOrder(e.target.value)}
                  className={`${inCls} mt-1`}
                />
              </label>
              <p className="text-[11px] text-ink-hint">
                {childOrder || 1}차 →{" "}
                <b className="text-navy">{formatKRW(suggested ?? 0)}원</b>
                {" · "}규정 확인 후 산정방식을 고르세요(1·2차는 동일).
              </p>
            </div>
          )}

          {cat?.rule.type === "tier" && (
            <div className="rounded-lg border border-navy/30 bg-navy-soft/20 p-2.5">
              <label className="block">
                <span className="block text-[11px] font-semibold text-navy">
                  근속 구간
                </span>
                <select
                  value={tierKey}
                  onChange={(e) => setTierKey(e.target.value)}
                  className={`${inCls} mt-1`}
                >
                  {RETIREMENT_TIERS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label} — {formatKRW(t.amount)}원
                    </option>
                  ))}
                  <option value="">구간표에 없음 (직접 입력)</option>
                </select>
              </label>
              <p className="mt-1 text-[11px] text-ink-hint">
                확인된 구간만 등록돼 있습니다. 해당 구간이 없으면 금액을 직접
                입력하세요.
              </p>
            </div>
          )}

          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              적요 *
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="예: 홍길동 생일 축하금"
              className={`${inCls} mt-1`}
            />
          </label>

          <div>
            <span className="block text-[11px] font-semibold text-navy">
              금액 *
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inCls}
              />
              {suggested != null && Number(amount) !== suggested && (
                <button
                  type="button"
                  onClick={applySuggested}
                  className={btnSecondary}
                  title="규정 금액으로 되돌립니다"
                >
                  규정 {formatKRW(suggested)}
                </button>
              )}
            </div>
          </div>

          <label className="block">
            <span className="block text-[11px] font-semibold text-navy">
              날짜 *
            </span>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className={`${inCls} mt-1`}
            />
          </label>
        </div>

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={btnPrimary}
          >
            {pending ? "저장 중…" : row ? "저장" : "추가"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
