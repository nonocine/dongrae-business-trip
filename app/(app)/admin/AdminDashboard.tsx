"use client";

import { useMemo, useState, useTransition } from "react";
import {
  addDriver,
  deleteDriver,
  resetEmployeePassword,
  restoreDriver,
  updateDriver,
} from "@/app/actions";
import {
  EMPLOYEE_RANKS,
  type Employee,
  type EmployeeRank,
} from "@/lib/supabase";
import {
  cardCls,
  inputCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";


// 직원 편집 행 전용 소형 입력
const smallInputCls =
  "block w-full rounded-md border border-line bg-card px-2 py-1 text-xs text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
// 표 안 소형 버튼
const rowBtnNeutral =
  "rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-surface disabled:opacity-60";

// =====================================================================
// 관리자 대시보드 ⑥ 직원 계정 관리 — 계정 추가·수정·비번 초기화·퇴사/복구.
//   2026-11 재정리: 활동일지 통계·최근 활동·활동 목록 탭은 대시보드에서 뺐습니다
//   (데이터·/activities 화면은 그대로). 남은 것은 계정 관리뿐이라 탭 없이 그립니다.
// =====================================================================
export default function AdminDashboard({ employees }: { employees: Employee[] }) {
  return <EmployeeTab employees={employees} />;
}

// =====================================================================
// 직원 관리 탭
// =====================================================================
function EmployeeTab({ employees }: { employees: Employee[] }) {
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () => (showInactive ? employees : employees.filter((e) => e.is_active)),
    [employees, showInactive]
  );
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <EmployeeListCard
        employees={visible}
        showInactive={showInactive}
        onToggle={setShowInactive}
      />
      <AddEmployeeCard />
    </div>
  );
}

