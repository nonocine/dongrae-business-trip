"use client";

// =====================================================================
// 인사기록 관리 — 직원이 올린 인사발령(확인 대기·반려) 확정·반려.
//   * 서버 검사는 ./appointmentReviewActions(인사 파일 열람 권한 보유자만).
//   * 결과로 돌아온 전체 목록을 onApplied 로 넘겨 부모(EmployeeProfileForm)가
//     확정 목록과 대기 목록을 다시 나눕니다.
//   * 발령 탭에 저장 안 한 변경이 있으면 확정을 막습니다(확정 결과로 다시 그리면
//     그 변경이 사라지므로) — dirty.
// =====================================================================

import { useState, useTransition } from "react";
import type { EmployeeAppointment } from "@/lib/supabase";
import { appointmentStatusOf, fmtAssignmentDate } from "@/lib/appointments";
import {
  confirmEmployeeAppointment,
  rejectEmployeeAppointment,
} from "@/app/(app)/hr/appointmentReviewActions";
import {
  badgeDanger,
  badgeWarning,
  btnDanger,
  btnPrimary,
  btnSecondary,
  noticeError,
} from "@/lib/ui";

function summary(a: EmployeeAppointment): string {
  return [
    a.type,
    fmtAssignmentDate(a.effective_date || null) || "(발령일 없음)",
    a.department || "(부서 없음)",
    a.title && a.duty ? `${a.title}(${a.duty})` : a.title || a.duty,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function AppointmentReviewPanel({
  driverId,
  items,
  confirmed,
  dirty,
  onApplied,
}: {
  driverId: string;
  items: EmployeeAppointment[]; // 미확정(대기·반려)
  confirmed: EmployeeAppointment[]; // 수정 요청의 원래 발령 표시용
  dirty: boolean;
  onApplied: (all: EmployeeAppointment[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, startTransition] = useTransition();

  if (items.length === 0) return null;

  function run(
    fn: () => Promise<
      { ok: true; appointments: EmployeeAppointment[] } | { ok: false; message: string }
    >
  ) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setRejecting(null);
      setReason("");
      onApplied(res.appointments);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border-2 border-warning bg-warning-soft p-3">
      <p className="text-xs font-bold text-warning">
        직원이 올린 발령 — 확정 전까지 현재 소속·증명서 등에 쓰이지 않습니다.
      </p>
      {dirty && (
        <p className="text-xs text-ink-muted">
          아래 발령 목록에 저장하지 않은 변경이 있습니다. 먼저 [저장]한 뒤 확정하세요.
        </p>
      )}
      {error && <p className={noticeError}>{error}</p>}
      <ul className="space-y-2">
        {items.map((a) => {
          const st = appointmentStatusOf(a);
          const original = a.original_id
            ? confirmed.find((c) => c.id === a.original_id)
            : null;
          return (
            <li key={a.id} className="rounded-md border border-line bg-card p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className={st === "pending" ? badgeWarning : badgeDanger}>
                      {st === "pending" ? "확인 대기" : "반려"}
                    </span>
                    {a.original_id && (
                      <span className="text-[11px] font-semibold text-navy">수정 요청</span>
                    )}
                    <span className="font-medium text-ink">{summary(a)}</span>
                  </p>
                  {a.original_id && (
                    <p className="text-[11px] text-ink-hint">
                      원래 발령: {original ? summary(original) : "(찾을 수 없음 — 반려하세요)"}
                    </p>
                  )}
                  {a.note && <p className="text-xs text-ink-muted">{a.note}</p>}
                  <p className="text-[11px] text-ink-hint">
                    {a.requested_by ?? "본인"} ·{" "}
                    {a.requested_at ? a.requested_at.slice(0, 10).replaceAll("-", ".") : ""} 올림
                    {st === "rejected" && a.reject_reason
                      ? ` · 반려 사유: ${a.reject_reason}${a.rejected_by ? ` (${a.rejected_by})` : ""}`
                      : ""}
                  </p>
                </div>
                {st === "pending" && rejecting !== a.id && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy || dirty}
                      onClick={() => run(() => confirmEmployeeAppointment(driverId, a.id!))}
                    >
                      확정
                    </button>
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={busy}
                      onClick={() => {
                        setRejecting(a.id!);
                        setReason("");
                      }}
                    >
                      반려
                    </button>
                  </div>
                )}
              </div>
              {rejecting === a.id && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    placeholder="반려 사유 (직원 화면에 보입니다)"
                    className="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1.5 text-sm"
                    autoFocus
                  />
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      run(() => rejectEmployeeAppointment(driverId, a.id!, reason))
                    }
                  >
                    반려하기
                  </button>
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={busy}
                    onClick={() => setRejecting(null)}
                  >
                    취소
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
