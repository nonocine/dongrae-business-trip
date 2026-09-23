"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addClubBudgetPlan,
  addClubExpense,
  addClubSession,
  addClubRoleToInstructor,
  confirmClubReport,
  createClub,
  createClubTeacher,
  deactivateClubTeacherRole,
  reactivateClubTeacherRole,
  deleteClub,
  deleteClubBudgetPlan,
  deleteClubSession,
  removeClubTeacher,
  updateClubSession,
  syncClubBusinessResult,
  type ClubBudgetPlanRow,
  type ClubDashboardData,
  type ClubMonthRow,
  type ClubTeacherRow,
  type InstructorPickRow,
} from "@/app/(app)/hr/clubs/actions";
import ClubPlanEditor from "@/app/(app)/hr/clubs/ClubPlanEditor";
import {
  panelCls,
  blockCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeSuccess,
  badgeNeutral,
  badgeNavy,
  badgeWarning,
  badgeDanger,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const inputCls =
  "w-full rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

export default function ClubDashboard({
  year,
  month,
  data,
}: {
  year: number;
  month: number;
  data: ClubDashboardData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const confirmed = data.clubs.filter(
    (club) => club.reportStatus === "confirmed"
  ).length;
  const totalSessions = data.clubs.reduce(
    (sum, club) => sum + club.sessionCount,
    0
  );
  const attendance = data.clubs.reduce(
    (sum, club) => sum + club.attendanceTotal,
    0
  );

  function moveMonth(delta: number) {
    const date = new Date(year, month - 1 + delta, 1);
    router.push(`/hr/clubs?year=${date.getFullYear()}&month=${date.getMonth() + 1}`);
  }

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string
  ) {
    setMessage(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ ok: false, text: result.message ?? "처리하지 못했습니다." });
        return;
      }
      setMessage({ ok: true, text: success });
      router.refresh();
    });
  }

  if (!data.configured) {
    return (
      <section className={panelCls}>
        <h1 className="text-xl font-bold text-ink">동아리관리 준비가 필요합니다</h1>
        <p className="mt-2 text-sm text-ink-muted">
          동아리관리 데이터베이스 변경사항을 먼저 적용한 뒤 사용할 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {/* 도구 줄 — 제목·설명은 페이지 머리글(page.tsx)에 이미 있고 사이드바가
          현재 위치를 보여주므로 여기서 반복하지 않습니다(관장 피드백). */}
      <section className={`${panelCls} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => moveMonth(-1)} className={btnSecondary}>
            이전 달
          </button>
          <strong className="min-w-[7.5rem] text-center text-base text-navy">
            {year}년 {month}월
          </strong>
          <button type="button" onClick={() => moveMonth(1)} className={btnSecondary}>
            다음 달
          </button>
        </div>
        <Link href="/business-results" className={btnSecondary}>
          사업실적 보기
        </Link>
      </section>

      {message && (
        <p className={message.ok ? noticeSuccess : noticeError}>
          {message.text}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="운영 동아리" value={`${data.clubs.length}개`} />
        <Summary label="활동" value={`${totalSessions}회`} />
        <Summary
          label="참여 연인원"
          value={`${attendance.toLocaleString("ko-KR")}명`}
        />
        <Summary label="보고 확정" value={`${confirmed}/${data.clubs.length}`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TeacherForm
          pending={pending}
          instructors={data.instructors}
          onCreate={(input) => {
            setMessage(null);
            start(async () => {
              const result = await createClubTeacher(input);
              if (!result.ok) {
                setMessage({ ok: false, text: result.message });
                return;
              }
              setMessage({
                ok: true,
                text: result.merged
                  ? "기존 강사에게 동아리샘 역할을 추가했습니다. (겸직)"
                  : result.inviteUrl
                  ? `동아리샘을 등록했습니다. 초대 링크: ${result.inviteUrl}`
                  : "동아리샘을 등록했습니다.",
              });
              router.refresh();
            });
          }}
          onAddRole={(instructorId) =>
            run(
              () => addClubRoleToInstructor({ instructorId }),
              "기존 강사에게 동아리샘 역할을 추가했습니다. (겸직)"
            )
          }
        />
        <ClubForm
          year={year}
          teachers={data.teachers}
          pending={pending}
          onSubmit={(input) => run(() => createClub(input), "동아리를 등록했습니다.")}
        />
      </section>

      <TeacherList
        teachers={data.teachers}
        pending={pending}
        onRemove={(teacher) =>
          run(
            () => removeClubTeacher({ instructorId: teacher.id }),
            teacher.alsoInstructor
              ? `${teacher.name}님의 동아리샘 역할을 해제했습니다. (강사 자격은 유지)`
              : `${teacher.name}님을 동아리샘에서 제거했습니다.`
          )
        }
        onDeactivate={(teacher, reason) =>
          run(
            () =>
              deactivateClubTeacherRole({ instructorId: teacher.id, reason }),
            `${teacher.name}님의 동아리샘 역할을 중지했습니다. (로그인 계정과 다른 역할은 그대로)`
          )
        }
        onReactivate={(teacher) =>
          run(
            () => reactivateClubTeacherRole({ instructorId: teacher.id }),
            `${teacher.name}님의 동아리샘 역할을 다시 활성으로 바꿨습니다.`
          )
        }
      />

      <section className={panelCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={sectionTitleCls("blue")}>{month}월 제출 현황</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              활동일지가 모두 제출된 동아리만 월간보고를 확정할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/hr/clubs/report?year=${year}&month=${month}`}
              className={btnSecondary}
            >
              통합 결과보고 PDF
            </a>
            <a
              href={`/hr/clubs/report/word?year=${year}&month=${month}`}
              className={btnSecondary}
            >
              편집용 Word
            </a>
            <button
              type="button"
              disabled={pending || confirmed === 0}
              onClick={() =>
                run(
                  () => syncClubBusinessResult({ year, month }),
                  "확정된 동아리 자료를 사업실적에 반영했습니다."
                )
              }
              className={btnPrimary}
            >
              사업실적 반영
            </button>
          </div>
        </div>

        {data.clubs.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-hint">
            등록된 동아리가 없습니다.
          </p>
        ) : (
          <div className="mt-4">
            {/* 한눈에 보는 제출 현황 — 계획서와 결과보고를 같은 자리에서.
                예전에는 결과보고만 보여서 "누가 계획서를 안 냈는지" 를 알 수
                없었습니다(김준호 선생님 요청). 계획서는 한 해 단위라 달을
                옮겨도 같은 값이고, 결과보고는 그 달 기준입니다. */}
            <div className="mb-4 overflow-x-auto rounded-lg border border-rule">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className={`${tableHeadCls} bg-surface`}>
                    <th className="px-3 py-2 font-medium">동아리</th>
                    <th className="px-3 py-2 font-medium">동아리샘</th>
                    <th className="px-3 py-2 text-center font-medium">
                      계획서 ({year}년)
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      결과보고 ({month}월)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.clubs.map((club) => {
                    const planOk = !!club.planSubmittedAt;
                    const reportOk = club.reportStatus === "confirmed";
                    return (
                      <tr key={club.id} className={tableRowCls}>
                        <td className="px-3 py-2 font-medium text-ink">
                          {club.name}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-muted">
                          {club.teacherName ?? "미지정"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Mark ok={planOk} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Mark ok={reportOk} />
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface text-xs font-semibold text-ink-body">
                    <td className="px-3 py-2" colSpan={2}>
                      제출
                    </td>
                    <td className="px-3 py-2 text-center">
                      {data.clubs.filter((c) => c.planSubmittedAt).length}/
                      {data.clubs.length}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {confirmed}/{data.clubs.length}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {data.clubs.length > 1 && (
              <p className="mb-2 text-xs text-ink-muted">
                동아리명을 눌러 펼치면 계획서·활동계획·예산·월간보고를 관리할 수
                있습니다.
              </p>
            )}
            <div className="space-y-3">
              {data.clubs.map((club) => (
                <ClubCard
                  key={club.id}
                  club={club}
                  year={year}
                  month={month}
                  pending={pending}
                  run={run}
                  onPlanChanged={() => router.refresh()}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// 제출 여부 한 칸 — ○(냈음) / ×(안 냈음). 색만으로 구분하지 않게 기호를 씁니다.
function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      title={ok ? "제출함" : "미제출"}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
        ok ? "bg-success-soft text-success" : "bg-stamp-soft text-stamp"
      }`}
    >
      {ok ? "○" : "×"}
    </span>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className={panelCls}>
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-navy">{value}</p>
    </div>
  );
}

// 중지 기록을 사람이 읽는 한 줄로. (비활성 행 마우스 오버용)
function deactivationNote(teacher: ClubTeacherRow): string {
  const when = teacher.roleDeactivatedAt
    ? new Date(teacher.roleDeactivatedAt).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "시점 미기록";
  const who = teacher.roleDeactivatedBy ?? "기록 없음";
  const why = teacher.roleDeactivateReason ?? "사유 미입력";
  return `중지: ${when} · ${who} · ${why}`;
}

// 등록된 동아리샘 목록.
//   화면에 "활성"이 두 개 나오므로 라벨을 확실히 갈라 둔다.
//     · 계정 배지("계정 활성/…")  = 동래샘들 로그인 상태. 여기서는 표시만 하고 바꾸지 않는다.
//     · 역할 배지("동아리샘 활성/중지") = 동아리 역할만의 상태. 중지/다시 활성 버튼이 다루는 대상.
//   중지(되돌릴 수 있음)와 제거(역할 삭제)는 다른 동작이라 버튼을 둘 다 남긴다.
function TeacherList({
  teachers,
  pending,
  onRemove,
  onDeactivate,
  onReactivate,
}: {
  teachers: ClubTeacherRow[];
  pending: boolean;
  onRemove: (teacher: ClubTeacherRow) => void;
  onDeactivate: (teacher: ClubTeacherRow, reason: string) => void;
  onReactivate: (teacher: ClubTeacherRow) => void;
}) {
  return (
    <section className={panelCls}>
      <h2 className={sectionTitleCls("green")}>동아리샘 목록</h2>
      <p className="mt-1 text-xs text-ink-muted">
        <b>중지</b>는 동아리샘 역할만 잠시 끄는 것이라 언제든 되돌릴 수 있고,{" "}
        <b>제거</b>는 역할 자체를 지웁니다(다시 등록해야 함). 둘 다 계정과 강사
        역할은 건드리지 않습니다.
      </p>
      <p className="mt-1 text-xs text-ink-hint">
        “계정” 배지는 동래샘들 로그인 상태, “동아리샘” 배지는 역할 상태입니다.
        이 화면에서는 역할만 바뀝니다.
      </p>
      {teachers.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-hint">
          등록된 동아리샘이 없습니다.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {teachers.map((teacher) => {
            const roleActive = teacher.roleStatus === "active";
            return (
              <li
                key={teacher.id}
                title={roleActive ? undefined : deactivationNote(teacher)}
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-2 ${
                  roleActive ? "" : "bg-surface/60 opacity-60"
                }`}
              >
                <span
                  className={`font-semibold ${
                    roleActive ? "text-ink" : "text-ink-muted line-through"
                  }`}
                >
                  {teacher.name}
                </span>
                {teacher.alsoInstructor && (
                  <span className={badgeNavy}>강사 겸직</span>
                )}
                {/* 역할 상태 — 이 화면의 토글 대상 */}
                <span className={roleActive ? badgeSuccess : badgeWarning}>
                  {roleActive ? "동아리샘 활성" : "동아리샘 중지"}
                </span>
                {/* 계정(로그인) 상태 — 정보 표시 전용 */}
                <span
                  className={
                    teacher.status === "active" ? badgeNeutral : badgeDanger
                  }
                >
                  계정 {teacher.status === "active" ? "활성" : teacher.status}
                </span>
                <span className="text-xs text-ink-muted">
                  {teacher.phone ?? "연락처 없음"}
                </span>
                {!roleActive && (
                  <span className="w-full text-xs text-ink-hint sm:w-auto">
                    {deactivationNote(teacher)}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 gap-2">
                  {roleActive ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const reason = window.prompt(
                          `${teacher.name}님의 동아리샘 역할을 중지합니다.\n로그인 계정과 강사 역할, 이미 맡은 동아리·과거 기록은 그대로 남습니다.\n\n중지 사유(선택, 예: 2026년 활동 종료)`,
                          ""
                        );
                        if (reason === null) return; // 취소
                        onDeactivate(teacher, reason.trim());
                      }}
                      className={btnSecondary}
                    >
                      중지
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onReactivate(teacher)}
                      className={btnSecondary}
                    >
                      다시 활성
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const ask = teacher.alsoInstructor
                        ? `${teacher.name}님의 동아리샘 역할만 해제합니다. 강사 자격과 서류는 그대로 유지됩니다. 계속할까요?`
                        : `${teacher.name}님을 동아리샘에서 제거할까요? 계정은 남고 동아리 역할만 사라집니다.`;
                      if (!window.confirm(ask)) return;
                      onRemove(teacher);
                    }}
                    className={btnSecondary}
                  >
                    {teacher.alsoInstructor ? "동아리샘 역할 해제" : "제거"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// 동아리샘 등록: 두 모드
//  - 신규 등록: 이름/전화/이메일 입력 → 새 계정 + 초대링크
//  - 기존 강사 선택: 강사 목록에서 골라 동아리 역할만 추가(겸직). 계정/비번 안 건드림.
function TeacherForm({
  pending,
  instructors,
  onCreate,
  onAddRole,
}: {
  pending: boolean;
  instructors: InstructorPickRow[];
  onCreate: (input: { name: string; phone: string; email?: string }) => void;
  onAddRole: (instructorId: string) => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pickId, setPickId] = useState("");

  // 아직 동아리 역할이 없는 강사만 겸직 지정 후보로 노출
  const candidates = instructors.filter((i) => !i.alreadyClub);

  return (
    <div className={panelCls}>
      <h2 className={sectionTitleCls("green")}>동아리샘 등록</h2>
      <p className="mt-1 text-xs text-ink-muted">
        강사가 동아리도 맡으면 새 계정을 만들지 말고 “기존 강사에서 추가”로 겸직
        지정하세요. 계정·비밀번호는 그대로 유지됩니다.
      </p>

      <div className="mt-3 flex gap-1 rounded-lg bg-surface p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("new")}
          className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${
            mode === "new" ? "bg-card text-navy shadow-sm" : "text-ink-muted"
          }`}
        >
          신규 등록
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${
            mode === "existing"
              ? "bg-card text-navy shadow-sm"
              : "text-ink-muted"
          }`}
        >
          기존 강사에서 추가
        </button>
      </div>

      {mode === "new" ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate({ name, phone, email });
            setName("");
            setPhone("");
            setEmail("");
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름"
              className={inputCls}
              required
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="전화번호"
              className={inputCls}
              required
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일(선택)"
              className={`${inputCls} sm:col-span-2`}
            />
          </div>
          <p className="mt-2 text-xs text-ink-hint">
            이미 강사로 등록된 전화번호면 자동으로 겸직(역할 추가)으로 처리됩니다.
          </p>
          <button type="submit" disabled={pending} className={`${btnPrimary} mt-3`}>
            등록하고 초대 링크 만들기
          </button>
        </form>
      ) : (
        <div className="mt-3">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className={inputCls}
          >
            <option value="">강사 선택…</option>
            {candidates.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.phone ? ` (${i.phone})` : ""}
              </option>
            ))}
          </select>
          {candidates.length === 0 && (
            <p className="mt-2 text-xs text-ink-hint">
              추가할 수 있는 강사가 없습니다. (모든 강사가 이미 동아리 역할을
              가지고 있거나, 등록된 강사가 없습니다)
            </p>
          )}
          <button
            type="button"
            disabled={pending || !pickId}
            onClick={() => {
              if (pickId) onAddRole(pickId);
              setPickId("");
            }}
            className={`${btnPrimary} mt-3`}
          >
            동아리샘 역할 추가 (겸직)
          </button>
        </div>
      )}
    </div>
  );
}

function ClubForm({
  year,
  teachers,
  pending,
  onSubmit,
}: {
  year: number;
  teachers: ClubDashboardData["teachers"];
  pending: boolean;
  onSubmit: (input: Parameters<typeof createClub>[0]) => void;
}) {
  const [name, setName] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [capacity, setCapacity] = useState("");
  const [room, setRoom] = useState("");
  const [goal, setGoal] = useState("");
  return (
    <form
      className={panelCls}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          year,
          name,
          teacherId: teacherId || null,
          target: "청소년",
          capacity: capacity ? Number(capacity) : null,
          room,
          goal,
        });
      }}
    >
      <h2 className={sectionTitleCls("yellow")}>동아리 등록</h2>
      <p className="mt-1 text-xs text-ink-muted">
        {year}년 동아리와 담당 동아리샘을 연결합니다.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="동아리명"
          className={inputCls}
          required
        />
        <select
          value={teacherId}
          onChange={(e) => setTeacherId(e.target.value)}
          className={inputCls}
        >
          <option value="">동아리샘 미지정</option>
          {/* 담당샘 후보 = 계정이 살아 있고(로그인 가능) 동아리샘 역할도 활성인 사람만 */}
          {teachers
            .filter((t) => t.status === "active" && t.roleStatus === "active")
            .map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
                {teacher.alsoInstructor ? " (강사 겸직)" : ""}
              </option>
            ))}
        </select>
        <input
          type="number"
          min={0}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="등록 인원"
          className={inputCls}
        />
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="기본 활동 장소"
          className={inputCls}
        />
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="목적 및 목표"
          rows={2}
          className={`${inputCls} sm:col-span-2`}
        />
      </div>
      <button type="submit" disabled={pending} className={`${btnPrimary} mt-3`}>
        동아리 등록
      </button>
    </form>
  );
}

