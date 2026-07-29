"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateInstructor } from "@/app/hr/saems/instructorActions";
import {
  TERM_STATUS_LABEL,
  type SaemInstructor,
  type SaemInstructorDoc,
  type TermStatus,
} from "@/lib/saem";
import type { InstructorProgramRow } from "@/app/hr/saems/instructorActions";
import {
  cardCls,
  btnPrimary,
  badgeNavy,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function InstructorDetail({
  instructor,
  programs,
  docs,
  isM0,
}: {
  instructor: SaemInstructor;
  programs: InstructorProgramRow[];
  docs: SaemInstructorDoc[];
  isM0: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: instructor.name,
    phone: instructor.phone ?? "",
    email: instructor.email ?? "",
    bank_name: instructor.bank_name ?? "",
    bank_account: instructor.bank_account ?? "",
    account_holder: instructor.account_holder ?? "",
    memo: instructor.memo ?? "",
    status: instructor.status,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function patch(p: Partial<typeof f>) {
    setF((prev) => ({ ...prev, ...p }));
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateInstructor(instructor.id, f);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: "저장했습니다." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* 인적사항 */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {instructor.name}
            <span className="ml-2 align-middle">
              <span
                className={
                  instructor.password_set_at ? badgeSuccess : badgeNeutral
                }
              >
                {instructor.password_set_at ? "가입완료" : "미가입"}
              </span>
            </span>
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="이름">
            <input value={f.name} onChange={(e) => patch({ name: e.target.value })} className={inCls} />
          </Field>
          <Field label="전화(숫자)">
            <input
              value={f.phone}
              inputMode="numeric"
              onChange={(e) => patch({ phone: e.target.value })}
              className={inCls}
            />
          </Field>
          <Field label="이메일">
            <input value={f.email} onChange={(e) => patch({ email: e.target.value })} className={inCls} />
          </Field>
          <Field label="상태">
            <select
              value={f.status}
              onChange={(e) => patch({ status: e.target.value as "active" | "inactive" })}
              className={inCls}
            >
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
            </select>
          </Field>
          <Field label="은행">
            <input value={f.bank_name} onChange={(e) => patch({ bank_name: e.target.value })} className={inCls} />
          </Field>
          <Field label="계좌번호">
            <input value={f.bank_account} onChange={(e) => patch({ bank_account: e.target.value })} className={inCls} />
          </Field>
          <Field label="예금주">
            <input value={f.account_holder} onChange={(e) => patch({ account_holder: e.target.value })} className={inCls} />
          </Field>
          <Field label="메모" full>
            <input value={f.memo} onChange={(e) => patch({ memo: e.target.value })} className={inCls} />
          </Field>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
        )}
        <div className="mt-3">
          <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
            {pending ? "저장 중…" : "인적사항 저장"}
          </button>
        </div>
      </section>

      {/* 서류함·초대는 SA-3에서 추가 예정 */}
      <InviteAndDocsSlot instructorId={instructor.id} docs={docs} isM0={isM0} />

      {/* 담당 프로그램 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-base font-bold text-ink">
          담당 프로그램 ({programs.length})
        </h3>
        {programs.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">
            담당 프로그램이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {programs.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-line bg-card p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  <span className={badgeNavy}>
                    {p.projectName}
                    {p.projectName && p.termName ? " · " : ""}
                    {p.termName}
                  </span>
                  {p.termStatus && (
                    <span className={badgeNeutral}>
                      {TERM_STATUS_LABEL[p.termStatus as TermStatus] ?? p.termStatus}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-hint">
                  {p.period_no != null ? `${p.period_no}교시` : ""}
                  {p.time_start
                    ? ` · ${hhmm(p.time_start)}~${hhmm(p.time_end)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// SA-3에서 초대 링크·서류함 UI 로 대체됩니다(자리표시).
function InviteAndDocsSlot({
  docs,
}: {
  instructorId: string;
  docs: SaemInstructorDoc[];
  isM0: boolean;
}) {
  return (
    <section className={cardCls}>
      <p className="text-sm text-ink-hint">
        초대 링크 발급·서류함(현재 {docs.length}건)은 다음 커밋(SA-3)에서
        활성화됩니다.
      </p>
    </section>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-[11px] font-semibold text-navy">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
