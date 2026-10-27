"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  linkStudent,
  setGuardianSuspended,
  unlinkStudent,
  unlockGuardian,
} from "@/app/(app)/bangka/members/actions";
import {
  GuardianInviteButton,
  InviteStatusBadge,
  IssuedLink,
} from "@/app/(app)/bangka/members/GuardianInvite";
import { GUARDIAN_STATUS_BADGE } from "@/app/(app)/bangka/members/guardians/GuardiansList";
import {
  bkClassLabel,
  bkGuardianStatusLabel,
  bkInviteMessage,
  formatBkPhone,
  type BkGuardianDetail,
} from "@/lib/bangka";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  badgeDanger,
  badgeNeutral,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  panelToneCls,
  sectionTitleCls,
} from "@/lib/ui";

// =====================================================================
// 보호자 상세 — 동래방카 계정 관리.
//   · 가입 링크: 지금 유효한 링크가 있으면 링크·카톡 문구 복사, 아니면 발급.
//   · 잠금 해제: PIN 을 여러 번 틀려 잠긴 경우(failed_attempts·locked_until 초기화).
//   · 정지/해제: 삭제 대신 쓰는 유일한 내리기 수단(관장 지시 — 삭제 없음).
//   · 학생 연결 추가·해제: 연결된 학생의 반 자료만 앱에서 보입니다.
// =====================================================================

type Brief = { id: string; name: string; school: string | null; grade: string | null; class_code: string };

export default function GuardianDetail({
  guardian: g,
  activeStudents,
}: {
  guardian: BkGuardianDetail;
  activeStudents: Brief[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const suspended = g.status === "suspended";

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setErr(res.message ?? "처리하지 못했습니다.");
        return;
      }
      after?.();
      router.refresh();
    });
  }

  const linkedIds = new Set(g.students.map((s) => s.id));
  const candidates = activeStudents.filter((s) => !linkedIds.has(s.id));

  return (
    <div className="space-y-4">
      {/* 기본 정보 · 상태 */}
      <section className={panelToneCls("blue")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-ink">
              {g.name}
              {g.relation && <span className="ml-1 text-sm font-normal text-ink-muted">({g.relation})</span>}
            </h3>
            <p className="mt-0.5 text-sm text-ink-body">{formatBkPhone(g.phone)}</p>
            {g.memo && <p className="mt-1 text-xs text-ink-hint">{g.memo}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={GUARDIAN_STATUS_BADGE[g.status] ?? badgeNeutral}>{bkGuardianStatusLabel(g.status)}</span>
            {g.locked && <span className={badgeDanger}>잠김</span>}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="마지막 로그인" value={g.last_login_at ? fmtKstDateTime(g.last_login_at) : "-"} />
          <Row label="PIN 설정" value={g.pin_set_at ? fmtKstDateTime(g.pin_set_at) : "아직 안 함"} />
          <Row
            label="로그인 실패"
            value={`${g.failed_attempts}회${g.locked && g.locked_until ? ` · ${fmtKstDateTime(g.locked_until)}까지 잠김` : ""}`}
          />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {g.locked && (
            <button type="button" disabled={pending} className={btnPrimary} onClick={() => run(() => unlockGuardian(g.id))}>
              잠금 해제
            </button>
          )}
          {suspended ? (
            <button
              type="button"
              disabled={pending}
              className={btnPrimary}
              onClick={() => run(() => setGuardianSuspended({ id: g.id, suspended: false }))}
            >
              정지 해제
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={btnSecondary}
              onClick={() => {
                if (!confirm(`${g.name}님을 정지할까요? 동래방카 앱을 바로 쓸 수 없게 되고, 살아 있는 가입 링크도 지워집니다.`))
                  return;
                run(() => setGuardianSuspended({ id: g.id, suspended: true }));
              }}
            >
              정지
            </button>
          )}
        </div>
      </section>

      {/* 가입 링크 */}
      <section className={panelToneCls("yellow")}>
        <h3 className={sectionTitleCls("yellow")}>동래방카 가입 링크</h3>
        {suspended ? (
          <p className="mt-2 text-sm text-ink-muted">정지된 보호자입니다. 링크를 만들려면 먼저 [정지 해제]를 하세요.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <InviteStatusBadge state={g.invite} />
              <GuardianInviteButton guardianId={g.id} name={g.name} state={g.invite} />
            </div>
            {g.inviteUrl && g.inviteExpiresAt && (
              <IssuedLink
                url={g.inviteUrl}
                message={bkInviteMessage({ guardianName: g.name, url: g.inviteUrl, expiresAt: g.inviteExpiresAt })}
              />
            )}
            {g.invite.kind === "valid" && !g.inviteUrl && (
              <p className="mt-2 text-xs text-warning">
                링크는 살아 있지만 BANGKA_BASE_URL 환경변수가 없어 주소를 보여줄 수 없습니다.
              </p>
            )}
          </>
        )}
      </section>

      {/* 연결 학생 */}
      <section className={panelToneCls("green")}>
        <h3 className={sectionTitleCls("green")}>연결 학생 ({g.students.length}명)</h3>
        <p className="mt-1 text-xs text-ink-hint">연결된 학생의 반 자료만 앱에서 보입니다. 퇴소한 학생은 앱에서 자동으로 빠집니다.</p>
        {g.students.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">연결된 학생이 없습니다.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {g.students.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className={s.status === "left" ? "text-ink-hint line-through" : "text-ink"}>
                  {s.name} <span className="text-xs text-ink-muted">({bkClassLabel(s.class_code)})</span>
                  {s.status === "left" && <span className="ml-1 text-xs no-underline">퇴소</span>}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  className={`${btnSecondary} h-8 px-3 text-xs`}
                  onClick={() => {
                    if (!confirm(`${s.name} 학생과의 연결을 해제할까요?`)) return;
                    run(() => unlinkStudent({ guardianId: g.id, studentId: s.id }));
                  }}
                >
                  연결 해제
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1">
            <span className={labelCls}>학생 연결 추가(재원생)</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={inputCls}>
              <option value="">학생 선택…</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {bkClassLabel(s.class_code)}
                  {s.school ? ` · ${s.school}` : ""}
                  {s.grade ? ` ${s.grade}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !pick}
            className={btnPrimary}
            onClick={() => run(() => linkStudent({ guardianId: g.id, studentId: pick }), () => setPick(""))}
          >
            연결
          </button>
        </div>
      </section>

      {err && <p className={noticeError}>{err}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-ink-body">{value}</dd>
    </div>
  );
}
