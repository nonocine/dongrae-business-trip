"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateInstructor,
  generateInvite,
  generateTempPassword,
  uploadInstructorDoc,
  getInstructorDocUrl,
  deleteInstructorDoc,
  checkInstructorDeletable,
  deleteInstructor,
  type InstructorInput,
  type InstructorDeletability,
} from "@/app/hr/saems/instructorActions";
import {
  TERM_STATUS_LABEL,
  SAEM_DOC_SLOTS,
  type SaemInstructor,
  type SaemInstructorDoc,
  type TermStatus,
} from "@/lib/saem";
import type { InstructorProgramRow } from "@/app/hr/saems/instructorActions";
import {
  CRIME_CHECK_SLOT,
  crimeCheckState,
  crimeCheckLabel,
  isCrimeCheckOverdue,
} from "@/lib/saemDocExpiry";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeNavy,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  badgeDanger,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function InstructorDetail({
  instructor,
  programs,
  docs,
  isM0,
  today,
}: {
  instructor: SaemInstructor;
  programs: InstructorProgramRow[];
  docs: SaemInstructorDoc[];
  isM0: boolean;
  today: string; // KST 오늘(서버 계산) — 만료 판정 기준
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
              {!instructor.password_set_at ? (
                <span className={badgeNeutral}>미가입</span>
              ) : instructor.must_change_password ? (
                <span className={badgeWarning}>임시비번</span>
              ) : (
                <span className={badgeSuccess}>가입완료</span>
              )}
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

      {/* 초대 링크 / 임시비밀번호 */}
      <InviteSection
        instructorId={instructor.id}
        name={instructor.name}
        alreadyRegistered={!!instructor.password_set_at}
      />

      {/* 서류함 */}
      <DocsSection instructorId={instructor.id} docs={docs} today={today} />

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

      {/* 강사 삭제 — M0 전용. 기록 있으면 삭제 불가·비활성 유도. */}
      {isM0 && (
        <DeleteSection
          instructorId={instructor.id}
          instructorName={instructor.name}
          alreadyInactive={f.status === "inactive"}
          form={f}
        />
      )}
    </div>
  );
}

