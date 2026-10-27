"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAbsence,
  createAbsenceFileUpload,
  createPhoneAbsence,
  finalizeAbsenceFile,
  rejectAbsence,
  teacherCheckAbsence,
} from "@/app/(app)/bangka/absences/actions";
import { uploadToSlot } from "@/app/(app)/bangka/uploadClient";
import {
  ABSENCE_CONFIRMER_LABEL,
  ABSENCE_REASONS,
  ABSENCE_STATUS_LABEL,
  absencePeriodLabel,
  absenceReasonLabel,
  type AbsenceStatus,
  type AbsenceView,
} from "@/lib/bangkaAbsence";
import { BK_SCOPE_LABEL, fmtKstShort, shiftYm, type BkScope } from "@/lib/bangkaContent";
import {
  badgeDanger,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  panelToneCls,
  sectionTitleCls,
  tabItemCls,
} from "@/lib/ui";

// =====================================================================
// 공결 처리 — 신청 목록 → [담임 확인] → [팀장 결재] / [반려(사유)].
//   · 결재는 앱 기록만 남깁니다(공결확인서 양식에는 결재란이 없음).
//   · [공결확인서 PDF]: 원본 양식에 찍고 증빙자료를 뒤 장으로 붙인 한 파일.
//   · [전화 공결 입력]: 보호자 전화를 받은 직원이 적습니다(확인자=선생님, 받은 직원 기록)
//     → 전화공결관리대장 탭에 모이고 엑셀로 내려받을 수 있습니다.
// =====================================================================

type Student = { id: string; name: string; school: string | null; grade: string | null; class_code: string };

const STATUS_BADGE: Record<AbsenceStatus, string> = {
  submitted: badgeWarning,
  teacher_checked: badgeNavy,
  approved: badgeSuccess,
  rejected: badgeDanger,
  cancelled: badgeNeutral,
};