function ClubCard({
  club,
  year,
  month,
  pending,
  run,
  onPlanChanged,
}: {
  club: ClubMonthRow;
  year: number;
  month: number;
  pending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string
  ) => void;
  // 계획서를 고치면 위 제출 현황 표도 새로 읽어야 합니다.
  onPlanChanged: () => void;
}) {
  const defaultDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const [sessionDate, setSessionDate] = useState(defaultDate);
  const [expenseDate, setExpenseDate] = useState(defaultDate);
  const [category, setCategory] = useState("사업비");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [sessionContent, setSessionContent] = useState("");
  const [sessionLocation, setSessionLocation] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [planCategory, setPlanCategory] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  const [planAmount, setPlanAmount] = useState("");
  const [open, setOpen] = useState(false);
  // 계획서 패널 — 열었을 때만 서버에서 읽어옵니다(동아리 12개를 한꺼번에
  //   불러오지 않게).
  const [planOpen, setPlanOpen] = useState(false);
  const executionRate =
    club.budgetPlanTotal > 0
      ? Math.round((club.expenseTotal / club.budgetPlanTotal) * 100)
      : 0;
  const ready = club.sessionCount > 0 && club.submittedCount === club.sessionCount;
  const statusClass =
    club.reportStatus === "confirmed"
      ? badgeSuccess
      : ready
      ? badgeWarning
      : badgeNeutral;
  return (
    <article className={blockCls}>
      {/* 접기 토글과 삭제는 형제 버튼 — 토글 안에 버튼을 넣으면 중첩이 된다. */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left"
        >
          <span className="text-xs text-ink-hint">{open ? "▼" : "▶"}</span>
          <span className="font-bold text-ink">{club.name}</span>
          <span className="text-xs text-ink-muted">
            {club.teacherName ? `동아리샘 ${club.teacherName}` : "동아리샘 미지정"}
            {club.room ? ` · ${club.room}` : ""}
          </span>
          <span className="text-xs text-ink-muted">
            활동 {club.sessionCount}회 · 제출 {club.submittedCount}/
            {club.sessionCount} · 연인원 {club.attendanceTotal}명
          </span>
          <span className={`ml-auto shrink-0 ${statusClass}`}>
            {club.reportStatus === "confirmed"
              ? "월간보고 확정"
              : ready
              ? "확정 가능"
              : "작성 중"}
          </span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `'${club.name}' 동아리를 삭제할까요? 활동계획·예산계획·등록학생이 함께 삭제되며 되돌릴 수 없습니다.`
              )
            )
              return;
            run(
              () => deleteClub({ programId: club.id }),
              "동아리를 삭제했습니다. 사업실적에 이미 반영된 수치는 자동으로 지워지지 않습니다. 필요하면 사업실적에서 확인해주세요."
            );
          }}
          className={`${btnDanger} shrink-0`}
        >
          삭제
        </button>
      </div>
      {open && (
        <>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <Metric label="등록" value={`${club.registeredCount}명`} />
          <Metric label="활동" value={`${club.sessionCount}회`} />
          <Metric label="제출" value={`${club.submittedCount}/${club.sessionCount}`} />
          <Metric label="연인원" value={`${club.attendanceTotal}명`} />
          <Metric
            label="예산"
            value={`${club.expenseTotal.toLocaleString("ko-KR")}원`}
          />
        </dl>

        {/* 계획서 (연간) — 결과보고·월간보고 흐름과 별개입니다.
            아래 '이 달 활동계획' 은 그 달만 보여주는 월간보고용이고, 여기는
            한 해 전체를 쓰는 곳입니다. 둘 다 같은 saem_sessions 를 보므로
            여기서 회차를 추가하면 그 달이 오면 아래에도 나타납니다. */}
        <details
          className="mt-3 rounded-lg border border-brand-blue/30 bg-brand-blue-soft/20 p-3"
          open={planOpen}
          onToggle={(e) => setPlanOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-navy">
            계획서 작성·제출
            <span className={club.planSubmittedAt ? badgeSuccess : badgeWarning}>
              {club.planSubmittedAt
                ? `제출 ${club.planSubmittedAt.slice(0, 10).replaceAll("-", ".")}`
                : "미제출"}
            </span>
          </summary>
          {/* 열었을 때만 불러옵니다 — 12개 동아리를 한꺼번에 읽지 않게. */}
          {planOpen && (
            <div className="mt-3">
              <ClubPlanEditor
                programId={club.id}
                year={year}
                onChanged={onPlanChanged}
              />
            </div>
          )}
        </details>

        <div className="mt-3">
          <p className="text-sm font-semibold text-navy">이 달 활동계획</p>
          {club.sessions.length === 0 ? (
            <p className="mt-2 text-xs text-ink-muted">
              이 달 활동계획이 없습니다.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className={tableHeadCls}>
                    <th className="py-1.5 pr-2 font-medium">회차</th>
                    <th className="py-1.5 pr-2 font-medium">날짜</th>
                    <th className="py-1.5 pr-2 font-medium">활동내용</th>
                    <th className="py-1.5 pr-2 font-medium">장소</th>
                    <th className="py-1.5 pr-2 font-medium">참여인원</th>
                    <th className="py-1.5 pr-2 font-medium">상태</th>
                    <th className="py-1.5 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {club.sessions.map((session) =>
                    editingId === session.id ? (
                      <tr key={session.id} className={tableRowCls}>
                        <td colSpan={7} className="py-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className={inputCls}
                            />
                            <input
                              value={editLocation}
                              onChange={(e) => setEditLocation(e.target.value)}
                              placeholder="활동장소"
                              className={inputCls}
                            />
                            <textarea
                              rows={2}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              placeholder="활동내용"
                              className={`${inputCls} sm:col-span-2`}
                            />
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(async () => {
                                  const result = await updateClubSession({
                                    sessionId: session.id,
                                    date: editDate,
                                    content: editContent,
                                    location: editLocation,
                                  });
                                  if (result.ok) setEditingId(null);
                                  return result;
                                }, "활동계획을 수정했습니다.")
                              }
                              className={btnSecondary}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className={btnSecondary}
                            >
                              취소
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={session.id}
                        className={`${tableRowCls} align-top`}
                      >
                        <td className="py-2 pr-2 text-ink-body">
                          {session.sessionNo}
                        </td>
                        <td className="py-2 pr-2 text-ink-body">
                          {session.date}
                        </td>
                        <td className="py-2 pr-2 text-ink-body">
                          {session.planContent || "-"}
                          {session.submitted && session.logContent ? (
                            <span className="mt-0.5 block text-xs text-ink-muted">
                              기록: {session.logContent}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-2 text-ink-body">
                          {session.location || "-"}
                        </td>
                        <td className="py-2 pr-2 text-ink-body">
                          {session.participants}명
                        </td>
                        <td className="py-2 pr-2">
                          <span
                            className={
                              session.submitted ? badgeSuccess : badgeNeutral
                            }
                          >
                            {session.submitted ? "제출완료" : "예정"}
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setEditingId(session.id);
                                setEditDate(session.date);
                                setEditContent(session.planContent);
                                setEditLocation(session.location);
                              }}
                              className={btnSecondary}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              disabled={pending || session.submitted}
                              onClick={() =>
                                run(
                                  () =>
                                    deleteClubSession({ sessionId: session.id }),
                                  "활동계획을 삭제했습니다."
                                )
                              }
                              className={btnSecondary}
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <details className="mt-3 rounded-lg bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold text-navy">
            {year}년 예산 사용 계획
          </summary>
          <div className="mt-3">
            {club.budgetPlans.length === 0 ? (
              <p className="text-xs text-ink-muted">예산계획이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <thead>
                    <tr className={tableHeadCls}>
                      <th className="py-1.5 pr-2 font-medium">항목</th>
                      <th className="py-1.5 pr-2 font-medium">내역</th>
                      <th className="py-1.5 pr-2 text-right font-medium">계획액</th>
                      <th className="py-1.5 font-medium">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {club.budgetPlans.map((plan: ClubBudgetPlanRow) => (
                      <tr key={plan.id} className={tableRowCls}>
                        <td className="py-2 pr-2 text-ink-body">{plan.category}</td>
                        <td className="py-2 pr-2 text-ink-body">
                          {plan.description || "-"}
                        </td>
                        <td className="py-2 pr-2 text-right text-ink-body">
                          {plan.amount.toLocaleString("ko-KR")}원
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => deleteClubBudgetPlan({ planId: plan.id }),
                                "예산계획을 삭제했습니다."
                              )
                            }
                            className={btnSecondary}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-muted">
              계획 합계 {club.budgetPlanTotal.toLocaleString("ko-KR")}원 · 집행{" "}
              {club.expenseTotal.toLocaleString("ko-KR")}원 (
              <span
                className={executionRate > 100 ? "font-semibold text-stamp" : ""}
              >
                {executionRate}%
              </span>
              )
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                value={planCategory}
                onChange={(e) => setPlanCategory(e.target.value)}
                placeholder="예산 항목"
                className={inputCls}
              />
              <input
                type="number"
                min={0}
                value={planAmount}
                onChange={(e) => setPlanAmount(e.target.value)}
                placeholder="계획액"
                className={inputCls}
              />
              <input
                value={planDescription}
                onChange={(e) => setPlanDescription(e.target.value)}
                placeholder="내역"
                className={`${inputCls} col-span-2`}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await addClubBudgetPlan({
                      programId: club.id,
                      year,
                      category: planCategory,
                      description: planDescription,
                      amount: Number(planAmount),
                    });
                    if (result.ok) {
                      setPlanCategory("");
                      setPlanDescription("");
                      setPlanAmount("");
                    }
                    return result;
                  }, "예산계획을 추가했습니다.")
                }
                className={`${btnSecondary} col-span-2`}
              >
                예산계획 추가
              </button>
            </div>
          </div>
        </details>
        <details className="mt-3 rounded-lg bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold text-navy">
            활동·예산 추가
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className={inputCls}
              />
              <input
                value={sessionLocation}
                onChange={(e) => setSessionLocation(e.target.value)}
                placeholder="활동장소"
                className={inputCls}
              />
              <textarea
                rows={2}
                value={sessionContent}
                onChange={(e) => setSessionContent(e.target.value)}
                placeholder="활동내용"
                className={`${inputCls} col-span-2`}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await addClubSession({
                      programId: club.id,
                      date: sessionDate,
                      content: sessionContent,
                      location: sessionLocation,
                    });
                    if (result.ok) {
                      setSessionContent("");
                      setSessionLocation("");
                    }
                    return result;
                  }, "활동계획을 추가했습니다.")
                }
                className={`${btnSecondary} col-span-2`}
              >
                활동일 추가
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className={inputCls}
              />
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예산 항목"
                className={inputCls}
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="지출내역"
                className={inputCls}
              />
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="금액"
                className={inputCls}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      addClubExpense({
                        programId: club.id,
                        date: expenseDate,
                        budgetCategory: category,
                        description,
                        amount: Number(amount),
                      }),
                    "예산 내역을 추가했습니다."
                  )
                }
                className={`${btnSecondary} col-span-2`}
              >
                예산 추가
              </button>
            </div>
          </div>
        </details>
        {club.reportStatus !== "confirmed" && (
          <button
            type="button"
            disabled={pending || !ready}
            onClick={() =>
              run(
                () => confirmClubReport({ programId: club.id, year, month }),
                `${club.name} ${month}월 보고를 확정했습니다.`
              )
            }
            className={`${btnPrimary} mt-3`}
          >
            {ready ? "월간보고 확정" : "활동일지 제출 후 확정 가능"}
          </button>
        )}
        </>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-hint">{label}</dt>
      <dd className="font-semibold text-ink-body">{value}</dd>
    </div>
  );
}
