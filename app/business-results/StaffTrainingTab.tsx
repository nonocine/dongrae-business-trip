"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNavy,
  badgeNeutral,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";
import {
  deleteStaffTraining,
  importMandatoryTrainings,
  saveStaffTraining,
  type StaffTrainingResult,
} from "./actions";
import {
  formatTrainingPeriod,
  isTrainingPeriodValid,
  periodOverlapsMonth,
  resolveTrainingEnd,
} from "@/lib/staffTraining";

// 종사자 교육 — 의무교육 자동 반입 + 외부 연수·기타 교육 수동 추가.
//   연번은 저장하지 않고 일자 오름차순 정렬 후 화면에서 행 번호로 부여합니다.
export default function StaffTrainingTab({
  year,
  month,
  periodLabel,
  configured,
  rows,
}: {
  year: number;
  month: number;
  periodLabel: string;
  configured: boolean;
  rows: StaffTrainingResult[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<StaffTrainingResult | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 기간 관련 실시간 안내(저장을 막지 않는 경고). 폼 입력이 바뀔 때 갱신합니다.
  const [periodHint, setPeriodHint] = useState<string | null>(null);

  // 폼은 비제어(defaultValue) 상태를 유지하고, 변경 이벤트에서 현재 값만 읽어
  //   안내 문구를 만듭니다 — 입력칸을 제어형으로 바꾸지 않아도 됩니다.
  function checkPeriod(form: HTMLFormElement) {
    const fd = new FormData(form);
    const startDate = String(fd.get("training_date") ?? "").trim();
    if (!startDate) {
      setPeriodHint(null);
      return;
    }
    const endDate = resolveTrainingEnd(
      startDate,
      String(fd.get("training_end_date") ?? ""),
    );
    if (!isTrainingPeriodValid(startDate, endDate)) {
      setPeriodHint(`종료일이 시작일(${startDate})보다 빠릅니다.`);
      return;
    }
    const m = Number(fd.get("month"));
    if (Number.isFinite(m) && !periodOverlapsMonth(startDate, endDate, year, m)) {
      setPeriodHint(
        `교육 기간(${formatTrainingPeriod(startDate, endDate)})이 실적 월(${m}월)과 겹치지 않습니다. 의도한 것이면 그대로 저장하세요.`,
      );
      return;
    }
    setPeriodHint(null);
  }

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          a.training_date.localeCompare(b.training_date) ||
          a.staff_name.localeCompare(b.staff_name, "ko"),
      ),
    [rows],
  );

  if (!configured)
    return (
      <section className={cardCls}>
        <h2 className="font-bold text-ink">종사자 교육 저장 준비가 필요합니다</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          화면은 준비됐습니다. 운영 Supabase에{" "}
          <code>staff_training_results</code> 테이블을 적용하면 바로 사용할 수
          있습니다.
        </p>
      </section>
    );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setMsg(null);
    start(async () => {
      try {
        const res = await saveStaffTraining(new FormData(form));
        if (!res.ok) {
          setMsg({ ok: false, text: res.message });
          return;
        }
        form.reset();
        setEditing(null);
        setPeriodHint(null);
        setMsg({ ok: true, text: "저장했습니다." });
        router.refresh();
      } catch (err) {
        setMsg({
          ok: false,
          text: err instanceof Error ? err.message : "저장하지 못했습니다.",
        });
      }
    });
  }

  function runImport() {
    setMsg(null);
    start(async () => {
      const res = await importMandatoryTrainings(year, month);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({
        ok: true,
        text:
          res.inserted === 0 && res.skipped === 0
            ? `${month}월 의무교육 수료 기록이 없습니다.`
            : `신규 ${res.inserted}건 반입 · 중복 ${res.skipped}건 건너뜀`,
      });
      router.refresh();
    });
  }

  function remove(row: StaffTrainingResult) {
    if (!confirm(`'${row.staff_name} — ${row.training_name}' 을 삭제할까요?`))
      return;
    setMsg(null);
    start(async () => {
      const res = await deleteStaffTraining(row.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: "삭제했습니다." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink">{periodLabel} 종사자 교육</h2>
            <p className="mt-1 text-xs text-ink-muted">
              의무교육 수료 기록을 반입하고, 외부 연수·기타 교육은 아래에서
              직접 추가합니다.
            </p>
          </div>
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            onClick={runImport}
          >
            {month}월 의무교육에서 가져오기
          </button>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="bg-navy text-white">
              <tr>
                {[
                  "연번",
                  "일자",
                  "성명",
                  "교육명",
                  "장소",
                  "주최",
                  "수료시간",
                  "출처",
                  "관리",
                ].map((label) => (
                  <th
                    key={label}
                    className="border-r border-white/15 px-3 py-2.5 text-center font-semibold last:border-r-0"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, index) => (
                <tr
                  key={row.id}
                  className={index % 2 ? "bg-surface/70" : "bg-white"}
                >
                  <td className="border-r border-t border-line px-3 py-2.5 text-center text-ink-muted">
                    {index + 1}
                  </td>
                  {/* 하루면 날짜 하나, 여러 날이면 "시작 ~ 종료" (activities 규칙) */}
                  <td className="border-r border-t border-line px-3 py-2.5 text-center text-ink-body whitespace-nowrap">
                    {formatTrainingPeriod(row.training_date, row.training_end_date)}
                  </td>
                  <td className="border-r border-t border-line px-3 py-2.5 font-semibold text-ink">
                    {row.staff_name}
                  </td>
                  <td className="border-r border-t border-line px-3 py-2.5 text-ink-body">
                    {row.training_name}
                  </td>
                  <td className="border-r border-t border-line px-3 py-2.5 text-center text-ink-body">
                    {row.location || "-"}
                  </td>
                  <td className="border-r border-t border-line px-3 py-2.5 text-center text-ink-body">
                    {row.organizer || "-"}
                  </td>
                  <td className="border-r border-t border-line px-3 py-2.5 text-center text-ink-body">
                    {row.hours || "-"}
                  </td>
                  <td className="border-r border-t border-line px-3 py-2.5 text-center">
                    <span
                      className={
                        row.source === "mandatory" ? badgeNavy : badgeNeutral
                      }
                    >
                      {row.source === "mandatory" ? "의무교육" : "수동"}
                    </span>
                  </td>
                  {/* 좁은 화면에서 이 칸이 눌리면 "수정"·"삭제" 가 한 자씩
                      세로로 꺾였습니다. 표는 원래 가로 스크롤이므로 칸이
                      제 폭을 갖게 두고 글자만 줄바꿈을 막습니다. */}
                  <td className="whitespace-nowrap border-t border-line px-3 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      <button
                        type="button"
                        className="whitespace-nowrap rounded border border-line px-2 py-1 text-xs font-bold text-navy hover:bg-navy-soft"
                        onClick={() => {
                          setEditing(row);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="whitespace-nowrap rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                        onClick={() => remove(row)}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="border-t border-line px-3 py-10 text-center text-sm text-ink-muted"
                  >
                    이 기간에 등록된 종사자 교육이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold text-ink">
            {editing ? "교육 기록 수정" : "교육 직접 추가"}
          </h3>
          {editing && (
            <button
              type="button"
              className="text-sm font-semibold text-ink-muted hover:underline"
              onClick={() => setEditing(null)}
            >
              수정 취소
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          성명은 자유 입력입니다(퇴직자·외부 강사 포함). 반입 행의 장소·주최·수료시간도
          여기서 고쳐 쓸 수 있습니다.
        </p>
        <form
          key={editing?.id ?? "new"}
          className="mt-4 grid gap-3 md:grid-cols-3"
          onSubmit={submit}
          onChange={(e) => checkPeriod(e.currentTarget)}
        >
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <input type="hidden" name="year" value={year} />
          <label className={labelCls}>
            실적 월
            <select
              name="month"
              className={inputCls}
              defaultValue={editing?.report_month ?? month}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  {v}월
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            일자 (시작)
            <input
              name="training_date"
              type="date"
              required
              className={inputCls}
              defaultValue={editing?.training_date ?? ""}
            />
          </label>
          <label className={labelCls}>
            종료일
            <input
              name="training_end_date"
              type="date"
              className={inputCls}
              // 하루 교육은 비워 둡니다 — 서버가 시작일과 같은 값으로 저장합니다.
              //   기존 행은 종료일=시작일 이라 하루 교육이면 칸이 비어 보입니다.
              defaultValue={
                editing && editing.training_end_date !== editing.training_date
                  ? editing.training_end_date
                  : ""
              }
            />
            <span className="mt-1 block text-[11px] font-normal text-ink-hint">
              여러 날에 걸친 교육만 입력하세요. 비우면 하루 교육입니다.
            </span>
          </label>
          <label className={labelCls}>
            성명
            <input
              name="staff_name"
              required
              className={inputCls}
              defaultValue={editing?.staff_name ?? ""}
            />
          </label>
          <label className={`${labelCls} md:col-span-3`}>
            교육명
            <input
              name="training_name"
              required
              className={inputCls}
              defaultValue={editing?.training_name ?? ""}
            />
          </label>
          <label className={labelCls}>
            장소
            <input
              name="location"
              className={inputCls}
              defaultValue={editing?.location ?? ""}
              placeholder="예: 온라인"
            />
          </label>
          <label className={labelCls}>
            주최
            <input
              name="organizer"
              className={inputCls}
              defaultValue={editing?.organizer ?? ""}
            />
          </label>
          <label className={labelCls}>
            수료시간
            <input
              name="hours"
              className={inputCls}
              defaultValue={editing?.hours ?? ""}
              placeholder="예: 1시간"
            />
          </label>
          {/* 기간 안내 — 저장을 막지 않습니다(회계상 의도적으로 다른 달에
              넣는 경우가 있어 경고만 합니다). */}
          {periodHint && (
            <p className={`md:col-span-3 ${noticeWarning}`}>{periodHint}</p>
          )}
          <div className="md:col-span-3">
            <button disabled={pending} className={btnPrimary}>
              {editing ? "수정 저장" : "추가"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
