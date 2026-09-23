"use client";

import { useEffect, useState, useTransition } from "react";
import {
  addClubBudgetPlan,
  addClubSession,
  deleteClubBudgetPlan,
  deleteClubSession,
  getClubPlan,
  saveClubGoal,
  submitClubPlan,
  unsubmitClubPlan,
  updateClubSession,
  type ClubPlanData,
} from "./actions";
import {
  badgeNeutral,
  badgeSuccess,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// =====================================================================
// 동아리 계획서 작성·제출 (2026-09)
//
//   김준호 선생님 요청 — 결과보고 제출란만 있고 계획서 제출란이 없었습니다.
//
//   ★ 한 해 단위입니다. 위 대시보드의 '이 달 활동계획' 은 그 달만 보여주는데,
//     계획은 9월에 10월 것을 쓰는 게 정상이라 월로 묶으면 쓸 수가 없습니다.
//     예산계획 테이블도 연도(plan_year) 기준이라 연 단위가 맞습니다.
//
//   ★ 기존 회차를 덮어쓰지 않습니다. 이미 들어 있는 활동내용·장소를 그대로
//     불러와 이어서 고칩니다. 활동일지가 제출된 회차는 지울 수 없습니다.
// =====================================================================

// "2026-09-23T01:45:50Z" → "2026.09.23"
function fmtDay(iso: string | null): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default function ClubPlanEditor({
  programId,
  year,
  onChanged,
}: {
  programId: string;
  year: number;
  // 저장 뒤 목록(제출 현황)을 새로 읽게 하려고 부모에게 알립니다.
  onChanged: () => void;
}) {
  const [plan, setPlan] = useState<ClubPlanData | null>(null);
  // 무엇을 불러온 결과인지 함께 들고 있습니다. programId·year 가 바뀌면
  //   effect 안에서 setState 로 초기화하지 않고, 렌더 중에 "아직 그 값이
  //   아니다" 로 판단합니다(첫 프레임에 옛 계획서가 스치지 않게).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 목표 — 입력 중에는 로컬 상태, [저장] 을 눌러야 반영됩니다.
  const [goal, setGoal] = useState("");

  // 회차 추가 폼
  const [newDate, setNewDate] = useState(`${year}-01-01`);
  const [newContent, setNewContent] = useState("");
  const [newLocation, setNewLocation] = useState("");

  // 회차 수정 — 편집 중인 행 하나만.
  const [editId, setEditId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editLocation, setEditLocation] = useState("");

  // 예산 추가 폼
  const [bCategory, setBCategory] = useState("");
  const [bDescription, setBDescription] = useState("");
  const [bAmount, setBAmount] = useState("");

  const key = `${programId}|${year}`;

  // 마운트 시 로드 — EmployeeProfileForm 의 담당 직무 로드와 같은 방식입니다.
  //   (effect 안에서 동기 setState 를 하지 않고 then 안에서 채웁니다.
  //    alive 로 늦게 도착한 응답이 다른 동아리 화면을 덮지 않게 막습니다.)
  useEffect(() => {
    let alive = true;
    getClubPlan(programId, year).then((data) => {
      if (!alive) return;
      setPlan(data);
      setGoal(data?.goal ?? "");
      setLoadedFor(`${programId}|${year}`);
    });
    return () => {
      alive = false;
    };
  }, [programId, year]);

  // 저장 뒤 다시 읽기.
  async function load() {
    const data = await getClubPlan(programId, year);
    setPlan(data);
    setGoal(data?.goal ?? "");
    setLoadedFor(key);
  }

  // 아직 이 동아리/연도의 계획서를 못 받았으면 로딩으로 봅니다.
  const loading = loadedFor !== key;

  // 서버 액션 실행 공통 — 성공하면 계획서를 다시 읽고 부모에게 알립니다.
  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string,
    after?: () => void,
  ) {
    setMsg(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setMsg({ ok: false, text: result.message ?? "처리하지 못했습니다." });
        return;
      }
      after?.();
      await load();
      onChanged();
      setMsg({ ok: true, text: success });
    });
  }

  if (loading) {
    return (
      <p className="py-6 text-center text-sm text-ink-hint">
        계획서를 불러오는 중…
      </p>
    );
  }
  if (!plan) {
    return (
      <p className="py-6 text-center text-sm text-ink-muted">
        계획서를 불러오지 못했습니다.
      </p>
    );
  }

  const submitted = !!plan.planSubmittedAt;
  const balance = plan.budgetPlanTotal - plan.expenseTotal;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
        <span className="text-sm font-semibold text-navy">
          {plan.year}년 계획서
        </span>
        <span className="flex items-center gap-2">
          <span className={submitted ? badgeSuccess : badgeNeutral}>
            {submitted ? `제출 ${fmtDay(plan.planSubmittedAt)}` : "미제출"}
          </span>
          {submitted ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => unsubmitClubPlan({ programId }),
                  "계획서 제출을 취소했습니다. (내용은 그대로 남아 있습니다)",
                )
              }
              className={btnSecondary}
            >
              제출 취소
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => submitClubPlan({ programId }),
                submitted
                  ? "계획서를 다시 제출했습니다."
                  : "계획서를 제출했습니다.",
              )
            }
            className={btnPrimary}
          >
            {submitted ? "다시 제출" : "계획서 제출"}
          </button>
        </span>
      </div>

      {submitted && (
        <p className="text-xs text-ink-muted">
          제출한 뒤에도 목표·활동계획·예산을 계속 고칠 수 있습니다. 고친 뒤
          [다시 제출] 을 누르면 제출 시각만 새로 기록됩니다.
        </p>
      )}

      {msg && (
        <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>
      )}

      {/* --- 목표 --- */}
      <div>
        <label className={labelCls}>
          동아리 목표
          <textarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="이 동아리가 올해 이루려는 것을 적어주세요."
            className={inputCls}
          />
        </label>
        <button
          type="button"
          disabled={pending || goal === (plan.goal ?? "")}
          onClick={() =>
            run(() => saveClubGoal({ programId, goal }), "목표를 저장했습니다.")
          }
          className={`${btnSecondary} mt-2`}
        >
          목표 저장
        </button>
      </div>

      {/* --- 활동계획 --- */}
      <div>
        <p className="text-sm font-semibold text-navy">
          활동계획{" "}
          <span className="font-normal text-ink-muted">
            ({plan.sessions.length}회)
          </span>
        </p>
        {plan.sessions.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            아직 활동계획이 없습니다. 아래에서 회차를 추가해주세요.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-hint">
                  <th className="py-1.5 pr-2 font-medium">회차</th>
                  <th className="py-1.5 pr-2 font-medium">날짜</th>
                  <th className="py-1.5 pr-2 font-medium">활동내용</th>
                  <th className="py-1.5 pr-2 font-medium">장소</th>
                  <th className="py-1.5 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {plan.sessions.map((s) =>
                  editId === s.id ? (
                    <tr key={s.id} className="border-b border-line">
                      <td colSpan={5} className="py-2">
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
                          <input
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
                              run(
                                () =>
                                  updateClubSession({
                                    sessionId: s.id,
                                    date: editDate,
                                    content: editContent,
                                    location: editLocation,
                                  }),
                                "활동계획을 수정했습니다.",
                                () => setEditId(null),
                              )
                            }
                            className={btnPrimary}
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditId(null)}
                            className={btnSecondary}
                          >
                            취소
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id} className="border-b border-line">
                      <td className="py-2 pr-2 text-ink-muted">
                        {s.sessionNo}회
                      </td>
                      <td className="py-2 pr-2 text-ink-body">{s.date}</td>
                      <td className="py-2 pr-2 text-ink-body">
                        {s.content || (
                          <span className="text-ink-hint">(미입력)</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-ink-body">
                        {s.location || (
                          <span className="text-ink-hint">(미입력)</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setEditId(s.id);
                              setEditDate(s.date);
                              setEditContent(s.content);
                              setEditLocation(s.location);
                            }}
                            className={btnSecondary}
                          >
                            수정
                          </button>
                          {/* 활동일지가 들어온 회차는 실적이라 지우지 않습니다. */}
                          {s.logged ? (
                            <span className="self-center text-[11px] text-ink-hint">
                              일지 작성됨
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => deleteClubSession({ sessionId: s.id }),
                                  "활동계획을 삭제했습니다.",
                                )
                              }
                              className={btnDanger}
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className={inputCls}
          />
          <input
            value={newLocation}
            onChange={(e) => setNewLocation(e.target.value)}
            placeholder="활동장소"
            className={inputCls}
          />
          <input
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="활동내용"
            className={`${inputCls} sm:col-span-2`}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  addClubSession({
                    programId,
                    date: newDate,
                    content: newContent,
                    location: newLocation,
                  }),
                "활동계획을 추가했습니다.",
                () => {
                  setNewContent("");
                  setNewLocation("");
                },
              )
            }
            className={`${btnSecondary} sm:col-span-2`}
          >
            회차 추가
          </button>
        </div>
      </div>

      {/* --- 예산 사용 계획 --- */}
      <div>
        <p className="text-sm font-semibold text-navy">예산 사용 계획</p>
        {plan.budgetPlans.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            아직 예산계획이 없습니다. 아래에서 항목을 추가해주세요.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-hint">
                  <th className="py-1.5 pr-2 font-medium">구분</th>
                  <th className="py-1.5 pr-2 font-medium">내역</th>
                  <th className="py-1.5 pr-2 text-right font-medium">금액</th>
                  <th className="py-1.5 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {plan.budgetPlans.map((b) => (
                  <tr key={b.id} className="border-b border-line">
                    <td className="py-2 pr-2 text-ink-body">{b.category}</td>
                    <td className="py-2 pr-2 text-ink-body">
                      {b.description || "-"}
                    </td>
                    <td className="py-2 pr-2 text-right text-ink-body">
                      {won(b.amount)}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => deleteClubBudgetPlan({ planId: b.id }),
                            "예산계획을 삭제했습니다.",
                          )
                        }
                        className={btnDanger}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold text-ink">
                  <td className="py-2 pr-2" colSpan={2}>
                    합계
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {won(plan.budgetPlanTotal)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            value={bCategory}
            onChange={(e) => setBCategory(e.target.value)}
            placeholder="구분 (예: 재료비)"
            className={inputCls}
          />
          <input
            type="number"
            min={0}
            value={bAmount}
            onChange={(e) => setBAmount(e.target.value)}
            placeholder="금액"
            className={inputCls}
          />
          <input
            value={bDescription}
            onChange={(e) => setBDescription(e.target.value)}
            placeholder="내역"
            className={`${inputCls} col-span-2`}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  addClubBudgetPlan({
                    programId,
                    year,
                    category: bCategory,
                    description: bDescription,
                    amount: Number(bAmount),
                  }),
                "예산계획을 추가했습니다.",
                () => {
                  setBCategory("");
                  setBDescription("");
                  setBAmount("");
                },
              )
            }
            className={`${btnSecondary} col-span-2`}
          >
            예산 항목 추가
          </button>
        </div>
      </div>

      {/* --- 계획 대비 실적 ---
          실제 지출은 이미 saem_club_expenses 에 따로 쌓이고 있어, 계획과
          비교만 하면 됩니다. 복잡한 분석은 하지 않습니다. */}
      <div className="rounded-lg border border-line bg-surface p-3">
        <p className="text-sm font-semibold text-navy">
          계획 대비 실적 ({plan.year}년)
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-ink-hint">계획 합계</dt>
            <dd className="font-semibold text-ink">
              {won(plan.budgetPlanTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-hint">사용 합계</dt>
            <dd className="font-semibold text-ink">{won(plan.expenseTotal)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-hint">잔액</dt>
            <dd
              className={`font-semibold ${
                balance < 0 ? "text-stamp" : "text-ink"
              }`}
            >
              {won(balance)}
            </dd>
          </div>
        </dl>
        {balance < 0 && (
          <p className="mt-2 text-xs font-medium text-stamp">
            계획보다 {won(-balance)} 더 썼습니다.
          </p>
        )}
      </div>
    </div>
  );
}
