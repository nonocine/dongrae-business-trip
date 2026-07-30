"use client";

import { useMemo, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createInstructor,
  searchInstructors,
  type InstructorListRow,
  type InstructorHit,
} from "@/app/hr/saems/instructorActions";
import { SAEM_DOC_SLOTS } from "@/lib/saem";
import Button from "@/app/components/Button";
import RowChevron from "@/app/components/RowChevron";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  noticeError,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";
const TOTAL_SLOTS = SAEM_DOC_SLOTS.length;
// 다운로드 라우트(페이지 아님) — 변수로 두어 next 페이지링크 규칙 회피(전체 내비게이션 필요).
const EXPORT_HREF = "/hr/saems/instructors/export";
const BACKUP_HREF = "/hr/saems/instructors/backup-zip";

export default function InstructorsManager({
  instructors,
  isM0,
}: {
  instructors: InstructorListRow[];
  isM0: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const digits = kw.replace(/\D/g, "");
    if (!kw) return instructors;
    return instructors.filter(
      (i) =>
        i.name.toLowerCase().includes(kw) ||
        (digits && (i.phone ?? "").includes(digits))
    );
  }, [instructors, q]);

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·전화 검색"
            className={`${selCls} min-w-[200px] flex-1`}
          />
          <a href={EXPORT_HREF} className={btnSecondary}>
            엑셀 다운로드
          </a>
          {isM0 && (
            <a href={BACKUP_HREF} className={btnSecondary}>
              전체 백업(ZIP)
            </a>
          )}
          <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
            + 강사 등록
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-hint">
          전체 {instructors.length}명
          {q.trim() ? ` · 검색 결과 ${filtered.length}명` : ""}
          {isM0 && " · 전체 백업은 파일 수에 따라 수십 초 걸릴 수 있습니다."}
        </p>
      </section>

      <section className={cardCls}>
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-hint">
            강사가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>이름</th>
                  <th className={thCls}>전화</th>
                  <th className={thCls}>상태</th>
                  <th className={thCls}>가입</th>
                  <th className={`${thCls} text-right`}>서류</th>
                  <th className={`${thCls} text-right`}>프로그램</th>
                  <th className={`${thCls} w-6`} aria-label="이동" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => router.push(`/hr/saems/instructors/${i.id}`)}
                    className="group cursor-pointer border-b border-line/60 hover:bg-surface"
                  >
                    <td className={`${tdCls} font-medium text-ink`}>{i.name}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {i.phone ?? "-"}
                    </td>
                    <td className={tdCls}>
                      <span
                        className={i.status === "active" ? badgeSuccess : badgeNeutral}
                      >
                        {i.status === "active" ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className={tdCls}>
                      {!i.password_set_at ? (
                        <span className={badgeNeutral}>미가입</span>
                      ) : i.must_change_password ? (
                        <span className={badgeWarning}>임시비번</span>
                      ) : (
                        <span className={badgeSuccess}>가입완료</span>
                      )}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {i.docCount}/{TOTAL_SLOTS}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {i.programCount}
                    </td>
                    <td className={`${tdCls} pr-1 text-right`}>
                      <RowChevron />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <RegisterModal
          onClose={() => setOpen(false)}
          onCreated={(id) => router.push(`/hr/saems/instructors/${id}`)}
          onSelectExisting={(id) => router.push(`/hr/saems/instructors/${id}`)}
        />
      )}
    </div>
  );
}

function RegisterModal({
  onClose,
  onCreated,
  onSelectExisting,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onSelectExisting: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [holder, setHolder] = useState("");
  const [memo, setMemo] = useState("");
  const [hits, setHits] = useState<InstructorHit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [pending, start] = useTransition();

  // 이름·전화 입력 시 기존 강사 실시간 검색(디바운스). setState 는 타이머 콜백에서만.
  useEffect(() => {
    const q = (name.trim() || phone.trim()).trim();
    if (q.replace(/\s/g, "").length < 2) {
      const t0 = setTimeout(() => setHits([]), 0);
      return () => clearTimeout(t0);
    }
    const t = setTimeout(async () => {
      setHits(await searchInstructors(q));
    }, 300);
    return () => clearTimeout(t);
  }, [name, phone]);

  function create() {
    setErr(null);
    setDup(null);
    start(async () => {
      const res = await createInstructor({
        name,
        phone,
        email,
        bank_name: bankName,
        bank_account: bankAccount,
        account_holder: holder,
        memo,
      });
      if (!res.ok) {
        setErr(res.message);
        if (res.duplicate) setDup(res.duplicate);
        return;
      }
      onCreated(res.id);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">강사 등록</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-hint">
          이름·전화를 입력하면 기존 강사를 먼저 검색합니다. 목록에 있으면 선택하고,
          없을 때만 신규 등록하세요.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="이름 *">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inCls} />
          </Field>
          <Field label="전화(숫자)">
            <input
              value={phone}
              inputMode="numeric"
              onChange={(e) => setPhone(e.target.value)}
              className={inCls}
            />
          </Field>
        </div>

        {/* 기존 강사 검색 결과 */}
        {hits.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning-soft/40 p-2">
            <p className="mb-1 text-xs font-bold text-warning">
              이미 등록된 강사일 수 있습니다
            </p>
            <ul className="space-y-1">
              {hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {h.name}
                    <span className="ml-1.5 font-mono text-xs text-ink-hint">
                      {h.phone ?? "-"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectExisting(h.id)}
                    className="rounded border border-line px-2 py-0.5 text-xs text-navy hover:bg-surface"
                  >
                    선택
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="이메일">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inCls} />
          </Field>
          <Field label="은행">
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inCls} />
          </Field>
          <Field label="계좌번호">
            <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inCls} />
          </Field>
          <Field label="예금주">
            <input value={holder} onChange={(e) => setHolder(e.target.value)} className={inCls} />
          </Field>
          <Field label="메모" full>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className={inCls} />
          </Field>
        </div>

        {err && (
          <div className={`mt-3 ${noticeError}`}>
            {err}
            {dup && (
              <button
                type="button"
                onClick={() => onSelectExisting(dup.id)}
                className="ml-2 underline"
              >
                {dup.name} 선택
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={create} loading={pending}>
            {pending ? "등록 중…" : "신규 등록"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </div>
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
