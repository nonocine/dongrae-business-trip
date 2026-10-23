"use client";

// =====================================================================
// 마이페이지 인사발령 탭 — 본인 입력(확인 대기) · 확정 건 수정 요청.
//   * 규칙은 lib/appointments, 서버 검사는 ./appointmentActions(세션 본인만·대기 건만).
//   * 저장은 버튼마다 바로(인사기록카드 [저장] 과 무관). 바깥 <form> 안에 놓이므로
//     버튼은 전부 type="button", 입력칸 Enter 는 막아 카드 저장이 눌리지 않게 합니다.
//   * 입사일이 있는데 입사 발령이 없으면 맨 위에 안내 + 입력칸에 입사·입사일을 미리 채움.
// =====================================================================

import { useMemo, useState, useTransition } from "react";
import {
  departmentOptions,
  type EmployeeAppointment,
} from "@/lib/supabase";
import {
  appointmentStatusOf,
  fmtAssignmentDate,
  hasJoinAppointment,
} from "@/lib/appointments";
import {
  AppointmentFields,
  emptyAppointment,
} from "@/app/(app)/hr/ProfileFormParts";
import {
  addMyAppointment,
  deleteMyAppointment,
  requestMyAppointmentChange,
  updateMyAppointment,
} from "@/app/(app)/profile/hr/appointmentActions";
import {
  badgeDanger,
  badgeSuccess,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

type Editor =
  | { mode: "add"; draft: EmployeeAppointment }
  | { mode: "edit"; id: string; draft: EmployeeAppointment }
  | { mode: "request"; index: number; draft: EmployeeAppointment };

function summary(a: EmployeeAppointment): string {
  return [
    a.type,
    fmtAssignmentDate(a.effective_date || null) || "(발령일 없음)",
    a.department,
    a.title && a.duty ? `${a.title}(${a.duty})` : a.title || a.duty,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function MyAppointmentsPanel({
  initialAppointments,
  joinDate,
}: {
  initialAppointments: EmployeeAppointment[];
  joinDate: string | null;
}) {
  const [list, setList] = useState(initialAppointments);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const needJoin = !!joinDate && !hasJoinAppointment(list);
  const deptOptions = useMemo(
    () => departmentOptions(list.map((a) => a.department)),
    [list]
  );
  const byId = useMemo(
    () => new Map(list.filter((a) => a.id).map((a) => [a.id!, a])),
    [list]
  );

  function newDraft(): EmployeeAppointment {
    return needJoin
      ? { ...emptyAppointment(), type: "입사", effective_date: joinDate! }
      : emptyAppointment();
  }

  function act(
    fn: () => Promise<
      { ok: true; appointments: EmployeeAppointment[] } | { ok: false; message: string }
    >,
    done: string
  ) {
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setList(res.appointments);
      setEditor(null);
      setOk(done);
    });
  }

  function submit() {
    if (!editor) return;
    const d = editor.draft;
    if (editor.mode === "add")
      act(() => addMyAppointment(d), "올렸습니다. 관장·부장 확인 후 확정됩니다.");
    else if (editor.mode === "edit")
      act(() => updateMyAppointment(editor.id, d), "고쳐서 다시 올렸습니다.");
    else {
      const orig = list[editor.index];
      act(
        () =>
          requestMyAppointmentChange(
            orig.id ? { id: orig.id } : { index: editor.index, snapshot: orig },
            d
          ),
        "수정 요청을 올렸습니다. 확정되면 원래 발령이 바뀝니다."
      );
    }
  }

  const editorCard = editor && (
    <div className="rounded-lg border-2 border-navy bg-card p-3 shadow-sm">
      <p className="text-xs font-bold text-navy">
        {editor.mode === "add"
          ? "발령 추가"
          : editor.mode === "edit"
            ? "확인 대기 발령 고치기"
            : `수정 요청 — 원래: ${summary(list[editor.index])}`}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <AppointmentFields
          apt={editor.draft}
          onPatch={(patch) =>
            setEditor({ ...editor, draft: { ...editor.draft, ...patch } })
          }
          readOnly={false}
          deptOptions={deptOptions}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => setEditor(null)}
          disabled={busy}
        >
          취소
        </button>
        <button
          type="button"
          className={btnPrimary}
          onClick={submit}
          disabled={busy}
        >
          {busy ? "올리는 중…" : "올리기"}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT")
          e.preventDefault();
      }}
    >
      {needJoin && (
        <div className={noticeWarning}>
          입사 발령을 입력해 주세요(입사일 {fmtAssignmentDate(joinDate)}).
          {!editor && (
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => setEditor({ mode: "add", draft: newDraft() })}
            >
              지금 입력
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          직접 올린 발령은 관장·부장이 확인하면 확정됩니다. 확정된 발령은
          [수정 요청]으로 고쳐 달라고 올릴 수 있습니다.
        </p>
        {!editor && (
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setEditor({ mode: "add", draft: newDraft() })}
          >
            + 발령 추가
          </button>
        )}
      </div>

      {error && <p className={noticeError}>{error}</p>}
      {ok && <p className={noticeSuccess}>{ok}</p>}

      {editor?.mode === "add" && editorCard}

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-hint">
          등록된 인사발령 내역이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((a, idx) => {
            const st = appointmentStatusOf(a);
            const original = a.original_id ? byId.get(a.original_id) : null;
            const hasOpenRequest =
              !!a.id &&
              list.some(
                (x) =>
                  x.original_id === a.id && appointmentStatusOf(x) === "pending"
              );
            const editingThis =
              (editor?.mode === "edit" && editor.id === a.id) ||
              (editor?.mode === "request" && editor.index === idx);
            return (
              <li
                key={a.id ?? `i${idx}`}
                className="rounded-lg border border-line bg-hr-bg p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                      {st === "pending" && (
                        <span className={badgeWarning}>확인 대기</span>
                      )}
                      {st === "rejected" && (
                        <span className={badgeDanger}>반려</span>
                      )}
                      {st === "confirmed" && (
                        <span className={badgeSuccess}>확정</span>
                      )}
                      {a.original_id && (
                        <span className="text-[11px] font-semibold text-navy">
                          수정 요청
                        </span>
                      )}
                      <span className="font-medium">{summary(a)}</span>
                    </p>
                    {original && (
                      <p className="text-[11px] text-ink-hint">
                        원래 발령: {summary(original)}
                      </p>
                    )}
                    {a.note && (
                      <p className="text-xs text-ink-muted">{a.note}</p>
                    )}
                    {st === "rejected" && a.reject_reason && (
                      <p className="text-xs text-stamp">
                        반려 사유: {a.reject_reason}
                        {a.rejected_by ? ` (${a.rejected_by})` : ""}
                      </p>
                    )}
                  </div>
                  {!editor && (
                    <div className="flex shrink-0 gap-1">
                      {st === "confirmed" ? (
                        <button
                          type="button"
                          className={btnSecondary}
                          disabled={busy || hasOpenRequest}
                          title={
                            hasOpenRequest
                              ? "이 발령의 수정 요청이 확인 대기 중입니다"
                              : undefined
                          }
                          onClick={() =>
                            setEditor({ mode: "request", index: idx, draft: { ...a } })
                          }
                        >
                          수정 요청
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={btnSecondary}
                            disabled={busy}
                            onClick={() =>
                              setEditor({ mode: "edit", id: a.id!, draft: { ...a } })
                            }
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className={btnSecondary}
                            disabled={busy}
                            onClick={() => {
                              if (!confirm("이 발령을 삭제할까요?")) return;
                              act(() => deleteMyAppointment(a.id!), "삭제했습니다.");
                            }}
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {editingThis && <div className="mt-2">{editorCard}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
