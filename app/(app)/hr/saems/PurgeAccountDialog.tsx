"use client";

import { useEffect, useState, useTransition } from "react";
import {
  inspectAccountForPurge,
  purgeAccount,
} from "@/app/(app)/hr/saems/purgeActions";
import type { PurgeInspection } from "@/lib/saemAccountPurge";
import {
  btnDanger,
  btnSecondary,
  noticeError,
  noticeWarning,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 동래샘들 계정 완전 삭제 — 사전 점검 → (경고 확인) → 이름 입력 → 삭제.
//   강사관리 상세·동아리관리 공용. 누르자마자 지우지 않습니다.
//   · 직원 계정 / 정산 / 강의확인증 → 삭제 버튼 막고 이유 표시
//   · 담당 프로그램 → "담당자가 비워집니다" 경고 + 확인란
//   · 이름 정확히 입력해야 버튼 활성(되돌릴 수 없는 동작)
//   배경 클릭으로는 닫지 않습니다.
// =====================================================================

// 세 동작 차이 — 두 화면에서 같은 문장을 씁니다.
export const ACCOUNT_ACTIONS_GUIDE: { label: string; text: string }[] = [
  { label: "중지", text: "역할만 잠시 끔 — 언제든 되돌릴 수 있습니다." },
  { label: "제거", text: "역할 삭제 — 계정은 남아 같은 전화번호로 재가입되지 않습니다." },
  { label: "완전 삭제", text: "계정까지 삭제 — 전화번호가 풀려 재가입할 수 있습니다. 되돌릴 수 없습니다. (관장·부장)" },
];

export function AccountActionsGuide({ omit }: { omit?: string[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
      {ACCOUNT_ACTIONS_GUIDE.filter((g) => !omit?.includes(g.label)).map((g) => (
        <li key={g.label}>
          <b className={g.label === "완전 삭제" ? "text-stamp" : "text-ink-body"}>{g.label}</b> = {g.text}
        </li>
      ))}
    </ul>
  );
}

// 삭제 전에 꼭 보이는 안내 (2026-10 관장 요청).
//   실제로 "초대 링크가 만료돼 가입을 못 한다"를 계정 삭제로 풀려던 일이 있었습니다.
//   링크는 [초대 링크 재발급]으로 되살릴 수 있으니 삭제할 이유가 아닙니다.
export function InviteInsteadNotice() {
  return (
    <p className={`mt-2 ${noticeWarning}`} data-testid="purge-invite-hint">
      <b>초대 링크가 만료돼 가입을 못 하는 경우라면 삭제하지 마세요.</b> 목록이나 상세의{" "}
      <b>[초대 링크 재발급]</b>으로 새 링크를 만들어 보내면 됩니다(기존 계정·기록 그대로).
    </p>
  );
}

const TYPE_LABEL: Record<string, string> = { club: "동아리" };

export default function PurgeAccountDialog({
  instructorId,
  name,
  onClose,
  onDone,
}: {
  instructorId: string;
  name: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [insp, setInsp] = useState<PurgeInspection | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [accept, setAccept] = useState(false);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    inspectAccountForPurge(instructorId).then((res) => {
      if (!alive) return;
      if (res.ok) setInsp(res.inspection);
      else setLoadErr(res.message);
    });
    return () => {
      alive = false;
    };
  }, [instructorId]);

  const hasPrograms = (insp?.programs.length ?? 0) > 0;
  const nameOk = !!insp && typed.trim() === insp.name.trim();
  const canDelete = !!insp && !insp.blocked && nameOk && (!hasPrograms || accept);

  function doDelete() {
    if (!insp) return;
    setErr(null);
    start(async () => {
      const res = await purgeAccount({
        id: insp.id,
        confirmName: typed.trim(),
        acceptProgramUnassign: accept,
      });
      if (!res.ok) {
        // DB 제약 거부 포함 — 사유를 그대로 보여 줍니다.
        setErr(res.message);
        if (res.inspection) setInsp(res.inspection);
        return;
      }
      onDone(
        `${res.name} 계정을 완전히 삭제했습니다. 같은 전화번호로 다시 가입할 수 있습니다.` +
          (res.programsCleared ? ` (담당 프로그램 ${res.programsCleared}개는 담당자가 비었습니다 — 다른 분을 지정해주세요)` : "") +
          (res.fileWarning ? ` ⚠️ ${res.fileWarning}` : "")
      );
    });
  }

  const rows: [string, number | string, string][] = insp
    ? [
        ["정산 내역", insp.settlements, insp.settlements ? "있으면 삭제 불가" : ""],
        ["강의확인증", insp.lectureCerts, insp.lectureCerts ? "있으면 삭제 불가" : ""],
        ["담당 프로그램", insp.programs.length, insp.programs.length ? "담당자가 비워짐" : ""],
        [
          "활동 회차",
          insp.sessions,
          insp.sessions ? `회차는 남음${insp.submittedSessions ? ` (제출 ${insp.submittedSessions}건 포함)` : ""}` : "",
        ],
        ["첨부서류", insp.docs, insp.docs ? "함께 삭제" : ""],
        ["저장 파일", insp.files, insp.files ? "함께 삭제(서류·이력서)" : ""],
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 계정 완전 삭제`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-stamp">계정 완전 삭제 — {name}</h3>
          <button type="button" onClick={onClose} disabled={pending} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>

        {loadErr ? (
          <p className={noticeError}>{loadErr}</p>
        ) : !insp ? (
          <p className="py-6 text-center text-sm text-ink-muted">이 계정에 걸린 기록을 확인하는 중…</p>
        ) : (
          <>
            <InviteInsteadNotice />
            <p className="mt-3 text-xs text-ink-muted">
              삭제 전 점검 결과입니다. 역할({insp.roles.length ? insp.roles.join(", ") : "없음"})은 계정과 함께 사라집니다.
            </p>
            <table className="mt-2 w-full text-sm" data-testid="purge-inspection">
              <tbody>
                {rows.map(([label, n, note]) => (
                  <tr key={label} className={tableRowCls}>
                    <td className="py-1.5 text-ink-body">{label}</td>
                    <td className="py-1.5 text-right font-semibold text-ink">{n}</td>
                    <td className="py-1.5 pl-3 text-xs text-ink-hint">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {insp.blocked ? (
              <p className={`mt-3 ${noticeError}`} data-testid="purge-blocked">
                {insp.blocked}
              </p>
            ) : (
              <>
                {hasPrograms && (
                  <div className={`mt-3 ${noticeWarning}`}>
                    <p>
                      담당 프로그램 {insp.programs.length}개의 담당자가 비워집니다. 다른 분을 지정해주세요.
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {insp.programs.map((p, i) => (
                        <li key={i}>
                          {p.name}
                          {TYPE_LABEL[p.type] ? ` (${TYPE_LABEL[p.type]})` : ""}
                        </li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                      담당자가 비워지는 것을 확인했습니다
                    </label>
                  </div>
                )}
                <p className="mt-3 text-sm text-ink-body">
                  되돌릴 수 없습니다. 확인을 위해 이름(<b>{insp.name}</b>)을 입력하세요.
                </p>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={insp.name}
                  data-testid="purge-name"
                  className="mt-1 block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-stamp focus:outline-none focus:ring-1 focus:ring-stamp"
                />
              </>
            )}
            {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
            <div className="mt-4 flex gap-2">
              {!insp.blocked && (
                <button type="button" className={btnDanger} disabled={pending || !canDelete} onClick={doDelete}>
                  {pending ? "삭제 중…" : "완전히 삭제"}
                </button>
              )}
              <button type="button" className={btnSecondary} onClick={onClose} disabled={pending}>
                {insp.blocked ? "닫기" : "취소"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
