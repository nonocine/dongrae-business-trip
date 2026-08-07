"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNeutral,
  btnPrimary,
  cardCls,
  inputCls,
  labelCls,
} from "@/lib/ui";
import {
  savePromotion,
  type BusinessResult,
  type BusinessResultsData,
} from "./actions";
import DetailRowsEditor from "./DetailRowsEditor";
import ProgramRegistryManager from "./ProgramRegistryManager";
import ProgramResultForm from "./ProgramResultForm";
import type { RoomCounts } from "./RoomUsageSection";

type Tab = "overview" | "programs" | "promotions" | "report";
const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "실적 현황" },
  { key: "programs", label: "사업실적 입력" },
  { key: "promotions", label: "홍보·대외협력" },
  { key: "report", label: "종합보고서" },
];
const promotionCategories = [
  "홈페이지",
  "밴드",
  "SNS",
  "언론보도",
  "학교연계",
  "지역기관",
  "기관방문",
  "기타",
];
const number = new Intl.NumberFormat("ko-KR");

// 청/기 구분이 없는 과거 행(청·기 0 인데 계 > 0)은 청·기 를 "-" 로, 계만 표기합니다.
function trio(youth: number, other: number, total: number): string[] {
  if (youth + other === 0 && total > 0)
    return ["-", "-", number.format(total)];
  return [
    number.format(youth),
    number.format(other),
    number.format(youth + other),
  ];
}

const metricCards = [
  {
    key: "sessions",
    label: "운영 횟수",
    unit: "회",
    color: "from-[#2563b1] to-[#1e4e92]",
    soft: "bg-brand-blue-soft text-brand-blue-strong",
  },
  {
    key: "participants",
    label: "참가인원",
    unit: "명",
    color: "from-[#5fad43] to-[#448c32]",
    soft: "bg-[#eef8eb] text-[#39772a]",
  },
  {
    key: "attendance",
    label: "연인원",
    unit: "명",
    color: "from-[#f2bc2f] to-[#db9414]",
    soft: "bg-[#fff8df] text-[#8a5a08]",
  },
  {
    key: "uses",
    label: "실별 이용",
    unit: "명",
    color: "from-[#d03832] to-[#a92a26]",
    soft: "bg-[#fff0ef] text-[#a92a26]",
  },
] as const;

