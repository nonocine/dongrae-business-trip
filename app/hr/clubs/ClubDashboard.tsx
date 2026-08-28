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
  deleteClubBudgetPlan,
  deleteClubSession,
  updateClubSession,
  syncClubBusinessResult,
  type ClubBudgetPlanRow,
  type ClubDashboardData,
  type ClubMonthRow,
  type InstructorPickRow,
} from "@/app/hr/clubs/actions";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const inputCls =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

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
      <section className={cardCls}>
        <h1 className="text-xl font-bold text-ink">동아리관리 준비가 필요합니다</h1>
        <p className="mt-2 text-sm text-ink-muted">
          동아리관리 데이터베이스 변경사항을 먼저 적용한 뒤 사용할 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-brand-blue">동래샘들 연계</p>
            <h1 className="mt-1 text-xl font-bold text-ink">청소년동아리 관리</h1>
            <p className="mt-1 text-sm text-ink-muted">
              동아리샘의 활동일지와 출석을 월간보고·사업실적으로 연결합니다.
            </p>
          </div>
          <Link href="/business-results" className={btnSecondary}>
            사업실적 보기
          </Link>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-surface px-3 py-2">
          <button type="button" onClick={() => moveMonth(-1)} className={btnSecondary}>
            이전 달
          </button>
          <strong className="text-base text-navy">
            {year}년 {month}월
          </strong>
          <button type="button" onClick={() => moveMonth(1)} className={btnSecondary}>
            다음 달
          </button>
        </div>
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

      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-ink">{month}월 제출 현황</h2>
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
          <div className="mt-4 space-y-3">
            {data.clubs.map((club) => (
              <ClubCard
                key={club.id}
                club={club}
                year={year}
                month={month}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className={cardCls}>
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-navy">{value}</p>
    </div>
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
    <div className={cardCls}>
      <h2 className="text-base font-bold text-ink">동아리샘 등록</h2>
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
      className={cardCls}
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
      <h2 className="text-base font-bold text-ink">동아리 등록</h2>
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
          {teachers
            .filter((t) => t.status === "active")
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
}: {
  club: ClubMonthRow;
  year: number;
  month: number;
  pending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string
  ) => void;
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
    <article className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-ink">{club.name}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {club.teacherName ? `동아리샘 ${club.teacherName}` : "동아리샘 미지정"}
            {club.room ? ` · ${club.room}` : ""}
          </p>
        </div>
        <span className={statusClass}>
          {club.reportStatus === "confirmed"
            ? "월간보고 확정"
            : ready
            ? "확정 가능"
            : "작성 중"}
        </span>
      </div>
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
                <tr className="border-b border-line text-left text-xs text-ink-hint">
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
                    <tr key={session.id} className="border-b border-line">
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
                      className="border-b border-line align-top"
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
                  <tr className="border-b border-line text-left text-xs text-ink-hint">
                    <th className="py-1.5 pr-2 font-medium">항목</th>
                    <th className="py-1.5 pr-2 font-medium">내역</th>
                    <th className="py-1.5 pr-2 text-right font-medium">계획액</th>
                    <th className="py-1.5 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {club.budgetPlans.map((plan: ClubBudgetPlanRow) => (
                    <tr key={plan.id} className="border-b border-line">
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
