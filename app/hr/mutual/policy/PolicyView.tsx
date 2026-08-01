"use client";

// =====================================================================
// MU-5. [규정] 탭 — 상조회 규정 전문 게시 + 관리자 수정 + 금액표 자동 렌더링
//   * 금액표는 lib/mutual 의 MUTUAL_RULES 를 그대로 렌더링한다. 화면에 금액을
//     따로 적어 두지 않으므로 코드 상수가 유일한 출처다(규정 금액을 고치면
//     장부 프리셋·이 표가 동시에 바뀐다).
// =====================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMutualPolicy,
  type MutualPolicy,
  type PolicyRevision,
} from "@/app/hr/mutual/policyActions";
import {
  CHILDBIRTH_METHOD_LABEL,
  MUTUAL_FEE,
  MUTUAL_RULES,
  RETIREMENT_TIERS,
  SNACK_UNIT,
  YEAR_END_BONUS_MIN_BALANCE,
  YEAR_END_BONUS_UNIT,
  formatKRW,
  mutualCategories,
  type MutualCategory,
} from "@/lib/mutual";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeNavy,
  badgeNeutral,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-top text-sm text-ink-body";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

// 규정 금액표 한 줄의 "금액" 칸 — 산정방식별로 사람이 읽는 문장으로.
function amountText(c: MutualCategory): string {
  switch (c.rule.type) {
    case "fixed":
      return `${formatKRW(c.rule.amount)}원`;
    case "per_head":
      return c.key === "birthday_snack"
        ? `당일 근무인원 × ${formatKRW(SNACK_UNIT)}원 (생일자 수만큼 배수)`
        : `1인당 ${formatKRW(c.rule.unit)}원`;
    case "childbirth":
      return `${formatKRW(c.rule.base)}원 기준 · ${CHILDBIRTH_METHOD_LABEL.linear} 또는 ${CHILDBIRTH_METHOD_LABEL.double}`;
    case "tier":
      return RETIREMENT_TIERS.map(
        (t) => `${t.label} ${formatKRW(t.amount)}원`
      ).join(" / ") + " (그 외 구간은 담당 직접 입력)";
    case "free":
      return "실비·건별 (담당 입력)";
  }
}