function EmployeeListCard({
  employees,
  showInactive,
  onToggle,
}: {
  employees: Employee[];
  showInactive: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          직원 목록{" "}
          <span className="ml-1 text-xs font-medium text-ink-hint">
            {employees.length}명
          </span>
        </h3>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
          />
          퇴사자 보기
        </label>
      </div>
      {employees.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface p-4 text-center text-sm text-ink-muted">
          {showInactive
            ? "등록된 직원이 없습니다."
            : "활성 직원이 없습니다."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-surface text-xs uppercase text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">이름</th>
                <th className="px-3 py-2 text-left font-medium">직급</th>
                <th className="px-3 py-2 text-left font-medium">비밀번호</th>
                <th className="px-3 py-2 text-left font-medium">상태</th>
                <th className="px-3 py-2 text-right font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.map((e) => (
                <EmployeeRow key={e.id} employee={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmployeeRow({ employee }: { employee: Employee }) {
  const [editing, setEditing] = useState(false);
  const [rank, setRank] = useState<EmployeeRank | "">(
    (employee.rank as EmployeeRank | null) ?? ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [delPending, delTransition] = useTransition();
  const [restorePending, restoreTransition] = useTransition();
  const [resetPending, resetTransition] = useTransition();
  const [resetResult, setResetResult] = useState<{
    name: string;
    tempPassword: string;
  } | null>(null);

  function reset() {
    setEditing(false);
    setError(null);
    setPassword("");
    setRank((employee.rank as EmployeeRank | null) ?? "");
  }

  if (editing) {
    return (
      <tr className="bg-navy-soft">
        <td className="px-3 py-2 font-medium text-ink">{employee.name}</td>
        <td className="px-3 py-2">
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value as EmployeeRank)}
            className={smallInputCls}
          >
            <option value="" disabled>
              직급 선택
            </option>
            {EMPLOYEE_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="비밀번호 (변경 시)"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            className={smallInputCls}
          />
        </td>
        <td className="px-3 py-2 text-ink-muted" />
        <td className="px-3 py-2 text-right">
          <form
            action={(formData) => {
              setError(null);
              startTransition(async () => {
                try {
                  await updateDriver(formData);
                  reset();
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "수정 중 오류가 발생했습니다."
                  );
                }
              });
            }}
            className="inline-flex gap-1.5"
          >
            <input type="hidden" name="id" value={employee.id} />
            <input type="hidden" name="rank" value={rank} />
            <input type="hidden" name="password" value={password} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-navy-strong disabled:opacity-60"
            >
              {pending ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className={rowBtnNeutral}
            >
              취소
            </button>
          </form>
          {error && (
            <p className="mt-1 text-right text-xs text-stamp">{error}</p>
          )}
        </td>
      </tr>
    );
  }

  const inactive = !employee.is_active;

  return (
    <tr className={inactive ? "bg-surface text-ink-muted" : "hover:bg-surface"}>
      <td className="px-3 py-2 font-medium text-ink">
        {employee.name}
        {inactive && (
          <span className="ml-1 text-xs font-normal text-ink-hint">(퇴사)</span>
        )}
      </td>
      <td className="px-3 py-2 text-ink-body">{employee.rank ?? "-"}</td>
      {/* SEC-1: 비밀번호 값은 서버 밖으로 나오지 않습니다. 설정 여부만 표시. */}
      <td className="px-3 py-2 text-ink-muted">
        {employee.has_password ? "설정됨" : "미설정"}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className={inactive ? badgeNeutral : badgeSuccess}>
          {inactive ? "퇴사" : "활성"}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {inactive ? (
          <form
            action={(formData) => {
              if (!confirm(`${employee.name} 직원을 복귀시키시겠습니까?`)) return;
              restoreTransition(async () => {
                await restoreDriver(formData);
              });
            }}
            className="inline-block"
          >
            <input type="hidden" name="id" value={employee.id} />
            <button
              type="submit"
              disabled={restorePending}
              className="rounded-md border border-success bg-card px-2.5 py-1 text-xs font-medium text-success hover:bg-success-soft disabled:opacity-60"
            >
              {restorePending ? "복귀 중…" : "복귀"}
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`mr-1.5 ${rowBtnNeutral}`}
            >
              수정
            </button>
            <button
              type="button"
              disabled={resetPending}
              onClick={() => {
                if (
                  !confirm(
                    `${employee.name} 직원의 비밀번호를 임시 비번으로 재설정하시겠습니까?\n직원은 다음 로그인 시 새 비밀번호를 설정해야 합니다.`
                  )
                )
                  return;
                resetTransition(async () => {
                  const fd = new FormData();
                  fd.set("id", employee.id);
                  const res = await resetEmployeePassword(fd);
                  if (res.ok) {
                    setResetResult({
                      name: res.name,
                      tempPassword: res.tempPassword,
                    });
                  } else {
                    alert(res.message);
                  }
                });
              }}
              className="mr-1.5 rounded-md border border-warning bg-card px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning-soft disabled:opacity-60"
            >
              {resetPending ? "재설정 중…" : "비번 재설정"}
            </button>
            <form
              action={(formData) => {
                if (
                  !confirm(
                    `${employee.name} 직원을 퇴사 처리하시겠습니까?\n(소프트 삭제 — 복귀 가능)`
                  )
                )
                  return;
                delTransition(async () => {
                  await deleteDriver(formData);
                });
              }}
              className="inline-block"
            >
              <input type="hidden" name="id" value={employee.id} />
              <button
                type="submit"
                disabled={delPending}
                className="rounded-md border border-stamp bg-card px-2.5 py-1 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
              >
                {delPending ? "퇴사 처리 중…" : "퇴사"}
              </button>
            </form>
            {resetResult && (
              <ResetPasswordModal
                name={resetResult.name}
                tempPassword={resetResult.tempPassword}
                onClose={() => setResetResult(null)}
              />
            )}
          </>
        )}
      </td>
    </tr>
  );
}

// =====================================================================
// 임시 비밀번호 발급 결과 모달
// =====================================================================
function ResetPasswordModal({
  name,
  tempPassword,
  onClose,
}: {
  name: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-line bg-card p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-ink">
          🔑 임시 비밀번호 발급 완료
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          <span className="font-medium text-ink-body">{name}</span> 직원에게
          아래 임시 비밀번호를 직접 전달해주세요.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-lg font-bold tracking-widest text-ink">
            {tempPassword}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white hover:bg-navy-strong"
          >
            {copied ? "복사됨" : "복사"}
          </button>
        </div>

        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          직원이 이 비밀번호로 로그인하면 즉시 새 비밀번호를 설정해야 합니다.
        </p>

        <button
          type="button"
          onClick={onClose}
          className={`mt-3 w-full ${btnSecondary}`}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

function AddEmployeeCard() {
  const [name, setName] = useState("");
  const [rank, setRank] = useState<EmployeeRank | "">("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const passwordValid = /^\d{4}$/.test(password);

  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">직원 추가</h3>
      <p className="mt-1 text-xs text-ink-muted">
        등록하면 활동자 드롭다운 + 직원 로그인이 가능해집니다.
      </p>
      <form
        action={(formData) => {
          setError(null);
          setOk(null);
          if (!name.trim()) {
            setError("이름을 입력해주세요.");
            return;
          }
          if (!rank) {
            setError("직급을 선택해주세요.");
            return;
          }
          if (!passwordValid) {
            setError("4자리 숫자 비밀번호를 입력해주세요.");
            return;
          }
          startTransition(async () => {
            try {
              await addDriver(formData);
              setOk(`${name.trim()} 추가됨`);
              setName("");
              setRank("");
              setPassword("");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "추가 중 오류가 발생했습니다."
              );
            }
          });
        }}
        className="mt-3 space-y-2"
      >
        <div>
          <label className="block text-xs font-medium text-ink-muted">
            이름
          </label>
          <input
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">
            직급
          </label>
          <select
            name="rank"
            required
            value={rank}
            onChange={(e) => setRank(e.target.value as EmployeeRank)}
            className={inputCls}
          >
            <option value="" disabled>
              직급을 선택해주세요
            </option>
            {EMPLOYEE_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">
            비밀번호 (4자리 숫자)
          </label>
          <input
            name="password"
            type="text"
            inputMode="numeric"
            maxLength={4}
            required
            placeholder="0000"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            className={`${inputCls} font-mono tracking-widest`}
          />
          {password.length > 0 && !passwordValid && (
            <p className="mt-1 text-xs text-stamp">4자리 숫자를 입력하세요.</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className={`${btnPrimary} mt-2 w-full`}
        >
          {pending ? "추가 중…" : "＋ 추가"}
        </button>
      </form>
      {error && <p className={`mt-2 ${noticeError}`}>{error}</p>}
      {ok && <p className={`mt-2 ${noticeSuccess}`}>{ok}</p>}
    </section>
  );
}