export default function BusinessResultsDashboard({
  year,
  month,
  period,
  startMonth,
  endMonth,
  data,
}: {
  year: number;
  month: number;
  period: string;
  startMonth: number;
  endMonth: number;
  data: BusinessResultsData;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<BusinessResult | null>(null);
  const [pending, startTransition] = useTransition();
  const periodNames: Record<string, string> = {
    month: `${month}월`,
    q1: "1분기",
    q2: "2분기",
    q3: "3분기",
    q4: "4분기",
    h1: "상반기",
    h2: "하반기",
    year: "연간",
  };
  const periodLabel = `${year}년 ${periodNames[period]}`;
  const aggregatedResults = useMemo(
    () =>
      Object.values(
        data.results.reduce<Record<string, BusinessResult>>((acc, row) => {
          const key = `${row.category}\u0000${row.program_name}`;
          const current = acc[key];
          if (!current) acc[key] = { ...row };
          else {
            current.sessions += row.sessions;
            current.operating_days += row.operating_days;
            current.participants += row.participants;
            current.participants_youth += row.participants_youth;
            current.participants_other += row.participants_other;
            current.attendance += row.attendance;
            current.attendance_youth += row.attendance_youth;
            current.attendance_other += row.attendance_other;
            current.youth_uses += row.youth_uses;
            current.other_uses += row.other_uses;
            if (row.status === "draft") current.status = "draft";
          }
          return acc;
        }, {}),
      ),
    [data.results],
  );
  const totals = useMemo(
    () =>
      aggregatedResults.reduce(
        (a, r) => ({
          sessions: a.sessions + r.sessions,
          participants: a.participants + r.participants,
          participantsYouth: a.participantsYouth + r.participants_youth,
          participantsOther: a.participantsOther + r.participants_other,
          attendance: a.attendance + r.attendance,
          attendanceYouth: a.attendanceYouth + r.attendance_youth,
          attendanceOther: a.attendanceOther + r.attendance_other,
          uses: a.uses + r.youth_uses + r.other_uses,
          youth: a.youth + r.youth_uses,
        }),
        {
          sessions: 0,
          participants: 0,
          participantsYouth: 0,
          participantsOther: 0,
          attendance: 0,
          attendanceYouth: 0,
          attendanceOther: 0,
          uses: 0,
          youth: 0,
        },
      ),
    [aggregatedResults],
  );
  // 수정 중인 실적의 실별 인원·세부 행 프리필.
  const editingRoomCounts = useMemo<RoomCounts>(() => {
    if (!editing) return {};
    const out: RoomCounts = {};
    for (const usage of data.roomUsage) {
      if (usage.result_id !== editing.id) continue;
      out[usage.room_id] = {
        youth: usage.youth_count,
        other: usage.other_count,
      };
    }
    return out;
  }, [editing, data.roomUsage]);
  const editingDetails = useMemo(
    () =>
      editing ? data.details.filter((d) => d.result_id === editing.id) : [],
    [editing, data.details],
  );
  const promoTotal = data.promotions.reduce((sum, row) => sum + row.count, 0);
  const youthRate = totals.uses
    ? Math.round((totals.youth / totals.uses) * 1000) / 10
    : 0;
  const categoryStats = useMemo(
    () =>
      Object.values(
        aggregatedResults.reduce<
          Record<
            string,
            {
              category: string;
              sessions: number;
              participants: number;
              attendance: number;
            }
          >
        >((acc, row) => {
          const item = acc[row.category] ?? {
            category: row.category,
            sessions: 0,
            participants: 0,
            attendance: 0,
          };
          item.sessions += row.sessions;
          item.participants += row.participants;
          item.attendance += row.attendance;
          acc[row.category] = item;
          return acc;
        }, {}),
      ).sort((a, b) => b.attendance - a.attendance),
    [aggregatedResults],
  );
  const chartMax = Math.max(
    1,
    totals.participants,
    totals.attendance,
    totals.uses,
  );
  const hasOnlySummaryRows =
    data.results.length > 0 &&
    data.results.every((row) => /총괄|합계|월간/.test(row.program_name));

  function changeRange(
    nextYear: number,
    nextPeriod: string,
    nextMonth = month,
  ) {
    router.push(
      `/business-results?year=${nextYear}&period=${nextPeriod}&month=${nextMonth}`,
    );
  }
  function submit(
    action: (fd: FormData) => Promise<{ ok: boolean }>,
    form: HTMLFormElement,
  ) {
    setMessage("");
    startTransition(async () => {
      try {
        await action(new FormData(form));
        form.reset();
        setEditing(null);
        setMessage("저장했습니다.");
        router.refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "저장하지 못했습니다.");
      }
    });
  }

  if (!data.configured)
    return (
      <section className={cardCls}>
        <h2 className="font-bold text-ink">사업실적 저장 준비가 필요합니다</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          화면과 저장 기능은 준비됐습니다. 운영 Supabase에 새 테이블을 적용하기
          전이라 현재 앱 데이터에는 영향을 주지 않습니다.
        </p>
      </section>
    );

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <label className={labelCls}>
              연도
              <select
                className={`${inputCls} min-w-28`}
                value={year}
                onChange={(e) => changeRange(Number(e.target.value), period)}
              >
                {[2025, 2026, 2027].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              조회 범위
              <select
                className={`${inputCls} min-w-28`}
                value={period}
                onChange={(e) => changeRange(year, e.target.value)}
              >
                <option value="month">월별</option>
                <option value="q1">1분기</option>
                <option value="q2">2분기</option>
                <option value="q3">3분기</option>
                <option value="q4">4분기</option>
                <option value="h1">상반기</option>
                <option value="h2">하반기</option>
                <option value="year">연간</option>
              </select>
            </label>
            {period === "month" && (
              <label className={labelCls}>
                월
                <select
                  className={`${inputCls} min-w-24`}
                  value={month}
                  onChange={(e) =>
                    changeRange(year, period, Number(e.target.value))
                  }
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
                    <option key={v} value={v}>
                      {v}월
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <span className={badgeNeutral}>공동 저장</span>
        </div>
      </section>
      <nav
        className="overflow-x-auto rounded-xl border border-line bg-card p-1 shadow-sm"
        aria-label="사업실적 메뉴"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${tab === item.key ? "bg-navy text-white" : "text-ink-muted hover:bg-surface"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      {message && (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink">
          {message}
        </p>
      )}
      {tab === "overview" && (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-[#254f78] to-[#2563b1] p-5 text-white shadow-md sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white/70">
                  PERFORMANCE
                </p>
                <h2 className="mt-1 text-2xl font-bold">
                  {periodLabel} 사업 운영 실적
                </h2>
                <p className="mt-2 text-sm text-white/75">
                  {startMonth}월부터 {endMonth}월까지 등록된 자료의 누적
                  현황입니다.
                </p>
              </div>
              <div className="rounded-xl bg-white/12 px-5 py-3 text-center ring-1 ring-white/20">
                <p className="text-xs text-white/70">청소년 이용률</p>
                <strong className="mt-1 block text-3xl">{youthRate}%</strong>
              </div>
            </div>
          </section>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metricCards.map((card) => (
              <article
                key={card.key}
                className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm"
              >
                <div className={`h-1.5 bg-gradient-to-r ${card.color}`} />
                <div className="p-4">
                  <div
                    className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${card.soft}`}
                  >
                    {card.label}
                  </div>
                  <p className="mt-3 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                    {number.format(totals[card.key])}
                    <span className="ml-1 text-sm font-semibold text-ink-muted">
                      {card.unit}
                    </span>
                  </p>
                </div>
              </article>
            ))}
          </section>
          <section className="grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
            <article className={cardCls}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-ink">이용 규모 비교</h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    참가인원·연인원·실별 이용인원
                  </p>
                </div>
                <span className="rounded-full bg-navy-soft px-3 py-1 text-xs font-bold text-navy">
                  단위: 명
                </span>
              </div>
              <div className="mt-6 space-y-5">
                {[
                  ["참가인원", totals.participants, "bg-brand-blue"],
                  ["연인원", totals.attendance, "bg-brand-yellow"],
                  ["실별 이용", totals.uses, "bg-brand-red"],
                ].map(([label, value, color]) => (
                  <div key={String(label)}>
                    <div className="mb-2 flex items-end justify-between text-sm">
                      <span className="font-semibold text-ink-body">
                        {label}
                      </span>
                      <strong className="text-ink">
                        {number.format(Number(value))}
                      </strong>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-surface">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{
                          width: `${Math.max(Number(value) ? 4 : 0, (Number(value) / chartMax) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className={cardCls}>
              <h3 className="font-bold text-ink">이용자 구성</h3>
              <div
                className="mx-auto mt-5 flex aspect-square max-w-44 items-center justify-center rounded-full"
                style={{
                  background: totals.uses
                    ? `conic-gradient(#2563b1 0 ${youthRate}%, #e5e7eb ${youthRate}% 100%)`
                    : "#e5e7eb",
                }}
              >
                <div className="flex h-[72%] w-[72%] flex-col items-center justify-center rounded-full bg-white shadow-inner">
                  <strong className="text-2xl text-brand-blue">
                    {youthRate}%
                  </strong>
                  <span className="mt-1 text-xs text-ink-muted">청소년</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="rounded-lg bg-brand-blue-soft p-2">
                  <b className="block text-brand-blue-strong">
                    {number.format(totals.youth)}명
                  </b>
                  청소년
                </div>
                <div className="rounded-lg bg-surface p-2">
                  <b className="block text-ink-body">
                    {number.format(Math.max(0, totals.uses - totals.youth))}명
                  </b>
                  기타
                </div>
              </div>
            </article>
          </section>
          <section className={cardCls}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">프로그램별 실적</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  같은 프로그램은 선택 기간의 수치를 합산합니다.
                </p>
              </div>
              <span className="text-sm font-semibold text-ink-muted">
                총 {aggregatedResults.length}개 프로그램
              </span>
            </div>
            {hasOnlySummaryRows && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm leading-6 text-[#8a5a08]">
                <b>현재는 월간 총괄자료만 등록되어 있습니다.</b> 프로그램별
                원자료가 들어오면 이 표에 개별 사업 목록이 자동으로 늘어납니다.
              </div>
            )}
            {aggregatedResults.length ? (
              <div className="mt-4 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[1180px] border-collapse text-sm">
                  <thead className="bg-navy text-white">
                    <tr>
                      {[
                        "분야",
                        "프로그램명",
                        "횟수",
                        "참가 청",
                        "참가 기",
                        "참가 계",
                        "연인원 청",
                        "연인원 기",
                        "연인원 계",
                        "실인원 청",
                        "실인원 기",
                        "실인원 계",
                        "상태",
                      ].map((label) => (
                        <th
                          key={label}
                          className="border-r border-white/15 px-3 py-3 text-center font-semibold last:border-r-0"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedResults.map((row, index) => (
                      <tr
                        key={`${row.category}-${row.program_name}`}
                        className={index % 2 ? "bg-surface/70" : "bg-white"}
                      >
                        <td className="border-r border-t border-line px-3 py-3 text-center text-ink-muted">
                          {row.category}
                        </td>
                        <td className="border-r border-t border-line px-3 py-3 font-semibold text-ink">
                          {row.program_name}
                        </td>
                        {[
                          number.format(row.sessions),
                          ...trio(
                            row.participants_youth,
                            row.participants_other,
                            row.participants,
                          ),
                          ...trio(
                            row.attendance_youth,
                            row.attendance_other,
                            row.attendance,
                          ),
                          number.format(row.youth_uses),
                          number.format(row.other_uses),
                          number.format(row.youth_uses + row.other_uses),
                        ].map((value, i) => (
                          <td
                            key={i}
                            className="border-r border-t border-line px-3 py-3 text-right tabular-nums text-ink-body"
                          >
                            {value}
                          </td>
                        ))}
                        <td className="border-t border-line px-3 py-3 text-center">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.status === "submitted" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
                          >
                            {row.status === "submitted" ? "제출" : "작성 중"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-navy-soft font-bold text-navy">
                    <tr>
                      <td
                        colSpan={2}
                        className="border-r border-t border-line px-3 py-3 text-center"
                      >
                        기간 합계
                      </td>
                      {[
                        number.format(totals.sessions),
                        ...trio(
                          totals.participantsYouth,
                          totals.participantsOther,
                          totals.participants,
                        ),
                        ...trio(
                          totals.attendanceYouth,
                          totals.attendanceOther,
                          totals.attendance,
                        ),
                        number.format(totals.youth),
                        number.format(Math.max(0, totals.uses - totals.youth)),
                        number.format(totals.uses),
                      ].map((value, i) => (
                        <td
                          key={i}
                          className="border-r border-t border-line px-3 py-3 text-right tabular-nums"
                        >
                          {value}
                        </td>
                      ))}
                      <td className="border-t border-line" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">
                이 기간에 등록된 사업실적이 없습니다.
              </div>
            )}
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={cardCls}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-ink">분야별 실적</h3>
                <span className="text-xs text-ink-muted">연인원 기준</span>
              </div>
              <div className="mt-4 space-y-3">
                {categoryStats.length ? (
                  categoryStats.map((item, index) => (
                    <div
                      key={item.category}
                      className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm"
                    >
                      <span className="truncate font-semibold text-ink-body">
                        {item.category}
                      </span>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface">
                        <div
                          className={`h-full rounded-full ${["bg-brand-blue", "bg-brand-green", "bg-brand-yellow", "bg-brand-red"][index % 4]}`}
                          style={{
                            width: `${Math.max(item.attendance ? 5 : 0, (item.attendance / Math.max(1, ...categoryStats.map((v) => v.attendance))) * 100)}%`,
                          }}
                        />
                      </div>
                      <b className="w-16 text-right tabular-nums text-ink">
                        {number.format(item.attendance)}
                      </b>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-ink-muted">
                    표시할 분야별 자료가 없습니다.
                  </p>
                )}
              </div>
            </article>
            <article className={cardCls}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-ink">홍보·대외협력</h3>
                <span className="rounded-full bg-stamp-soft px-3 py-1 text-xs font-bold text-stamp">
                  총 {number.format(promoTotal)}회
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {data.promotions.length ? (
                  data.promotions.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <b className="block truncate text-ink">{row.title}</b>
                        <span className="text-xs text-ink-muted">
                          {row.category}
                        </span>
                      </div>
                      <strong className="shrink-0 text-stamp">
                        {number.format(row.count)}회
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-ink-muted">
                    등록된 홍보·협력 실적이 없습니다.
                  </p>
                )}
              </div>
            </article>
          </section>
        </div>
      )}
      {tab === "programs" && (
        <div className="space-y-4">
          <section className={cardCls}>
            <h2 className="font-bold text-ink">
              {editing ? "프로그램 실적 수정" : "프로그램 실적 입력"}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              제출된 자료도 수정 버튼으로 다시 열어 고칠 수 있습니다.
            </p>
            <ProgramResultForm
              key={editing?.id ?? "new"}
              year={year}
              month={month}
              editing={editing}
              registry={data.registry}
              rooms={data.rooms}
              roomsConfigured={data.roomsConfigured}
              initialRoomCounts={editingRoomCounts}
              onCancel={() => setEditing(null)}
              onSaved={(text) => {
                setEditing(null);
                setMessage(text);
              }}
            />
            {editing && data.detailsConfigured && (
              <div className="mt-4">
                <DetailRowsEditor
                  key={editing.id}
                  resultId={editing.id}
                  details={editingDetails}
                />
              </div>
            )}
            <div className="mt-6 space-y-2">
              {data.results.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong>{r.program_name}</strong>
                      <span className="ml-2 text-xs text-ink-muted">
                        {r.report_month}월 ·{" "}
                        {r.status === "submitted" ? "제출" : "작성 중"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-navy hover:bg-navy-soft"
                      onClick={() => {
                        setEditing(r);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      수정
                    </button>
                  </div>
                  <p className="mt-1 text-ink-muted">
                    {r.category} · {r.sessions}회 · 참가 {r.participants}명 ·
                    연인원 {r.attendance}명 · 작성 {r.author_name}
                    {r.manager_name ? ` · 담당 ${r.manager_name}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
          {data.isAdmin && <ProgramRegistryManager registry={data.registry} />}
        </div>
      )}
      {tab === "promotions" && (
        <section className={cardCls}>
          <h2 className="font-bold text-ink">{periodLabel} 홍보·대외협력</h2>
          <form
            className="mt-4 grid gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(savePromotion, e.currentTarget);
            }}
          >
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="month" value={month} />
            <label className={labelCls}>
              날짜
              <input
                required
                type="date"
                name="activity_date"
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              구분
              <select name="category" className={inputCls}>
                {promotionCategories.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              횟수
              <input
                name="count"
                type="number"
                min="0"
                defaultValue="1"
                className={inputCls}
              />
            </label>
            <label className={`${labelCls} md:col-span-2`}>
              제목
              <input required name="title" className={inputCls} />
            </label>
            <label className={labelCls}>
              링크
              <input name="url" type="url" className={inputCls} />
            </label>
            <label className={`${labelCls} md:col-span-3`}>
              설명
              <textarea name="description" rows={2} className={inputCls} />
            </label>
            <button
              disabled={pending}
              className={`${btnPrimary} md:col-span-3 md:w-fit`}
            >
              저장
            </button>
          </form>
          <div className="mt-6 space-y-2">
            {data.promotions.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-line p-3 text-sm"
              >
                <strong>{r.title}</strong>
                <p className="mt-1 text-ink-muted">
                  {r.activity_date} · {r.category} · {r.count}회 · 작성{" "}
                  {r.author_name}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "report" && (
        <section className={cardCls}>
          <h2 className="font-bold text-ink">{periodLabel} 종합보고서</h2>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <p>
              사업 {aggregatedResults.length}개 / 운영 {totals.sessions}회
            </p>
            <p>
              참가 {totals.participants}명 / 연인원 {totals.attendance}명
            </p>
            <p>
              실별 이용 {totals.uses}명 / 청소년 {totals.youth}명
            </p>
            <p>
              청소년 이용률 {youthRate}% / 홍보·협력 {promoTotal}회
            </p>
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            화면과 다운로드 문서 모두 선택한 기간의 누적값으로 생성됩니다.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              className={btnPrimary}
              href={`/business-results/export/word?year=${year}&startMonth=${startMonth}&endMonth=${endMonth}&label=${encodeURIComponent(periodNames[period])}`}
            >
              Word 결과보고서
            </a>
            <a
              className={btnPrimary}
              href={`/business-results/export/excel?year=${year}&startMonth=${startMonth}&endMonth=${endMonth}&label=${encodeURIComponent(periodNames[period])}`}
            >
              Excel 결과보고서
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