// --- 강사 삭제 구역(M0 전용) ---
function DeleteSection({
  instructorId,
  instructorName,
  alreadyInactive,
  form,
}: {
  instructorId: string;
  instructorName: string;
  alreadyInactive: boolean;
  form: InstructorInput & { status: "active" | "inactive" };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<InstructorDeletability | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function openModal() {
    setErr(null);
    setNameInput("");
    setD(null);
    setOpen(true);
    start(async () => {
      const res = await checkInstructorDeletable(instructorId);
      setD(res);
    });
  }
  function confirmDelete() {
    setErr(null);
    start(async () => {
      const res = await deleteInstructor(instructorId, nameInput.trim());
      if (!res.ok) {
        setErr(res.message);
        if (res.deletability) setD(res.deletability);
        return;
      }
      router.push("/hr/saems/instructors");
      router.refresh();
    });
  }
  function deactivate() {
    setErr(null);
    start(async () => {
      const res = await updateInstructor(instructorId, {
        ...form,
        status: "inactive",
      });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const nameOk = nameInput.trim() === instructorName.trim();

  return (
    <section className={cardCls}>
      <h3 className="text-base font-bold text-stamp">강사 삭제</h3>
      <p className="mt-1 text-xs text-ink-hint">
        배정 프로그램·서류·제출한 근무일지가 하나도 없는 강사만 완전히 삭제할 수
        있습니다. 기록이 있으면 삭제 대신 비활성 처리하세요.
      </p>
      <div className="mt-3">
        <button type="button" onClick={openModal} className={btnDanger}>
          강사 삭제
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">강사 삭제</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-ink-muted hover:underline"
              >
                닫기
              </button>
            </div>

            {d === null ? (
              <p className="py-4 text-center text-sm text-ink-muted">
                삭제 가능 여부 확인 중…
              </p>
            ) : d.deletable ? (
              <>
                <p className={noticeWarning}>
                  {instructorName} 선생님을 완전히 삭제합니다. 되돌릴 수 없습니다.
                </p>
                <label className="mt-3 block text-[11px] font-semibold text-navy">
                  확인을 위해 이름(<b>{instructorName}</b>)을 입력하세요
                </label>
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className={`${inCls} mt-1`}
                  placeholder={instructorName}
                />
                {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={pending || !nameOk}
                    className={btnDanger}
                  >
                    {pending ? "삭제 중…" : "완전히 삭제"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={btnSecondary}
                  >
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={noticeError}>
                  배정 프로그램 {d.programs}건 / 서류 {d.docs}건 / 제출 일지{" "}
                  {d.submittedLogs}건 이 있어 삭제할 수 없습니다.
                </p>
                <p className="mt-3 text-sm text-ink-body">
                  기록 보존을 위해 삭제 대신 <b>비활성 처리</b>하세요. 비활성
                  강사는 목록에서 기본 숨김됩니다.
                </p>
                {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
                <div className="mt-4 flex gap-2">
                  {alreadyInactive ? (
                    <span className={`${badgeNeutral} self-center`}>
                      이미 비활성
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={deactivate}
                      disabled={pending}
                      className={btnPrimary}
                    >
                      {pending ? "처리 중…" : "비활성으로 전환"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={btnSecondary}
                  >
                    닫기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// --- 초대 링크 / 임시비밀번호 발급 ---
function InviteSection({
  instructorId,
  name,
  alreadyRegistered,
}: {
  instructorId: string;
  name: string;
  alreadyRegistered: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tempOpen, setTempOpen] = useState(false);
  const [pending, start] = useTransition();

  function issue() {
    setErr(null);
    setCopied(false);
    start(async () => {
      const res = await generateInvite(instructorId);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setUrl(res.url);
      setReset(res.alreadyRegistered);
    });
  }

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">온보딩(로그인 준비)</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={issue} disabled={pending} className={btnPrimary}>
            {pending ? "발급 중…" : "초대 링크 발급"}
          </button>
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setTempOpen(true);
            }}
            className={btnSecondary}
          >
            임시비밀번호 발급
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-hint">
        초대 링크: 강사가 직접 비번 설정(유효 7일). 임시비밀번호: 직원이 임시비번을
        걸어주고 전화번호+임시비번으로 로그인하게 안내(첫 로그인 시 비번 변경 강제).
      </p>

      {(alreadyRegistered || reset) && (
        <p className={`mt-3 ${noticeWarning}`}>
          이미 가입한 강사입니다 — 초대 링크는 <b>비밀번호 재설정</b> 링크로 동작합니다.
        </p>
      )}

      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

      {url && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className={`${inCls} min-w-[240px] flex-1 font-mono text-xs`}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className={btnSecondary}
          >
            {copied ? "복사됨 ✓" : "복사"}
          </button>
        </div>
      )}

      {tempOpen && (
        <TempPasswordModal
          instructorId={instructorId}
          name={name}
          onClose={() => setTempOpen(false)}
          onDone={() => router.refresh()}
        />
      )}
    </section>
  );
}

function TempPasswordModal({
  instructorId,
  name,
  onClose,
  onDone,
}: {
  instructorId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pw, setPw] = useState("0000");
  const [err, setErr] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    if (pw.trim().length < 4) {
      setErr("임시비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    start(async () => {
      const res = await generateTempPassword(instructorId, pw.trim());
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setGuide(
        `${name} 강사님께 안내: 동래샘들(${res.appUrl}) 에서 전화번호 + 임시비밀번호 "${pw.trim()}" 로 로그인한 뒤, 안내에 따라 새 비밀번호를 설정하세요.`
      );
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">임시비밀번호 발급</h3>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>

        {guide ? (
          <>
            <p className={`${noticeSuccess}`}>임시비밀번호를 설정했습니다.</p>
            <textarea
              readOnly
              value={guide}
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
              className={`${inCls} mt-3 text-xs`}
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(guide);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                className={btnPrimary}
              >
                {copied ? "복사됨 ✓" : "안내문 복사"}
              </button>
              <button type="button" onClick={onClose} className={btnSecondary}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-hint">
              임시비밀번호를 걸어주면 강사가 전화번호+임시비번으로 로그인하고, 첫
              로그인 시 새 비밀번호를 강제로 설정합니다. (원문은 저장하지 않으므로 이
              화면의 안내문을 강사에게 그대로 전달하세요.)
            </p>
            <label className="block text-[11px] font-semibold text-navy">
              임시비밀번호 (4자 이상)
            </label>
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className={`${inCls} mt-1`}
            />
            {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={submit} disabled={pending} className={btnPrimary}>
                {pending ? "발급 중…" : "임시비번 설정"}
              </button>
              <button type="button" onClick={onClose} className={btnSecondary}>
                취소
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 서류 출처 라벨 — 자동생성/강사 업로드/직원 업로드 구분.
function docSource(doc: SaemInstructorDoc): string {
  if ((doc.original_name ?? "").includes("자동생성")) return "자동 생성";
  return doc.uploaded_by === "instructor" ? "강사 업로드" : "직원 업로드";
}

// --- 서류함(7슬롯) ---
function DocsSection({
  instructorId,
  docs,
  today,
}: {
  instructorId: string;
  docs: SaemInstructorDoc[];
  today: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // 성범죄경력조회 발급일 — 이 슬롯만 필수. 파일 선택 전에 먼저 받는다.
  const [issuedOn, setIssuedOn] = useState("");

  const bySlot = new Map(docs.map((d) => [d.slot, d]));
  const crimeDoc = bySlot.get(CRIME_CHECK_SLOT) ?? null;
  const crime = crimeCheckState(crimeDoc?.issued_on ?? null, today);

  function pick(slotKey: string) {
    if (slotKey === CRIME_CHECK_SLOT && !issuedOn) {
      setMsg({
        ok: false,
        text: "성범죄경력조회는 발급일을 먼저 입력하세요.",
      });
      return;
    }
    setSlot(slotKey);
    setMsg(null);
    fileRef.current?.click();
  }
  function onFile(file: File) {
    if (!slot) return;
    setBusy(slot);
    start(async () => {
      const fd = new FormData();
      fd.set("instructor_id", instructorId);
      fd.set("slot", slot);
      fd.set("file", file);
      if (slot === CRIME_CHECK_SLOT) fd.set("issued_on", issuedOn);
      const res = await uploadInstructorDoc(fd);
      setBusy(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setIssuedOn("");
      setMsg({ ok: true, text: "업로드했습니다." });
      router.refresh();
    });
  }
  function view(docId: string) {
    start(async () => {
      const u = await getInstructorDocUrl(docId);
      if (u) window.open(u, "_blank", "noopener,noreferrer");
      else setMsg({ ok: false, text: "파일을 찾을 수 없습니다." });
    });
  }
  function remove(docId: string) {
    if (!confirm("이 서류를 삭제할까요?")) return;
    setBusy(docId);
    start(async () => {
      const res = await deleteInstructorDoc(docId);
      setBusy(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: "삭제했습니다." });
      router.refresh();
    });
  }

  return (
    <section className={cardCls}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">서류함</h3>
        <a
          href={`/hr/saems/instructors/${instructorId}/documents-zip`}
          className="rounded border border-line px-2.5 py-1 text-xs font-semibold text-navy hover:bg-surface"
        >
          전체 다운로드(ZIP)
        </a>
      </div>
      <p className="mb-3 text-xs text-ink-hint">
        PDF·JPG·PNG·WEBP, 16MB 이하. 슬롯당 1건(업로드 시 교체). 비공개 저장.
        강사가 동래샘들 앱에서 직접 올리거나 이력서를 자동 생성할 수도 있습니다.
      </p>
      {msg && (
        <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
      )}
      <ul className="divide-y divide-line/60">
        {SAEM_DOC_SLOTS.map((sl) => {
          const doc = bySlot.get(sl.key);
          const rowBusy = pending && (busy === sl.key || (doc && busy === doc.id));
          return (
            <li key={sl.key} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-ink">{sl.label}</span>
                {doc ? (
                  <span className="ml-2 truncate text-xs text-ink-hint">
                    {doc.original_name ?? "업로드됨"} · {docSource(doc)}
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-ink-hint">미제출</span>
                )}
                {/* 성범죄경력조회 — 발급일·만료일과 상태를 함께 보여준다. */}
                {sl.key === CRIME_CHECK_SLOT && (
                  <div className="mt-1">
                    {crime.issuedOn ? (
                      <p className="text-[11px] text-ink-muted">
                        발급일 {crime.issuedOn} · 만료일 {crime.expiresOn}
                        <span
                          className={`ml-1.5 ${
                            isCrimeCheckOverdue(crime.status)
                              ? "font-semibold text-stamp"
                              : crime.status === "warning"
                                ? "font-semibold text-warning"
                                : "text-ink-hint"
                          }`}
                        >
                          ({crimeCheckLabel(crime)})
                        </span>
                      </p>
                    ) : (
                      <p className="text-[11px] font-semibold text-stamp">
                        {doc
                          ? "발급일이 없습니다 — 만료 추적이 안 됩니다. 발급일과 함께 다시 올려주세요."
                          : "1년마다 갱신이 필요한 법정 서류입니다."}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <label className="text-[11px] font-semibold text-navy">
                        발급일
                      </label>
                      <input
                        type="date"
                        value={issuedOn}
                        max={today}
                        onChange={(e) => setIssuedOn(e.target.value)}
                        className="rounded-md border border-line bg-card px-2 py-1 text-[11px] text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                      />
                      <span className="text-[11px] text-ink-hint">
                        입력 후 {doc ? "교체" : "업로드"} 버튼을 누르세요(필수).
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {doc ? (
                  <>
                    {sl.key === CRIME_CHECK_SLOT ? (
                      <span
                        className={
                          isCrimeCheckOverdue(crime.status)
                            ? badgeDanger
                            : crime.status === "warning"
                              ? badgeWarning
                              : badgeSuccess
                        }
                      >
                        {crime.status === "ok" ? "제출" : crimeCheckLabel(crime)}
                      </span>
                    ) : (
                      <span className={badgeSuccess}>제출</span>
                    )}
                    <button
                      type="button"
                      onClick={() => view(doc.id)}
                      disabled={pending}
                      className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50"
                    >
                      보기
                    </button>
                    <button
                      type="button"
                      onClick={() => pick(sl.key)}
                      disabled={rowBusy}
                      className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50"
                    >
                      교체
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(doc.id)}
                      disabled={rowBusy}
                      className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => pick(sl.key)}
                    disabled={rowBusy}
                    className="rounded border border-navy px-2.5 py-1 text-xs font-semibold text-navy hover:bg-navy-soft disabled:opacity-50"
                  >
                    {rowBusy ? "업로드 중…" : "업로드"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
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
