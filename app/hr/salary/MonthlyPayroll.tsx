"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  generateMonthlyPayroll,
  listMonthlyPayroll,
  savePayrollRecord,
  confirmMonthlyPayroll,
  cancelMonthlyConfirm,
  previewEdiUpload,
  applyEdiUpload,
  listPayslipTargets,
  sendPayslips,
  type MonthlyRow,
  type MonthlyListResult,
  type EdiPreviewResult,
  type PayslipTargetsResult,
  type PayslipSendResult,
} from "@/app/hr/salary/monthlyActions";
import {
  formatKRW,
  PAY_ADDON_PRESETS,
  TEAM_LABEL,
  type PayItem,
} from "@/lib/salary";
import {
  EDI_FILE_TYPES,
  guessFileType,
  type EdiFileType,
} from "@/lib/salaryEdi";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
  noticeSuccess,
  noticeWarning,
  badgeNavy,
  badgeWarning,
  badgeSuccess,
  badgeNeutral,
} from "@/lib/ui";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

// 파일 → base64(대용량 대비 청크 처리).
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function MonthlyPayrollSection({
  year,
  isM0,
}: {
  year: number;
  isM0: boolean;
}) {
  const [month, setMonth] = useState<number>(
    () => new Date().getMonth() + 1
  );
  const [data, setData] = useState<MonthlyListResult | null>(null);
  const [loading, startLoad] = useTransition();
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  function load() {
    startLoad(async () => {
      setEditingId(null);
      const res = await listMonthlyPayroll({ year, month });
      setData(res);
    });
  }

  // 연·월 변경 시 재조회.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  function generate(overwrite: boolean) {
    setMsg(null);
    startBusy(async () => {
      const res = await generateMonthlyPayroll({
        year,
        month,
        overwriteDrafts: overwrite,
      });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      // 초안 이미 존재 → 덮어쓸지 확인 후 재실행.
      if (res.existingDrafts.length > 0 && !overwrite) {
        const names = res.existingDrafts.join(", ");
        if (
          confirm(
            `이미 초안이 있는 직원 ${res.existingDrafts.length}명(${names})의 급여를 다시 계산해 덮어쓸까요? (확정된 건은 유지됩니다)`
          )
        ) {
          generate(true);
          return;
        }
      }
      const parts: string[] = [];
      if (res.created) parts.push(`신규 ${res.created}건`);
      if (res.updated) parts.push(`갱신 ${res.updated}건`);
      if (res.skippedConfirmed.length)
        parts.push(`확정 보호 ${res.skippedConfirmed.length}건`);
      if (res.noBase.length)
        parts.push(`기본급 없음 ${res.noBase.length}건(${res.noBase.join(", ")})`);
      setMsg({
        ok: true,
        text: `${year}년 ${month}월 급여 생성 완료 — 대상 ${res.targets}명. ${
          parts.join(", ") || "변경 없음"
        }`,
      });
      load();
    });
  }

  function confirmAll(force: boolean) {
    setMsg(null);
    startBusy(async () => {
      const res = await confirmMonthlyPayroll({ year, month, force });
      if (!res.ok) {
        if (res.warnings && res.warnings.length > 0) {
          if (
            confirm(
              `확정 전 확인이 필요합니다:\n\n${res.warnings.join(
                "\n"
              )}\n\n그래도 확정할까요?`
            )
          ) {
            confirmAll(true);
          }
          return;
        }
        setMsg({ ok: false, text: res.message ?? "확정에 실패했습니다." });
        return;
      }
      setMsg({ ok: true, text: `${res.confirmed}건을 확정했습니다.` });
      load();
    });
  }

  function cancelConfirm() {
    if (!confirm(`${year}년 ${month}월 확정을 취소할까요? (수정 잠금이 풀립니다)`))
      return;
    setMsg(null);
    startBusy(async () => {
      const res = await cancelMonthlyConfirm({ year, month });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: `확정을 취소했습니다. (${res.canceled}건)` });
      load();
    });
  }

  const rows = data?.rows ?? [];
  const hasRows = rows.length > 0;
  const anyConfirmed = data?.anyConfirmed ?? false;
  const allConfirmed = data?.allConfirmed ?? false;

  return (
    <div className="space-y-5">
      {/* 상단 — 월 선택 + 생성/확정/대장 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold text-ink">{year}년 월별 급여</h3>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
          {loading && <span className="text-xs text-ink-hint">불러오는 중…</span>}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={busy}
              className={btnPrimary}
            >
              이 달 급여 생성
            </button>
            {hasRows && !allConfirmed && (
              <button
                type="button"
                onClick={() => confirmAll(false)}
                disabled={busy}
                className={btnSecondary}
              >
                이 달 급여 확정
              </button>
            )}
            {hasRows && anyConfirmed && isM0 && (
              <button
                type="button"
                onClick={cancelConfirm}
                disabled={busy}
                className={btnDanger}
              >
                확정 취소
              </button>
            )}
            {hasRows && (
              <a
                href={`/hr/salary/ledger?year=${year}&month=${month}`}
                className={btnSecondary}
              >
                급여대장 다운로드{!allConfirmed ? " (초안)" : ""}
              </a>
            )}
            {hasRows && (
              <button
                type="button"
                onClick={() => setSendOpen(true)}
                disabled={!allConfirmed}
                className={btnPrimary}
                title={
                  !allConfirmed
                    ? "확정된 달만 명세서를 발송할 수 있습니다."
                    : ""
                }
              >
                명세서 이메일 발송
              </button>
            )}
          </div>
        </div>
        {hasRows && !allConfirmed && (
          <p className="mt-2 text-[11px] text-ink-hint">
            명세서 발송은 급여를 확정한 뒤에 활성화됩니다.
          </p>
        )}

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}
        {data && data.missingNames.length > 0 && (
          <p className={`mt-3 ${noticeWarning}`}>
            생성 대상이지만 레코드가 없는 직원 {data.missingNames.length}명:{" "}
            {data.missingNames.join(", ")} — “이 달 급여 생성”을 실행하세요.
          </p>
        )}
      </section>

      {/* 목록 */}
      <section className={cardCls}>
        {!hasRows ? (
          <div className="py-12 text-center text-sm text-ink-hint">
            {loading
              ? "불러오는 중…"
              : `${year}년 ${month}월 급여 레코드가 없습니다. “이 달 급여 생성”으로 만드세요.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>#</th>
                  <th className={thCls}>이름</th>
                  <th className={thCls}>직책</th>
                  <th className={thCls}>팀</th>
                  <th className={`${thCls} text-right`}>지급총액</th>
                  <th className={`${thCls} text-right`}>공제총액</th>
                  <th className={`${thCls} text-right`}>차인지급액</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <PayrollRowView
                    key={r.recordId}
                    index={i + 1}
                    row={r}
                    editing={editingId === r.recordId}
                    onEdit={() =>
                      setEditingId(
                        editingId === r.recordId ? null : r.recordId
                      )
                    }
                    onSaved={() => {
                      setEditingId(null);
                      load();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4대보험 EDI 업로드 */}
      <EdiUploadPanel
        year={year}
        month={month}
        onApplied={() => load()}
      />

      {sendOpen && (
        <PayslipSendModal
          year={year}
          month={month}
          onClose={() => setSendOpen(false)}
          onSent={() => load()}
        />
      )}
    </div>
  );
}

// =====================================================================
// 명세서 이메일 발송 모달 — 대상 확인 → 발송 → 결과
// =====================================================================
function PayslipSendModal({
  year,
  month,
  onClose,
  onSent,
}: {
  year: number;
  month: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const [targets, setTargets] = useState<PayslipTargetsResult | null>(null);
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  // 선택된 driver_id 집합. 이메일 있는 대상만 선택 가능.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PayslipSendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    startLoad(async () => {
      const res = await listPayslipTargets({ year, month });
      setTargets(res);
      // 기본 체크 규칙: 이메일 있고 아직 미발송인 대상만 자동 선택.
      //   (이미 발송됨은 해제 — 필요 시 개별 체크로 재발송)
      setSelected(
        new Set(
          res.targets
            .filter((t) => t.email && !t.emailedAt)
            .map((t) => t.driver_id)
        )
      );
    });
  }, [year, month]);

  // 선택 가능(이메일 등록) 대상.
  const selectableIds = useMemo(() => {
    if (!targets) return [] as string[];
    return targets.targets.filter((t) => t.email).map((t) => t.driver_id);
  }, [targets]);

  const allSelectableChecked =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleOne(driverId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(
      allSelectableChecked ? new Set() : new Set(selectableIds)
    );
  }

  const selectedCount = selected.size;

  function doSend() {
    setErr(null);
    setResult(null);
    startSend(async () => {
      const res = await sendPayslips({
        year,
        month,
        driverIds: [...selected],
      });
      if (!res.ok) {
        if (res.notConfigured) {
          setErr(
            "발송 설정이 필요합니다. 환경변수 GMAIL_SENDER / GMAIL_APP_PASSWORD 를 등록하세요."
          );
        } else {
          setErr(res.message ?? "발송에 실패했습니다.");
        }
        return;
      }
      setResult(res);
      onSent();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {year}년 {month}월 급여명세서 발송
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        {loading || !targets ? (
          <p className="py-8 text-center text-sm text-ink-hint">불러오는 중…</p>
        ) : !targets.configured ? (
          <div className={noticeWarning}>
            발송 설정이 필요합니다. 환경변수{" "}
            <code className="font-mono">GMAIL_SENDER</code> /{" "}
            <code className="font-mono">GMAIL_APP_PASSWORD</code> 를 등록한 뒤 다시
            시도하세요. (에러 아님 — 설정 후 사용 가능)
          </div>
        ) : (
          <>
            {result ? (
              <SendResultView result={result} />
            ) : (
              <>
                <div className="mb-3 overflow-x-auto">
                  <table className="w-full min-w-[460px] border-collapse">
                    <thead>
                      <tr className="border-b border-line">
                        <th className={`${thCls} w-10`}>
                          <input
                            type="checkbox"
                            checked={allSelectableChecked}
                            onChange={toggleAll}
                            disabled={selectableIds.length === 0}
                            className="h-4 w-4 rounded border-line text-navy focus:ring-navy disabled:opacity-40"
                            title="전체 선택/해제"
                            aria-label="전체 선택/해제"
                          />
                        </th>
                        <th className={thCls}>이름</th>
                        <th className={thCls}>이메일</th>
                        <th className={thCls}>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.targets.map((t) => (
                        <tr
                          key={t.driver_id}
                          className="border-b border-line/60"
                        >
                          <td className={tdCls}>
                            <input
                              type="checkbox"
                              checked={selected.has(t.driver_id)}
                              onChange={() => toggleOne(t.driver_id)}
                              disabled={!t.email}
                              className="h-4 w-4 rounded border-line text-navy focus:ring-navy disabled:opacity-40"
                              title={
                                !t.email
                                  ? "이메일 미등록 — 선택할 수 없습니다"
                                  : ""
                              }
                              aria-label={`${t.name} 선택`}
                            />
                          </td>
                          <td className={tdCls}>{t.name}</td>
                          <td className={`${tdCls} font-mono text-xs`}>
                            {t.email ?? (
                              <span className="text-stamp">이메일 미등록</span>
                            )}
                          </td>
                          <td className={tdCls}>
                            {!t.email ? (
                              <span className={badgeWarning}>발송 제외</span>
                            ) : t.emailedAt ? (
                              <span className={badgeSuccess}>이미 발송됨</span>
                            ) : (
                              <span className={badgeNeutral}>미발송</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {targets.targets.some((t) => !t.email) && (
                  <p className={`mb-3 ${noticeWarning}`}>
                    이메일 미등록 직원은 선택할 수 없어 발송에서 제외됩니다.
                    인사기록카드에서 이메일을 등록해 주세요.
                  </p>
                )}

                <p className="mb-3 text-[11px] text-ink-hint">
                  기본값은 “아직 발송하지 않은 직원”만 선택됩니다. 이미 발송된
                  직원을 체크하면 재발송됩니다. (테스트·개별 발송 시 필요한 사람만
                  선택하세요.)
                </p>

                {err && <p className={`mb-3 ${noticeError}`}>{err}</p>}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={doSend}
                    disabled={sending || selectedCount === 0}
                    className={btnPrimary}
                  >
                    {sending
                      ? "발송 중…"
                      : `선택한 ${selectedCount}명에게 발송`}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className={btnSecondary}
                  >
                    취소
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SendResultView({ result }: { result: PayslipSendResult }) {
  if (!result.ok) return null;
  const label: Record<string, string> = {
    sent: "발송 완료",
    skipped_no_email: "이메일 미등록",
    skipped_already: "이미 발송(건너뜀)",
    failed: "실패",
  };
  return (
    <div className="space-y-3">
      <p className={noticeSuccess}>
        발송 {result.sent}건 · 실패 {result.failed}건 · 건너뜀 {result.skipped}건
        {result.ignored > 0 ? ` · 무시 ${result.ignored}건(대상 아님)` : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={thCls}>이름</th>
              <th className={thCls}>이메일</th>
              <th className={thCls}>결과</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((it, i) => (
              <tr key={`${it.name}-${i}`} className="border-b border-line/60">
                <td className={tdCls}>{it.name}</td>
                <td className={`${tdCls} font-mono text-xs`}>
                  {it.email ?? "-"}
                </td>
                <td className={tdCls}>
                  {it.status === "sent" ? (
                    <span className={badgeSuccess}>{label[it.status]}</span>
                  ) : it.status === "failed" ? (
                    <span className={badgeWarning}>
                      {label[it.status]}
                      {it.error ? ` — ${it.error}` : ""}
                    </span>
                  ) : (
                    <span className={badgeNeutral}>{label[it.status]}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// 목록 행 + 인라인 편집기
// =====================================================================
function statusBadge(row: MonthlyRow) {
  if (row.confirmed) return <span className={badgeSuccess}>확정</span>;
  return <span className={badgeNeutral}>초안</span>;
}

function PayrollRowView({
  index,
  row,
  editing,
  onEdit,
  onSaved,
}: {
  index: number;
  row: MonthlyRow;
  editing: boolean;
  onEdit: () => void;
  onSaved: () => void;
}) {
  return (
    <>
      <tr className="border-b border-line/60">
        <td className={`${tdCls} text-ink-hint`}>{index}</td>
        <td className={`${tdCls} font-medium text-ink`}>
          {row.name}
          {row.modified && (
            <span className={`${badgeWarning} ml-1.5`}>설정과 다름</span>
          )}
        </td>
        <td className={tdCls}>{row.rank ?? "-"}</td>
        <td className={tdCls}>
          <span className={badgeNavy}>{TEAM_LABEL[row.team]}</span>
        </td>
        <td className={`${tdCls} text-right font-mono`}>
          {formatKRW(row.total_pay)}
        </td>
        <td className={`${tdCls} text-right font-mono`}>
          {formatKRW(row.total_deduct)}
        </td>
        <td className={`${tdCls} text-right font-mono font-semibold`}>
          {formatKRW(row.net_pay)}
        </td>
        <td className={tdCls}>{statusBadge(row)}</td>
        <td className={`${tdCls} text-right`}>
          <button
            type="button"
            onClick={onEdit}
            disabled={row.confirmed}
            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50"
            title={row.confirmed ? "확정된 급여는 수정할 수 없습니다" : ""}
          >
            {editing ? "닫기" : "명세서 편집"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={9} className="bg-surface/50 px-3 py-3">
            <RecordEditor row={row} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

function RecordEditor({
  row,
  onSaved,
}: {
  row: MonthlyRow;
  onSaved: () => void;
}) {
  const [pay, setPay] = useState<PayItem[]>(() =>
    row.pay_items.map((i) => ({ ...i }))
  );
  const [deduct, setDeduct] = useState<PayItem[]>(() =>
    row.deduct_items.map((i) => ({ ...i }))
  );
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const totalPay = useMemo(
    () => pay.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    [pay]
  );
  const totalDeduct = useMemo(
    () => deduct.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    [deduct]
  );
  const net = totalPay - totalDeduct;

  function save() {
    setErr(null);
    start(async () => {
      const res = await savePayrollRecord({
        recordId: row.recordId,
        pay_items: pay.filter((i) => i.key && i.label),
        deduct_items: deduct.filter((i) => i.key && i.label),
      });
      if (res.ok) onSaved();
      else setErr(res.message);
    });
  }

  return (
    <div className="rounded-lg border border-hr-border bg-card p-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ItemColumn
          title="지급 내역"
          items={pay}
          setItems={setPay}
          total={totalPay}
          presets={PAY_ADDON_PRESETS}
        />
        <ItemColumn
          title="공제 내역"
          items={deduct}
          setItems={setDeduct}
          total={totalDeduct}
          presets={[]}
        />
      </div>

      <div className="mt-3 flex items-center justify-between rounded-md bg-navy px-3 py-2 text-white">
        <span className="text-sm font-bold">차인지급액</span>
        <span className="font-mono text-base font-bold">{formatKRW(net)}</span>
      </div>

      {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "저장 중…" : "명세서 저장"}
        </button>
      </div>
    </div>
  );
}

let _addSeq = 0;
function ItemColumn({
  title,
  items,
  setItems,
  total,
  presets,
}: {
  title: string;
  items: PayItem[];
  setItems: (next: PayItem[]) => void;
  total: number;
  presets: { key: string; label: string }[];
}) {
  const [presetKey, setPresetKey] = useState("");

  function patch(idx: number, next: Partial<PayItem>) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...next } : it)));
  }
  function remove(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }
  function addPreset() {
    if (!presetKey) return;
    const p = presets.find((x) => x.key === presetKey);
    if (!p) return;
    // 이미 있으면 중복 추가 안 함.
    if (items.some((it) => it.key === p.key)) {
      setPresetKey("");
      return;
    }
    setItems([...items, { key: p.key, label: p.label, amount: 0 }]);
    setPresetKey("");
  }
  function addCustom() {
    const label = prompt("항목 이름을 입력하세요");
    if (!label || !label.trim()) return;
    _addSeq += 1;
    setItems([
      ...items,
      { key: `custom_${_addSeq}`, label: label.trim(), amount: 0 },
    ]);
  }

  return (
    <div>
      <p className="mb-1 text-xs font-bold text-navy">{title}</p>
      <div className="space-y-1">
        {items.map((it, idx) => (
          <div key={`${it.key}-${idx}`} className="flex items-center gap-1.5">
            <input
              value={it.label}
              onChange={(e) => patch(idx, { label: e.target.value })}
              className={`${inCls} flex-1`}
            />
            <input
              type="number"
              value={it.amount || ""}
              onChange={(e) =>
                patch(idx, { amount: Number(e.target.value || 0) })
              }
              className={`${inCls} w-28 text-right font-mono`}
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded border border-stamp px-1.5 py-1 text-xs text-stamp hover:bg-stamp-soft"
              aria-label="삭제"
            >
              ×
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="py-2 text-center text-xs text-ink-hint">항목 없음</p>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        {presets.length > 0 && (
          <>
            <select
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
              className={`${inCls} flex-1`}
            >
              <option value="">추가 항목 프리셋…</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addPreset}
              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
            >
              추가
            </button>
          </>
        )}
        <button
          type="button"
          onClick={addCustom}
          className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
        >
          + 직접 추가
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-sm font-bold">
        <span className="text-navy">{title.startsWith("지급") ? "지급 총액" : "공제 총액"}</span>
        <span className="font-mono text-ink">{formatKRW(total)}</span>
      </div>
    </div>
  );
}

// =====================================================================
// 4대보험 EDI 업로드 패널 — 미리보기 → 적용
// =====================================================================
function EdiUploadPanel({
  year,
  month,
  onApplied,
}: {
  year: number;
  month: number;
  onApplied: () => void;
}) {
  const [fileType, setFileType] = useState<EdiFileType>("pension");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EdiPreviewResult | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setMsg(null);
    if (f) {
      const guessed = guessFileType(f.name);
      if (guessed) setFileType(guessed);
    }
  }

  function doPreview() {
    if (!file) {
      setMsg({ ok: false, text: "파일을 선택하세요." });
      return;
    }
    setMsg(null);
    start(async () => {
      const base64 = await fileToBase64(file);
      const res = await previewEdiUpload({ year, month, fileType, base64 });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        setPreview(null);
        return;
      }
      setPreview(res);
    });
  }

  function doApply() {
    if (!file) return;
    if (
      !confirm(
        `${EDI_FILE_TYPES.find((t) => t.value === fileType)?.label} 공제액을 ${year}년 ${month}월 급여설정에 반영할까요?`
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const base64 = await fileToBase64(file);
      const res = await applyEdiUpload({ year, month, fileType, base64 });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      const extra: string[] = [];
      if (res.unmatchedNames.length)
        extra.push(`미매칭 ${res.unmatchedNames.length}명(${res.unmatchedNames.join(", ")})`);
      if (res.needsRegen.length)
        extra.push(
          `초안 재생성 필요 ${res.needsRegen.length}명(${res.needsRegen.join(", ")})`
        );
      setMsg({
        ok: true,
        text: `${res.applied}명에게 반영했습니다.${
          extra.length ? " " + extra.join(" / ") : ""
        }`,
      });
      setPreview(null);
      setFile(null);
      onApplied();
    });
  }

  return (
    <section className={cardCls}>
      <h3 className="mb-1 text-sm font-bold text-ink">4대보험 EDI 업로드</h3>
      <p className="mb-3 text-xs text-ink-hint">
        EDI에서 받은 CSV(cp949)를 올리면 직원별 공제액이 자동 반영됩니다. 국민연금은
        결정보험료의 절반, 고용보험은 월평균보수월액×요율로 변환됩니다. 산재보험은
        공제 대상이 아닙니다.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-navy">
            파일 종류
          </label>
          <select
            value={fileType}
            onChange={(e) => setFileType(e.target.value as EdiFileType)}
            className={inCls}
          >
            {EDI_FILE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-navy">
            CSV 파일
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-body file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink-body"
          />
        </div>
        <button
          type="button"
          onClick={doPreview}
          disabled={pending || !file}
          className={btnSecondary}
        >
          미리보기
        </button>
      </div>

      {msg && (
        <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      {preview && preview.ok && (
        <div className="mt-4 space-y-3">
          {preview.warnings.length > 0 && (
            <p className={noticeWarning}>{preview.warnings.join(" / ")}</p>
          )}
          {preview.unmatchedNames.length > 0 && (
            <p className={noticeWarning}>
              매칭 안 되는 이름 {preview.unmatchedNames.length}명:{" "}
              {preview.unmatchedNames.join(", ")} (퇴직정산 등 — 반영되지 않음)
            </p>
          )}
          {preview.missingActiveNames.length > 0 && (
            <p className={noticeWarning}>
              재직 대상인데 파일에 없는 직원 {preview.missingActiveNames.length}명:{" "}
              {preview.missingActiveNames.join(", ")}
            </p>
          )}

          {preview.fileType === "accident" ? (
            <p className={noticeWarning}>
              산재보험은 급여 공제 대상이 아닙니다. (전액 사업주 부담)
            </p>
          ) : preview.diffs.length === 0 ? (
            <p className="text-sm text-ink-hint">변경할 항목이 없습니다.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={thCls}>직원</th>
                      <th className={thCls}>항목</th>
                      <th className={`${thCls} text-right`}>기존값</th>
                      <th className={`${thCls} text-right`}>새값</th>
                      <th className={`${thCls} text-right`}>차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.diffs.map((d, i) => (
                      <tr
                        key={`${d.name}-${d.key}-${i}`}
                        className={`border-b border-line/60 ${
                          !d.matched ? "opacity-50" : ""
                        }`}
                      >
                        <td className={tdCls}>
                          {d.name}
                          {!d.matched && (
                            <span className={`${badgeWarning} ml-1`}>미매칭</span>
                          )}
                        </td>
                        <td className={tdCls}>{d.label}</td>
                        <td className={`${tdCls} text-right font-mono`}>
                          {formatKRW(d.oldValue)}
                        </td>
                        <td className={`${tdCls} text-right font-mono`}>
                          {formatKRW(d.newValue)}
                        </td>
                        <td
                          className={`${tdCls} text-right font-mono ${
                            d.bigChange ? "font-bold text-stamp" : ""
                          }`}
                        >
                          {d.delta > 0 ? "+" : ""}
                          {formatKRW(d.delta)}
                          {d.bigChange && " ⚠"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={doApply}
                disabled={pending}
                className={btnPrimary}
              >
                {pending ? "적용 중…" : "이 내용으로 적용"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