export default function PolicyView({ initial }: { initial: MutualPolicy }) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial.text);
  const [revisions, setRevisions] = useState<PolicyRevision[]>(
    initial.revisions
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function addRevision() {
    setRevisions((prev) => [...prev, { date: "", label: "수정" }]);
  }
  function setRevision(i: number, p: Partial<PolicyRevision>) {
    setRevisions((prev) => prev.map((r, k) => (k === i ? { ...r, ...p } : r)));
  }
  function removeRevision(i: number) {
    setRevisions((prev) => prev.filter((_, k) => k !== i));
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveMutualPolicy({ text, revisions });
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      setPolicy({
        ...policy,
        text,
        revisions: [...revisions]
          .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.label.trim())
          .sort((a, b) => a.date.localeCompare(b.date)),
        isDefault: false,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
      setMsg({ ok: true, text: "규정을 저장했습니다." });
      router.refresh();
    });
  }

  function cancel() {
    setText(policy.text);
    setRevisions(policy.revisions);
    setEditing(false);
    setMsg(null);
  }

  return (
    <div className="space-y-5">
      {/* 규정 본문 */}
      <section className={cardCls}>
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink">상조회 규정</h3>
            {/* 제정·수정 이력 */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {policy.revisions.length === 0 ? (
                <span className="text-xs text-ink-hint">이력 없음</span>
              ) : (
                policy.revisions.map((r, i) => (
                  <span
                    key={`${r.date}-${i}`}
                    className={r.label === "제정" ? badgeNavy : badgeNeutral}
                  >
                    {r.date.replaceAll("-", ".")} {r.label}
                  </span>
                ))
              )}
            </div>
            {policy.updatedAt && (
              <p className="mt-1 text-[11px] text-ink-hint">
                최종 편집 {fmtKstDateTime(policy.updatedAt)}
                {policy.updatedBy ? ` · ${policy.updatedBy}` : ""}
              </p>
            )}
          </div>
          {policy.canManage && !editing && (
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                setEditing(true);
              }}
              className={btnSecondary}
            >
              수정
            </button>
          )}
        </div>

        {policy.isDefault && (
          <p className={`mb-3 ${noticeWarning}`}>
            아직 실제 규정 전문이 등록되지 않아 <b>기본 초안</b>을 보여 주고
            있습니다.
            {policy.canManage
              ? " [수정]을 눌러 실제 조문으로 바꿔 주세요."
              : " 상조회 담당자가 실제 조문을 등록하면 이 안내가 사라집니다."}
          </p>
        )}

        {msg && (
          <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        {editing ? (
          <div className="space-y-3">
            {/* 이력 편집 */}
            <div className="rounded-lg border border-navy/30 bg-navy-soft/20 p-3">
              <p className="mb-2 text-[11px] font-bold text-navy">
                제정·수정 이력
              </p>
              <div className="space-y-1.5">
                {revisions.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="date"
                      value={r.date}
                      onChange={(e) => setRevision(i, { date: e.target.value })}
                      className="rounded-md border border-line bg-card px-2 py-1 text-sm"
                    />
                    <select
                      value={r.label}
                      onChange={(e) => setRevision(i, { label: e.target.value })}
                      className="rounded-md border border-line bg-card px-2 py-1 text-sm"
                    >
                      <option value="제정">제정</option>
                      <option value="수정">수정</option>
                      <option value="전부개정">전부개정</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeRevision(i)}
                      className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addRevision}
                className="mt-2 text-xs font-semibold text-navy hover:underline"
              >
                + 이력 추가
              </button>
            </div>

            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                규정 전문
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={22}
                className={`${inCls} mt-1 font-mono text-[13px] leading-relaxed`}
              />
              <span className="mt-1 block text-[11px] text-ink-hint">
                줄바꿈은 그대로 보입니다. 금액표는 아래에서 코드 상수로 자동
                표시되니 본문에 금액을 다시 적지 않아도 됩니다.
              </span>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className={btnPrimary}
              >
                {pending ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={pending}
                className={btnSecondary}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface/40 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-body">
              {policy.text}
            </p>
          </div>
        )}
      </section>

      {/* 금액표 — MUTUAL_RULES 자동 렌더링(단일 출처) */}
      <section className={cardCls}>
        <h3 className="text-sm font-bold text-ink">별표 · 규정 금액표</h3>
        <p className="mt-1 text-xs text-ink-hint">
          아래 표는 코드의 규정 상수(<code>lib/mutual.ts</code> ·{" "}
          <code>MUTUAL_RULES</code>)를 그대로 표시합니다. 장부의 지출·세입 프리셋과
          같은 값이므로 화면과 계산이 어긋날 수 없습니다.
        </p>
        <p className="mt-1 text-xs text-ink-body">
          회비 <b className="text-navy">월 {formatKRW(MUTUAL_FEE)}원</b>{" "}
          (급여공제) · 연말 상여는 잔액{" "}
          {formatKRW(YEAR_END_BONUS_MIN_BALANCE)}원 이상일 때 1인당{" "}
          {formatKRW(YEAR_END_BONUS_UNIT)}원 제안
        </p>

        {(["expense", "income"] as const).map((kind) => (
          <div key={kind} className="mt-4">
            <p className="mb-1.5 text-xs font-bold text-navy">
              {kind === "expense" ? "세출 (지원 항목)" : "세입"}
            </p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] border-collapse">
                <thead className="bg-surface">
                  <tr>
                    <th className={thCls}>항목</th>
                    <th className={thCls}>금액</th>
                    <th className={thCls}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {mutualCategories(kind).map((c) => (
                    <tr key={c.key} className="border-t border-line/60">
                      <td className={`${tdCls} whitespace-nowrap font-medium text-ink`}>
                        {c.label}
                      </td>
                      <td className={`${tdCls} whitespace-normal`}>
                        {amountText(c)}
                      </td>
                      <td className={`${tdCls} text-xs text-ink-muted`}>
                        {c.note ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <p className="mt-3 text-[11px] text-ink-hint">
          ※ 항목 {MUTUAL_RULES.length}개. 출산 축하금 산정방식과 퇴사지원금 구간표는
          규정 확인 후 확정 예정입니다.
        </p>
      </section>
    </div>
  );
}
