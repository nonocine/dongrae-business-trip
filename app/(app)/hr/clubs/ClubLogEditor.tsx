"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getClubLogs,
  saveClubLog,
  type ClubLogData,
  type ClubLogSession,
} from "./actions";
import {
  CLUB_LOG_STATE_LABEL,
  clubLogState,
  type ClubLogState,
} from "@/lib/clubLog";
import {
  badgeNeutral,
  badgeNavy,
  badgeSuccess,
  badgeWarning,
  blockCls,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 동아리 활동일지 작성·수정·제출 (2026-10, 김준호 선생님 요청)
//
//   ★ 계획서와 다른 칸입니다.
//       계획(plan_content) — 미리 쓰는 것. 위 '계획서 작성·제출' 에서 고칩니다.
//       일지(log_content)  — 활동을 마친 뒤 쓰는 것. 여기서 씁니다.
//     계획은 참고로만 보여주고, 일지 칸에 자동으로 채우지 않습니다
//     (필요하면 [계획 내용 가져오기] 로 옮겨 적은 뒤 고칩니다).
//
//   ★ 동래샘들 앱과 같은 데이터(saem_sessions)입니다. 강사가 앱에서 쓴 일지가
//     여기 그대로 보이고, 여기서 고친 내용이 앱에도 보입니다.
//
//   ★ 잠금(직원 확정·정산·월간보고 확정)은 lib/clubLog — 서버가 다시 확인합니다.
// =====================================================================

const STATE_BADGE: Record<ClubLogState | "todo", string> = {
  confirmed: badgeSuccess,
  signed: badgeSuccess,
  staff: badgeNavy,
  draft: badgeWarning,
  empty: badgeNeutral,
  todo: badgeWarning,
};

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stateOf(s: ClubLogSession) {
  return clubLogState({
    staffConfirmedAt: s.staffConfirmedAt,
    submittedAt: s.submittedAt,
    signedAt: s.signedAt,
    logContent: s.logContent,
  });
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export default function ClubLogEditor({
  programId,
  year,
  onChanged,
}: {
  programId: string;
  year: number;
  // 저장 뒤 아래 '이 달' 표(제출 수·연인원)를 새로 읽게 부모에게 알립니다.
  onChanged: () => void;
}) {
  const [data, setData] = useState<ClubLogData | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 편집 중인 회차 하나만.
  const [editId, setEditId] = useState<string | null>(null);
  const [fDate, setFDate] = useState("");
  const [fLocation, setFLocation] = useState("");
  const [fHours, setFHours] = useState("");
  const [fCount, setFCount] = useState("");
  const [fLog, setFLog] = useState("");
  const [fConfirmSigned, setFConfirmSigned] = useState(false);

  const key = `${programId}|${year}`;

  useEffect(() => {
    let alive = true;
    getClubLogs(programId, year).then((d) => {
      if (!alive) return;
      setData(d);
      setLoadedFor(`${programId}|${year}`);
    });
    return () => {
      alive = false;
    };
  }, [programId, year]);

  async function load() {
    setData(await getClubLogs(programId, year));
    setLoadedFor(key);
  }

  function openEdit(s: ClubLogSession) {
    setMsg(null);
    setEditId(s.id);
    setFDate(s.date);
    setFLocation(s.location);
    setFHours(s.workHours == null ? "" : String(s.workHours));
    setFCount(s.studentCount == null ? "" : String(s.studentCount));
    setFLog(s.logContent);
    setFConfirmSigned(false);
  }

  function save(s: ClubLogSession, submit: boolean) {
    setMsg(null);
    start(async () => {
      const result = await saveClubLog({
        sessionId: s.id,
        date: fDate,
        location: fLocation,
        workHours: numOrNull(fHours),
        studentCount: numOrNull(fCount),
        logContent: fLog,
        submit,
        confirmSigned: fConfirmSigned,
      });
      if (!result.ok) {
        setMsg({ ok: false, text: result.message ?? "저장하지 못했습니다." });
        return;
      }
      setEditId(null);
      await load();
      onChanged();
      setMsg({
        ok: true,
        text: submit
          ? `${s.sessionNo}회차 활동일지를 제출했습니다.`
          : `${s.sessionNo}회차 활동일지를 임시저장했습니다. (아직 제출 전)`,
      });
    });
  }

  if (loadedFor !== key) {
    return (
      <p className="py-6 text-center text-sm text-ink-hint">
        활동일지를 불러오는 중…
      </p>
    );
  }
  if (!data) {
    return (
      <p className="py-6 text-center text-sm text-ink-muted">
        활동일지를 불러오지 못했습니다.
      </p>
    );
  }

  const today = todayYmd();
  const submittedCount = data.sessions.filter((s) => s.submittedAt).length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        활동을 마친 뒤 쓰는 기록입니다. 동래샘들 앱에서 강사가 쓴 일지와 같은
        곳에 저장됩니다. 미리 쓰는 활동계획은 위 &lsquo;계획서 작성·제출&rsquo;
        에서 고치세요. ({data.year}년 {data.sessions.length}회 중 제출{" "}
        {submittedCount}회)
      </p>

      {msg && (
        <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>
      )}

      {data.sessions.length === 0 ? (
        <p className="text-xs text-ink-muted">
          {data.year}년 회차가 없습니다. 계획서에서 회차를 먼저 추가해주세요.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="py-1.5 pr-2 font-medium">회차</th>
                <th className="py-1.5 pr-2 font-medium">날짜</th>
                <th className="py-1.5 pr-2 font-medium">활동일지</th>
                <th className="py-1.5 pr-2 font-medium">장소</th>
                <th className="py-1.5 pr-2 font-medium">시간</th>
                <th className="py-1.5 pr-2 font-medium">인원</th>
                <th className="py-1.5 pr-2 font-medium">상태</th>
                <th className="py-1.5 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => {
                const st = stateOf(s);
                const todo = st === "empty" && !!s.date && s.date <= today;
                if (editId === s.id) {
                  return (
                    <tr key={s.id} className={tableRowCls}>
                      <td colSpan={8} className="py-2">
                        <div className={`${blockCls} space-y-2`}>
                          <p className="text-sm font-semibold text-navy">
                            {s.sessionNo}회차 활동일지
                          </p>
                          <p className="rounded-md border border-dashed border-rule px-2.5 py-1.5 text-xs text-ink-muted">
                            <span className="font-semibold">계획(참고)</span>{" "}
                            {s.planContent || "계획 내용 없음"}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-4">
                            <label className={labelCls}>
                              활동일
                              <input
                                type="date"
                                value={fDate}
                                onChange={(e) => setFDate(e.target.value)}
                                className={inputCls}
                              />
                            </label>
                            <label className={labelCls}>
                              장소
                              <input
                                value={fLocation}
                                onChange={(e) => setFLocation(e.target.value)}
                                placeholder="활동장소"
                                className={inputCls}
                              />
                            </label>
                            <label className={labelCls}>
                              활동시간(시간)
                              <input
                                type="number"
                                min={0}
                                max={24}
                                step={0.5}
                                value={fHours}
                                onChange={(e) => setFHours(e.target.value)}
                                placeholder="예: 2"
                                className={inputCls}
                              />
                            </label>
                            <label className={labelCls}>
                              참여인원(명)
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={fCount}
                                onChange={(e) => setFCount(e.target.value)}
                                placeholder="예: 12"
                                className={inputCls}
                              />
                            </label>
                          </div>
                          <label className={labelCls}>
                            활동 내용(일지)
                            <textarea
                              rows={4}
                              value={fLog}
                              onChange={(e) => setFLog(e.target.value)}
                              placeholder="실제로 한 활동을 적어주세요."
                              className={inputCls}
                            />
                          </label>
                          {!fLog.trim() && s.planContent ? (
                            <button
                              type="button"
                              onClick={() => setFLog(s.planContent)}
                              className={btnSecondary}
                            >
                              계획 내용 가져오기
                            </button>
                          ) : null}
                          {s.signedAt ? (
                            <label className="flex items-start gap-2 text-xs text-stamp">
                              <input
                                type="checkbox"
                                checked={fConfirmSigned}
                                onChange={(e) =>
                                  setFConfirmSigned(e.target.checked)
                                }
                                className="mt-0.5"
                              />
                              강사가 동래샘들에서 서명해 제출한 일지입니다.
                              고치면 서명 뒤 내용이 바뀝니다 — 확인했습니다.
                            </label>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => save(s, false)}
                              className={btnSecondary}
                            >
                              {s.submittedAt ? "수정 저장" : "임시저장"}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => save(s, true)}
                              className={btnPrimary}
                            >
                              {s.submittedAt ? "수정 후 다시 제출" : "제출"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditId(null)}
                              className={btnSecondary}
                            >
                              취소
                            </button>
                          </div>
                          {s.submittedAt ? (
                            <p className="text-[11px] text-ink-hint">
                              [수정 저장] 은 제출 시각을 그대로 두고,
                              [다시 제출] 은 제출 시각을 지금으로 바꿉니다.
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={s.id} className={`${tableRowCls} align-top`}>
                    <td className="py-2 pr-2 text-ink-muted">{s.sessionNo}회</td>
                    <td className="py-2 pr-2 text-ink-body">{s.date || "-"}</td>
                    <td className="max-w-[260px] py-2 pr-2 text-ink-body">
                      {s.logContent ? (
                        <span className="line-clamp-2 whitespace-pre-line">
                          {s.logContent}
                        </span>
                      ) : (
                        <span className="text-ink-hint">(미작성)</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-ink-body">
                      {s.location || "-"}
                    </td>
                    <td className="py-2 pr-2 text-ink-body">
                      {s.workHours == null ? (
                        <span className="text-ink-hint">-</span>
                      ) : (
                        `${s.workHours}h`
                      )}
                    </td>
                    <td className="py-2 pr-2 text-ink-body">
                      {s.studentCount == null ? (
                        <span className="text-ink-hint">-</span>
                      ) : (
                        `${s.studentCount}명`
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <span className={STATE_BADGE[todo ? "todo" : st]}>
                        {todo ? "작성 필요" : CLUB_LOG_STATE_LABEL[st]}
                      </span>
                    </td>
                    <td className="py-2">
                      {s.lock.locked ? (
                        <span
                          className="text-[11px] text-ink-hint"
                          title={s.lock.message}
                        >
                          {s.lock.reason === "settled"
                            ? "정산됨 · 수정 불가"
                            : s.lock.reason === "staff-confirmed"
                              ? "확정됨 · 수정 불가"
                              : "월간보고 확정 · 수정 불가"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => openEdit(s)}
                          className={btnSecondary}
                        >
                          {s.logContent || s.submittedAt ? "수정" : "일지 쓰기"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
