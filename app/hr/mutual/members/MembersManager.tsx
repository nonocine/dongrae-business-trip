"use client";

// =====================================================================
// MU-1. 상조회 회원 탭 — 재직자 일괄 가입 / 상태 토글 / 회원 수 요약
//   * 생일·입사일은 인사기록에서 join 해 보여 준다(상조회에 중복 저장 안 함).
// =====================================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getMemberOverview,
  joinMembers,
  setMemberStatus,
  setMemberMemo,
  deleteMember,
  type MutualMemberOverview,
  type MutualMemberRow,
} from "@/app/hr/mutual/memberActions";
import {
  MUTUAL_FEE,
  MUTUAL_MEMBER_STATUS_LABEL,
  formatKRW,
  monthlyFeeAmount,
  type MutualMemberStatus,
} from "@/lib/mutual";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeNeutral,
  badgeDanger,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";
const selCls =
  "rounded-md border border-line bg-card px-2 py-1 text-xs text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

// "1984-02-24" → "2/24". 없으면 "-".
function monthDay(d: string | null): string {
  if (!d || d.length < 10) return "-";
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

export default function MembersManager({
  initial,
}: {
  initial: MutualMemberOverview;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [joinedOn, setJoinedOn] = useState(initial.today);
  const [showLeft, setShowLeft] = useState(false);
  const [memoFor, setMemoFor] = useState<MutualMemberRow | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function reload() {
    setData(await getMemberOverview());
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
      setMemoFor(null);
      await reload();
      router.refresh();
    });
  }

  // 가입 후보 = 재직자 중 아직 회원이 아닌 사람.
  const candidates = useMemo(
    () => data.rows.filter((r) => r.status == null && !r.resigned),
    [data.rows]
  );
  // 표시 대상 — 탈퇴자는 토글로 숨긴다(장부 이력 때문에 기록은 남는다).
  const visible = useMemo(
    () =>
      data.rows.filter((r) => {
        if (r.status === "left" || (r.resigned && r.status != null))
          return showLeft;
        // 미가입 재직자는 항상 보인다(가입 유도).
        return true;
      }),
    [data.rows, showLeft]
  );

  function toggle(empId: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(empId)) n.delete(empId);
      else n.add(empId);
      return n;
    });
  }
  function pickAllCandidates(on: boolean) {
    setPicked(on ? new Set(candidates.map((c) => c.employee_id)) : new Set());
  }

  function doJoin() {
    if (picked.size === 0) {
      setMsg({ ok: false, text: "가입할 직원을 선택하세요." });
      return;
    }
    setMsg(null);
    start(async () => {
      const res = await joinMembers({
        employeeIds: [...picked],
        joinedOn,
      });
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      const parts: string[] = [];
      if (res.added) parts.push(`신규 ${res.added}명`);
      if (res.reactivated) parts.push(`복귀 ${res.reactivated}명`);
      if (res.skipped) parts.push(`이미 활동중 ${res.skipped}명`);
      setMsg({
        ok: true,
        text: `가입 처리했습니다. (${parts.join(" · ") || "변경 없음"})`,
      });
      setPicked(new Set());
      await reload();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* 요약 */}
      <section className={cardCls}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="활동 회원" value={`${data.activeCount}명`} tone="navy" />
          <Stat label="일시정지" value={`${data.pausedCount}명`} />
          <Stat label="탈퇴" value={`${data.leftCount}명`} />
          <Stat label="미가입 재직자" value={`${data.notJoinedCount}명`} />
        </div>
        <p className="mt-2 text-xs text-ink-hint">
          이번 달 회비 예상 = 활동 회원 {data.activeCount}명 ×{" "}
          {formatKRW(MUTUAL_FEE)}원 ={" "}
          <b className="text-navy">
            {formatKRW(monthlyFeeAmount(data.activeCount))}원
          </b>{" "}
          · 생일·입사일은 인사기록카드에서 가져옵니다(상조회에 따로 저장하지
          않습니다).
        </p>
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 일괄 가입 */}
      {candidates.length > 0 && (
        <section className={cardCls}>
          <h3 className="mb-2 text-sm font-bold text-ink">
            미가입 재직자 {candidates.length}명
          </h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[11px] font-semibold text-navy">
                가입일
              </span>
              <input
                type="date"
                value={joinedOn}
                onChange={(e) => setJoinedOn(e.target.value)}
                className="mt-1 rounded-md border border-line bg-card px-2.5 py-1.5 text-sm shadow-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => pickAllCandidates(picked.size !== candidates.length)}
              className={btnSecondary}
            >
              {picked.size === candidates.length ? "선택 해제" : "전체 선택"}
            </button>
            <button
              type="button"
              onClick={doJoin}
              disabled={pending || picked.size === 0}
              className={btnPrimary}
            >
              가입 ({picked.size}명)
            </button>
          </div>
        </section>
      )}

      {/* 명단 */}
      <section className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">회원 명단</h3>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={showLeft}
              onChange={(e) => setShowLeft(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            탈퇴·퇴직자 표시
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={`${thCls} w-8`}></th>
                <th className={thCls}>이름</th>
                <th className={thCls}>직급</th>
                <th className={thCls}>생일</th>
                <th className={thCls}>입사일</th>
                <th className={thCls}>상조회</th>
                <th className={thCls}>가입일</th>
                <th className={thCls}>메모</th>
                <th className={`${thCls} text-right`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isCandidate = r.status == null && !r.resigned;
                return (
                  <tr
                    key={r.employee_id}
                    className={`border-b border-line/60 ${
                      r.status === "left" || (r.resigned && r.status)
                        ? "opacity-55"
                        : ""
                    }`}
                  >
                    <td className={tdCls}>
                      {isCandidate && (
                        <input
                          type="checkbox"
                          checked={picked.has(r.employee_id)}
                          onChange={() => toggle(r.employee_id)}
                          className="h-4 w-4"
                          aria-label={`${r.name} 가입 선택`}
                        />
                      )}
                    </td>
                    <td className={`${tdCls} font-medium text-ink`}>
                      {r.name}
                      {r.resigned && r.status && (
                        <span className={`ml-1.5 ${badgeNeutral}`}>퇴직</span>
                      )}
                    </td>
                    <td className={tdCls}>{r.rank ?? "-"}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {monthDay(r.birthDate)}
                    </td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {r.joinDate ?? "-"}
                    </td>
                    <td className={tdCls}>
                      {r.status == null ? (
                        <span className={badgeDanger}>미가입</span>
                      ) : (
                        <select
                          value={r.status}
                          disabled={pending}
                          onChange={(e) =>
                            run(
                              () =>
                                setMemberStatus({
                                  memberId: r.id!,
                                  status: e.target.value as MutualMemberStatus,
                                }),
                              `${r.name} 상태를 ${
                                MUTUAL_MEMBER_STATUS_LABEL[
                                  e.target.value as MutualMemberStatus
                                ]
                              }(으)로 바꿨습니다.`
                            )
                          }
                          className={selCls}
                        >
                          <option value="active">활동</option>
                          <option value="paused">일시정지</option>
                          <option value="left">탈퇴</option>
                        </select>
                      )}
                    </td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {r.joined_on ?? "-"}
                      {r.left_on && (
                        <span className="ml-1 text-ink-hint">
                          → {r.left_on}
                        </span>
                      )}
                    </td>
                    <td className={`${tdCls} max-w-[160px] truncate text-xs`}>
                      {r.memo ?? "-"}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {r.id && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setMsg(null);
                              setMemoFor(r);
                            }}
                            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                          >
                            메모
                          </button>
                          {r.ledgerCount === 0 && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => deleteMember(r.id!),
                                  `${r.name} 회원 기록을 삭제했습니다.`,
                                  `${r.name}의 상조회 회원 기록을 완전히 삭제할까요? (장부 이력이 없어 삭제 가능)`
                                )
                              }
                              className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-hint">
            표시할 직원이 없습니다.
          </p>
        )}
      </section>

      {memoFor && (
        <MemoModal
          row={memoFor}
          onClose={() => setMemoFor(null)}
          onSave={(memo) =>
            run(
              () => setMemberMemo({ memberId: memoFor.id!, memo }),
              "메모를 저장했습니다."
            )
          }
          pending={pending}
        />
      )}
    </div>
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
        tone === "navy" ? "border-navy/30 bg-navy-soft/30" : "border-line bg-surface/60"
      }`}
    >
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="mt-0.5 font-mono text-base font-bold text-ink">{value}</p>
    </div>
  );
}

function MemoModal({
  row,
  onClose,
  onSave,
  pending,
}: {
  row: MutualMemberRow;
  onClose: () => void;
  onSave: (memo: string | null) => void;
  pending: boolean;
}) {
  const [memo, setMemo] = useState(row.memo ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
        <h4 className="text-base font-bold text-ink">{row.name} 메모</h4>
        <p className="mt-1 text-xs text-ink-hint">
          가입 경위·미납 사유 등을 남겨 두세요.
        </p>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={4}
          className="mt-3 block w-full rounded-md border border-line bg-card px-2.5 py-2 text-sm shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onSave(memo.trim() ? memo : null)}
            disabled={pending}
            className={btnPrimary}
          >
            저장
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