export default function AbsencesManager({
  view,
  ym,
  rows,
  students,
  canApprove,
  todayYmd,
}: {
  view: "pending" | "all" | "phone";
  ym: string | null;
  rows: AbsenceView[];
  students: Student[];
  canApprove: boolean;
  todayYmd: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const href = (v: string, m: string | null) => `/bangka/absences?view=${v}${m ? `&ym=${m}` : ""}`;
  const monthNav = ym ?? todayYmd.slice(0, 7);

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} space-y-3`}>
        <div className="flex flex-wrap items-center gap-1">
          <Link href={href("pending", null)} className={tabItemCls(view === "pending")}>
            처리할 공결
          </Link>
          <Link href={href("all", monthNav)} className={tabItemCls(view === "all")}>
            전체(월별)
          </Link>
          <Link href={href("phone", monthNav)} className={tabItemCls(view === "phone")}>
            전화공결관리대장
          </Link>
          <button type="button" onClick={() => setPhoneOpen((v) => !v)} className={`ml-auto ${phoneOpen ? btnSecondary : btnPrimary}`}>
            {phoneOpen ? "닫기" : "전화 공결 입력"}
          </button>
        </div>
        {view !== "pending" && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href(view, shiftYm(monthNav, -1))} className={btnSecondary}>
              ◀
            </Link>
            <span className="min-w-[6rem] text-center font-bold text-ink">
              {monthNav.slice(0, 4)}년 {Number(monthNav.slice(5))}월
            </span>
            <Link href={href(view, shiftYm(monthNav, 1))} className={btnSecondary}>
              ▶
            </Link>
            {view === "phone" && (
              <a href={`/bangka/absences/ledger?ym=${monthNav}`} className={`ml-auto ${btnSecondary}`}>
                대장 엑셀 내려받기
              </a>
            )}
          </div>
        )}
        <p className="text-xs text-ink-muted">
          담임 확인은 방과후아카데미 담당자 누구나, 팀장 결재·반려(담임 확인 뒤)는 관장·부장·팀장이 합니다.
          {canApprove ? " 지금 로그인한 계정은 결재할 수 있습니다." : ""}
        </p>
      </div>

      {phoneOpen && (
        <PhoneAbsenceForm
          students={students}
          todayYmd={todayYmd}
          onDone={(id) => {
            setPhoneOpen(false);
            setOpenId(id);
            router.push(href("phone", todayYmd.slice(0, 7)));
            router.refresh();
          }}
        />
      )}

      <div className={panelToneCls("green")}>
        <h3 className={sectionTitleCls("green")}>
          {view === "pending" ? "처리할 공결" : view === "phone" ? "전화공결관리대장" : "공결 신청"} ({rows.length})
        </h3>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">{view === "pending" ? "처리할 공결 신청이 없습니다." : "이 달 공결이 없습니다."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left text-sm"
                >
                  <span className={STATUS_BADGE[r.status]}>{ABSENCE_STATUS_LABEL[r.status]}</span>
                  <b className="text-ink">{r.student?.name ?? "(학생 없음)"}</b>
                  <span className="text-ink-muted">{r.student ? BK_SCOPE_LABEL[r.student.class_code as BkScope] ?? r.student.class_code : ""}</span>
                  <span className="text-ink">{absencePeriodLabel(r.start_date, r.end_date)}</span>
                  <span className="text-ink-muted">{absenceReasonLabel(r.reason_type)}</span>
                  {r.channel === "phone" && <span className={badgeNeutral}>전화 · {r.received_by}</span>}
                  <span className="ml-auto text-xs text-ink-muted">{fmtKstShort(r.created_at)}</span>
                </button>
                {openId === r.id && <AbsenceDetail row={r} canApprove={canApprove} onChanged={() => router.refresh()} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AbsenceDetail({ row: r, canApprove, onChanged }: { row: AbsenceView; canApprove: boolean; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.message ?? "처리하지 못했습니다." });
      if (res.ok) {
        setRejecting(false);
        onChanged();
      }
    });

  function addFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    start(async () => {
      try {
        for (const f of files) {
          const slot = await createAbsenceFileUpload({ absenceId: r.id, name: f.name, mime: f.type, size: f.size });
          if (!slot.ok) throw new Error(slot.message);
          await uploadToSlot(slot, f);
          const fin = await finalizeAbsenceFile({ absenceId: r.id, path: slot.path, name: f.name, mime: f.type });
          if (!fin.ok) throw new Error(fin.message);
        }
        setMsg({ ok: true, text: `증빙 ${files.length}개를 올렸습니다.` });
        onChanged();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "증빙을 올리지 못했습니다." });
      }
    });
  }

  const canReject = r.status === "submitted" || (r.status === "teacher_checked" && canApprove);
  return (
    <div className="mb-3 space-y-3 rounded-lg border border-rule bg-card p-3 text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[7rem_1fr]">
        <dt className="text-ink-muted">학생</dt>
        <dd>
          {r.student?.name} · {[r.student?.school, r.student?.grade].filter(Boolean).join(" ")}
        </dd>
        <dt className="text-ink-muted">기간</dt>
        <dd>{absencePeriodLabel(r.start_date, r.end_date)}</dd>
        <dt className="text-ink-muted">사유</dt>
        <dd className="whitespace-pre-wrap">
          [{absenceReasonLabel(r.reason_type)}] {r.reason ?? ""}
        </dd>
        <dt className="text-ink-muted">확인자</dt>
        <dd>
          {ABSENCE_CONFIRMER_LABEL[r.confirmer_type]}
          {r.confirmer_other ? `(${r.confirmer_other})` : ""} {r.confirmer_name} · {r.channel === "phone" ? `전화 접수(${r.received_by})` : "앱 신청"}
        </dd>
        <dt className="text-ink-muted">처리</dt>
        <dd>
          {r.teacher_checked_by ? `담임 확인 ${r.teacher_checked_by} (${fmtKstShort(r.teacher_checked_at ?? "")})` : "담임 확인 전"}
          {r.status === "approved" && ` · 결재 ${r.approved_by} (${fmtKstShort(r.approved_at ?? "")})`}
          {r.status === "rejected" && ` · 반려 ${r.approved_by}: ${r.reject_reason}`}
          {r.status === "cancelled" && " · 보호자가 취소"}
        </dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        {r.signatureUrl && (
          <a href={r.signatureUrl} target="_blank" rel="noopener noreferrer" className="block rounded border border-rule bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.signatureUrl} alt="확인자 서명" className="h-12 w-auto" />
          </a>
        )}
        {r.files.map((f) =>
          f.url ? (
            <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className={`${linkCls} text-xs`}>
              📎 {f.name ?? "증빙"}
            </a>
          ) : null,
        )}
        {r.files.length === 0 && <span className="text-xs text-stamp">증빙자료가 없습니다 — 공결확인서에는 증빙을 꼭 첨부해야 합니다.</span>}
      </div>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {r.status === "submitted" && (
          <button type="button" disabled={pending} onClick={() => run(() => teacherCheckAbsence(r.id), "담임 확인했습니다.")} className={btnPrimary}>
            담임 확인
          </button>
        )}
        {r.status === "teacher_checked" && canApprove && (
          <button type="button" disabled={pending} onClick={() => run(() => approveAbsence(r.id), "결재했습니다.")} className={btnPrimary}>
            팀장 결재
          </button>
        )}
        {canReject && !rejecting && (
          <button type="button" disabled={pending} onClick={() => setRejecting(true)} className={btnDanger}>
            반려
          </button>
        )}
        <a href={`/bangka/absences/${r.id}/pdf`} className={btnSecondary}>
          공결확인서 PDF
        </a>
        {r.status !== "cancelled" && (
          <label className={`${btnSecondary} cursor-pointer`}>
            증빙 추가
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" disabled={pending} onChange={(e) => addFiles(e.target.files)} />
          </label>
        )}
      </div>
      {rejecting && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[16rem] flex-1">
            <span className={labelCls}>반려 사유(보호자 앱에 보입니다)</span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} className={inputCls} maxLength={500} />
          </label>
          <button type="button" disabled={pending || !why.trim()} onClick={() => run(() => rejectAbsence(r.id, why), "반려했습니다.")} className={btnDanger}>
            반려 확정
          </button>
          <button type="button" onClick={() => setRejecting(false)} className={btnSecondary}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}

function PhoneAbsenceForm({ students, todayYmd, onDone }: { students: Student[]; todayYmd: string; onDone: (id: string) => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ studentId: "", startDate: todayYmd, endDate: todayYmd, reasonType: "", reason: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value, ...(k === "startDate" && x.endDate < e.target.value ? { endDate: e.target.value } : {}) }));

  return (
    <form
      className={`${panelToneCls("yellow")} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const res = await createPhoneAbsence(f);
          if (!res.ok) return setErr(res.message);
          onDone(res.id);
        });
      }}
    >
      <h3 className={sectionTitleCls("yellow")}>전화 공결 입력</h3>
      <p className="text-xs text-ink-muted">확인자는 &lsquo;선생님(받은 직원)&rsquo; 으로 기록되고 곧바로 담임 확인 상태가 됩니다. 증빙자료는 저장 후 목록에서 [증빙 추가] 로 붙이세요.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className={labelCls}>학생</span>
          <select value={f.studentId} onChange={set("studentId")} className={inputCls} required>
            <option value="">고르세요</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({BK_SCOPE_LABEL[s.class_code as BkScope] ?? s.class_code}
                {s.school ? ` · ${s.school}` : ""})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>시작일</span>
          <input type="date" value={f.startDate} onChange={set("startDate")} className={inputCls} required />
        </label>
        <label>
          <span className={labelCls}>종료일</span>
          <input type="date" value={f.endDate} min={f.startDate} onChange={set("endDate")} className={inputCls} required />
        </label>
        <label>
          <span className={labelCls}>사유 구분</span>
          <select value={f.reasonType} onChange={set("reasonType")} className={inputCls} required>
            <option value="">고르세요</option>
            {ABSENCE_REASONS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
                {r.hint ? ` (${r.hint})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-3">
          <span className={labelCls}>사유 내용{f.reasonType === "other" ? " (필수)" : ""}</span>
          <input value={f.reason} onChange={set("reason")} className={inputCls} maxLength={1000} placeholder="예: 외조부 칠순 가족 모임" />
        </label>
      </div>
      {err && <p className={noticeError}>{err}</p>}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "저장 중…" : "저장"}
      </button>
    </form>
  );
}
