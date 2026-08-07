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
} from "@/lib/ui";
import {
  deleteStaffTraining,
  importMandatoryTrainings,
  saveStaffTraining,
  type StaffTrainingResult,
} from "./actions";

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
        await saveStaffTraining(new FormData(form));
        form.reset();
        setEditing(null);
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
                  <td className="border-r border-t border-line px-3 py-2.5 text-center text-ink-body">
                    {row.training_date}
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
                  <td className="border-t border-line px-3 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-xs font-bold text-navy hover:bg-navy-soft"
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
                        className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
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
            일자
            <input
              name="training_date"
              type="date"
              required
              className={inputCls}
              defaultValue={editing?.training_date ?? ""}
            />
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
