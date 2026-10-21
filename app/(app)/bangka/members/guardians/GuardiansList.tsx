"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { InviteStatusBadge } from "@/app/(app)/bangka/members/GuardianInvite";
import {
  bkClassLabel,
  bkGuardianStatusLabel,
  formatBkPhone,
  type BkGuardianRow,
} from "@/lib/bangka";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  badgeDanger,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  inputCls,
  labelCls,
  linkCls,
  panelToneCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 보호자 목록 — 상태(초대중/사용중/정지)·연결 학생·초대 링크·마지막 로그인·잠금.
//   이름을 누르면 상세(초대 링크 발급, 잠금 해제, 정지, 학생 연결).
//   보호자는 일괄 등록에서 만들어집니다. 삭제는 없습니다(관장 지시) — 정지로만.
// =====================================================================

export const GUARDIAN_STATUS_BADGE: Record<string, string> = {
  invited: badgeWarning,
  active: badgeSuccess,
  suspended: badgeDanger,
};

export default function GuardiansList({
  guardians,
  statusFilter,
}: {
  guardians: BkGuardianRow[];
  statusFilter: string;
}) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} flex flex-wrap items-end gap-3`}>
        <label className="min-w-[8rem]">
          <span className={labelCls}>상태</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              const v = e.target.value;
              router.push(`/bangka/members/guardians${v === "all" ? "" : `?status=${v}`}`);
            }}
            className={inputCls}
          >
            <option value="all">전체</option>
            <option value="invited">초대중</option>
            <option value="active">사용중</option>
            <option value="suspended">정지</option>
          </select>
        </label>
        <p className="text-xs text-ink-muted">{guardians.length}명</p>
        <p className="ml-auto text-xs text-ink-hint">
          보호자 추가는 [일괄 등록]에서 학생과 함께 합니다.
        </p>
      </div>

      <div className={`${panelToneCls("green")} overflow-x-auto`}>
        {guardians.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">해당하는 보호자가 없습니다.</p>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="px-2 py-2 text-left">이름</th>
                <th className="px-2 py-2 text-left">전화</th>
                <th className="px-2 py-2 text-left">연결 학생</th>
                <th className="px-2 py-2 text-left">상태</th>
                <th className="px-2 py-2 text-left">가입 링크</th>
                <th className="px-2 py-2 text-left">마지막 로그인</th>
              </tr>
            </thead>
            <tbody>
              {guardians.map((g) => (
                <tr
                  key={g.id}
                  className={`${tableRowCls} cursor-pointer`}
                  onClick={() => router.push(`/bangka/members/guardians/${g.id}`)}
                >
                  <td className="px-2 py-2 font-semibold text-ink">
                    <Link
                      href={`/bangka/members/guardians/${g.id}`}
                      className={linkCls}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {g.name}
                    </Link>
                    {g.relation && <span className="ml-1 text-xs font-normal text-ink-muted">({g.relation})</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-ink-body">{formatBkPhone(g.phone)}</td>
                  <td className="px-2 py-2 text-ink-body">
                    {g.students.length === 0 ? (
                      <span className="text-xs text-ink-hint">없음</span>
                    ) : (
                      g.students.map((s, i) => (
                        <span key={s.id} className={s.status === "left" ? "text-ink-hint line-through" : ""}>
                          {i > 0 && ", "}
                          {s.name}
                          <span className="text-[11px] text-ink-muted">({bkClassLabel(s.class_code)})</span>
                        </span>
                      ))
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={GUARDIAN_STATUS_BADGE[g.status] ?? badgeNeutral}>
                      {bkGuardianStatusLabel(g.status)}
                    </span>
                    {g.locked && <span className={`ml-1 ${badgeDanger}`}>잠김</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {g.status === "suspended" ? (
                      <span className="text-xs text-ink-hint">-</span>
                    ) : (
                      <InviteStatusBadge state={g.invite} />
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-xs text-ink-body">
                    {g.last_login_at ? fmtKstDateTime(g.last_login_at) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
