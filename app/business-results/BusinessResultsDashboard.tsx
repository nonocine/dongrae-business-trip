"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { badgeNeutral, btnPrimary, cardCls, inputCls, labelCls } from "@/lib/ui";
import { saveBusinessResult, savePromotion, type BusinessResultsData } from "./actions";

type Tab = "overview" | "programs" | "promotions" | "report";
const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "월간 실적" }, { key: "programs", label: "사업실적 입력" },
  { key: "promotions", label: "홍보·대외협력" }, { key: "report", label: "종합보고서" },
];
const categories = ["청소년활동", "청소년참여", "청소년보호", "청소년복지", "지역연계", "시설이용", "기타"];
const promotionCategories = ["홈페이지", "밴드", "SNS", "언론보도", "학교연계", "지역기관", "기관방문", "기타"];
const number = new Intl.NumberFormat("ko-KR");

const metricCards = [
  { key: "sessions", label: "운영 횟수", unit: "회", color: "from-[#2563b1] to-[#1e4e92]", soft: "bg-brand-blue-soft text-brand-blue-strong" },
  { key: "participants", label: "참가인원", unit: "명", color: "from-[#5fad43] to-[#448c32]", soft: "bg-[#eef8eb] text-[#39772a]" },
  { key: "attendance", label: "연인원", unit: "명", color: "from-[#f2bc2f] to-[#db9414]", soft: "bg-[#fff8df] text-[#8a5a08]" },
  { key: "uses", label: "실별 이용", unit: "명", color: "from-[#d03832] to-[#a92a26]", soft: "bg-[#fff0ef] text-[#a92a26]" },
] as const;

export default function BusinessResultsDashboard({ year, month, data }: { year: number; month: number; data: BusinessResultsData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const monthLabel = `${year}년 ${month}월`;
  const totals = useMemo(() => data.results.reduce((a, r) => ({
    sessions: a.sessions + r.sessions, participants: a.participants + r.participants,
    attendance: a.attendance + r.attendance, uses: a.uses + r.youth_uses + r.other_uses,
    youth: a.youth + r.youth_uses,
  }), { sessions: 0, participants: 0, attendance: 0, uses: 0, youth: 0 }), [data.results]);
  const promoTotal = data.promotions.reduce((sum, row) => sum + row.count, 0);
  const youthRate = totals.uses ? Math.round((totals.youth / totals.uses) * 1000) / 10 : 0;
  const categoryStats = useMemo(() => Object.values(data.results.reduce<Record<string, { category: string; sessions: number; participants: number; attendance: number }>>((acc, row) => {
    const item = acc[row.category] ?? { category: row.category, sessions: 0, participants: 0, attendance: 0 };
    item.sessions += row.sessions;
    item.participants += row.participants;
    item.attendance += row.attendance;
    acc[row.category] = item;
    return acc;
  }, {})).sort((a, b) => b.attendance - a.attendance), [data.results]);
  const chartMax = Math.max(1, totals.participants, totals.attendance, totals.uses);
  const hasOnlySummaryRows = data.results.length > 0 && data.results.every(row => /총괄|합계|월간/.test(row.program_name));

  function changeMonth(nextYear: number, nextMonth: number) {
    router.push(`/business-results?year=${nextYear}&month=${nextMonth}`);
  }
  function submit(action: (fd: FormData) => Promise<{ ok: boolean }>, form: HTMLFormElement) {
    setMessage("");
    startTransition(async () => {
      try { await action(new FormData(form)); form.reset(); setMessage("저장했습니다."); router.refresh(); }
      catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    });
  }

  if (!data.configured) return <section className={cardCls}><h2 className="font-bold text-ink">사업실적 저장 준비가 필요합니다</h2><p className="mt-2 text-sm leading-6 text-ink-muted">화면과 저장 기능은 준비됐습니다. 운영 Supabase에 새 테이블을 적용하기 전이라 현재 앱 데이터에는 영향을 주지 않습니다.</p></section>;

  return <div className="space-y-4">
    <section className={cardCls}><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="flex gap-2">
      <label className={labelCls}>연도<select className={`${inputCls} min-w-28`} value={year} onChange={e => changeMonth(Number(e.target.value), month)}>{[2025, 2026, 2027].map(v => <option key={v}>{v}</option>)}</select></label>
      <label className={labelCls}>월<select className={`${inputCls} min-w-24`} value={month} onChange={e => changeMonth(year, Number(e.target.value))}>{Array.from({length:12},(_,i)=>i+1).map(v=><option key={v} value={v}>{v}월</option>)}</select></label>
    </div><span className={badgeNeutral}>공동 저장</span></div></section>
    <nav className="overflow-x-auto rounded-xl border border-line bg-card p-1 shadow-sm" aria-label="사업실적 메뉴"><div className="flex min-w-max gap-1">{tabs.map(item=><button key={item.key} onClick={()=>setTab(item.key)} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${tab===item.key?"bg-navy text-white":"text-ink-muted hover:bg-surface"}`}>{item.label}</button>)}</div></nav>
    {message && <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink">{message}</p>}
    {tab === "overview" && <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-[#254f78] to-[#2563b1] p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold text-white/70">MONTHLY PERFORMANCE</p><h2 className="mt-1 text-2xl font-bold">{monthLabel} 사업 운영 실적</h2><p className="mt-2 text-sm text-white/75">등록된 자료를 기준으로 집계한 월간 현황입니다.</p></div><div className="rounded-xl bg-white/12 px-5 py-3 text-center ring-1 ring-white/20"><p className="text-xs text-white/70">청소년 이용률</p><strong className="mt-1 block text-3xl">{youthRate}%</strong></div></div>
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metricCards.map(card => <article key={card.key} className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm"><div className={`h-1.5 bg-gradient-to-r ${card.color}`} /><div className="p-4"><div className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${card.soft}`}>{card.label}</div><p className="mt-3 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{number.format(totals[card.key])}<span className="ml-1 text-sm font-semibold text-ink-muted">{card.unit}</span></p></div></article>)}</section>
      <section className="grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
        <article className={cardCls}><div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-ink">이용 규모 비교</h3><p className="mt-1 text-xs text-ink-muted">참가인원·연인원·실별 이용인원</p></div><span className="rounded-full bg-navy-soft px-3 py-1 text-xs font-bold text-navy">단위: 명</span></div><div className="mt-6 space-y-5">{[
          ["참가인원", totals.participants, "bg-brand-blue"], ["연인원", totals.attendance, "bg-brand-yellow"], ["실별 이용", totals.uses, "bg-brand-red"],
        ].map(([label, value, color]) => <div key={String(label)}><div className="mb-2 flex items-end justify-between text-sm"><span className="font-semibold text-ink-body">{label}</span><strong className="text-ink">{number.format(Number(value))}</strong></div><div className="h-3 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(Number(value) ? 4 : 0, (Number(value) / chartMax) * 100)}%` }} /></div></div>)}</div></article>
        <article className={cardCls}><h3 className="font-bold text-ink">이용자 구성</h3><div className="mx-auto mt-5 flex aspect-square max-w-44 items-center justify-center rounded-full" style={{ background: totals.uses ? `conic-gradient(#2563b1 0 ${youthRate}%, #e5e7eb ${youthRate}% 100%)` : "#e5e7eb" }}><div className="flex h-[72%] w-[72%] flex-col items-center justify-center rounded-full bg-white shadow-inner"><strong className="text-2xl text-brand-blue">{youthRate}%</strong><span className="mt-1 text-xs text-ink-muted">청소년</span></div></div><div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs"><div className="rounded-lg bg-brand-blue-soft p-2"><b className="block text-brand-blue-strong">{number.format(totals.youth)}명</b>청소년</div><div className="rounded-lg bg-surface p-2"><b className="block text-ink-body">{number.format(Math.max(0, totals.uses - totals.youth))}명</b>기타</div></div></article>
      </section>
      <section className={cardCls}><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-bold text-ink">프로그램별 실적</h3><p className="mt-1 text-sm text-ink-muted">최종 결과보고서처럼 사업별 수치를 한 표에서 확인합니다.</p></div><span className="text-sm font-semibold text-ink-muted">총 {data.results.length}건</span></div>
        {hasOnlySummaryRows && <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm leading-6 text-[#8a5a08]"><b>현재는 월간 총괄자료만 등록되어 있습니다.</b> 프로그램별 원자료가 들어오면 이 표에 개별 사업 목록이 자동으로 늘어납니다.</div>}
        {data.results.length ? <div className="mt-4 overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[780px] border-collapse text-sm"><thead className="bg-navy text-white"><tr>{["분야","프로그램명","횟수","참가인원","연인원","청소년","기타","상태"].map(label => <th key={label} className="border-r border-white/15 px-3 py-3 text-center font-semibold last:border-r-0">{label}</th>)}</tr></thead><tbody>{data.results.map((row, index) => <tr key={row.id} className={index % 2 ? "bg-surface/70" : "bg-white"}><td className="border-r border-t border-line px-3 py-3 text-center text-ink-muted">{row.category}</td><td className="border-r border-t border-line px-3 py-3 font-semibold text-ink">{row.program_name}</td>{[row.sessions,row.participants,row.attendance,row.youth_uses,row.other_uses].map((value, i) => <td key={i} className="border-r border-t border-line px-3 py-3 text-right tabular-nums text-ink-body">{number.format(value)}</td>)}<td className="border-t border-line px-3 py-3 text-center"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.status === "submitted" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>{row.status === "submitted" ? "제출" : "작성 중"}</span></td></tr>)}</tbody><tfoot className="bg-navy-soft font-bold text-navy"><tr><td colSpan={2} className="border-r border-t border-line px-3 py-3 text-center">월 합계</td>{[totals.sessions,totals.participants,totals.attendance,totals.youth,Math.max(0,totals.uses-totals.youth)].map((value,i)=><td key={i} className="border-r border-t border-line px-3 py-3 text-right tabular-nums">{number.format(value)}</td>)}<td className="border-t border-line" /></tr></tfoot></table></div> : <div className="mt-4 rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">이 달에 등록된 사업실적이 없습니다.</div>}
      </section>
      <section className="grid gap-4 lg:grid-cols-2"><article className={cardCls}><div className="flex items-center justify-between"><h3 className="font-bold text-ink">분야별 실적</h3><span className="text-xs text-ink-muted">연인원 기준</span></div><div className="mt-4 space-y-3">{categoryStats.length ? categoryStats.map((item, index) => <div key={item.category} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm"><span className="truncate font-semibold text-ink-body">{item.category}</span><div className="h-2.5 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full ${["bg-brand-blue","bg-brand-green","bg-brand-yellow","bg-brand-red"][index % 4]}`} style={{width:`${Math.max(item.attendance ? 5 : 0,(item.attendance / Math.max(1,...categoryStats.map(v=>v.attendance))) * 100)}%`}} /></div><b className="w-16 text-right tabular-nums text-ink">{number.format(item.attendance)}</b></div>) : <p className="py-8 text-center text-sm text-ink-muted">표시할 분야별 자료가 없습니다.</p>}</div></article><article className={cardCls}><div className="flex items-center justify-between"><h3 className="font-bold text-ink">홍보·대외협력</h3><span className="rounded-full bg-stamp-soft px-3 py-1 text-xs font-bold text-stamp">총 {number.format(promoTotal)}회</span></div><div className="mt-4 space-y-2">{data.promotions.length ? data.promotions.map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-3 text-sm"><div className="min-w-0"><b className="block truncate text-ink">{row.title}</b><span className="text-xs text-ink-muted">{row.category}</span></div><strong className="shrink-0 text-stamp">{number.format(row.count)}회</strong></div>) : <p className="py-8 text-center text-sm text-ink-muted">등록된 홍보·협력 실적이 없습니다.</p>}</div></article></section>
    </div>}
    {tab === "programs" && <section className={cardCls}><h2 className="font-bold text-ink">{monthLabel} 사업실적 입력</h2><form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={e=>{e.preventDefault();submit(saveBusinessResult,e.currentTarget)}}><input type="hidden" name="year" value={year}/><input type="hidden" name="month" value={month}/>
      <label className={labelCls}>분야<select name="category" className={inputCls}>{categories.map(v=><option key={v}>{v}</option>)}</select></label><label className={`${labelCls} md:col-span-2`}>사업명<input name="program_name" required className={inputCls}/></label>
      {[['sessions','운영 횟수'],['participants','참가인원'],['attendance','연인원'],['youth_uses','청소년 이용'],['other_uses','기타 이용']].map(([n,l])=><label key={n} className={labelCls}>{l}<input name={n} type="number" min="0" defaultValue="0" className={inputCls}/></label>)}
      <label className={`${labelCls} md:col-span-3`}>주요 내용<textarea name="summary" rows={3} className={inputCls}/></label><label className={`${labelCls} md:col-span-3`}>평가·향후 계획<textarea name="evaluation" rows={3} className={inputCls}/></label>
      <div className="flex gap-2 md:col-span-3"><button disabled={pending} className={btnPrimary}>임시저장</button><button disabled={pending} name="submit" value="true" className={btnPrimary}>제출</button></div></form>
      <div className="mt-6 space-y-2">{data.results.map(r=><div key={r.id} className="rounded-lg border border-line p-3 text-sm"><div className="flex justify-between gap-3"><strong>{r.program_name}</strong><span>{r.status==='submitted'?'제출':'작성 중'}</span></div><p className="mt-1 text-ink-muted">{r.category} · {r.sessions}회 · 참가 {r.participants}명 · 연인원 {r.attendance}명 · 작성 {r.author_name}</p></div>)}</div>
    </section>}
    {tab === "promotions" && <section className={cardCls}><h2 className="font-bold text-ink">{monthLabel} 홍보·대외협력</h2><form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={e=>{e.preventDefault();submit(savePromotion,e.currentTarget)}}><input type="hidden" name="year" value={year}/><input type="hidden" name="month" value={month}/><label className={labelCls}>날짜<input required type="date" name="activity_date" className={inputCls}/></label><label className={labelCls}>구분<select name="category" className={inputCls}>{promotionCategories.map(v=><option key={v}>{v}</option>)}</select></label><label className={labelCls}>횟수<input name="count" type="number" min="0" defaultValue="1" className={inputCls}/></label><label className={`${labelCls} md:col-span-2`}>제목<input required name="title" className={inputCls}/></label><label className={labelCls}>링크<input name="url" type="url" className={inputCls}/></label><label className={`${labelCls} md:col-span-3`}>설명<textarea name="description" rows={2} className={inputCls}/></label><button disabled={pending} className={`${btnPrimary} md:col-span-3 md:w-fit`}>저장</button></form><div className="mt-6 space-y-2">{data.promotions.map(r=><div key={r.id} className="rounded-lg border border-line p-3 text-sm"><strong>{r.title}</strong><p className="mt-1 text-ink-muted">{r.activity_date} · {r.category} · {r.count}회 · 작성 {r.author_name}</p></div>)}</div></section>}
    {tab === "report" && <section className={cardCls}><h2 className="font-bold text-ink">{monthLabel} 종합보고서</h2><div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>사업 {data.results.length}개 / 운영 {totals.sessions}회</p><p>참가 {totals.participants}명 / 연인원 {totals.attendance}명</p><p>실별 이용 {totals.uses}명 / 청소년 {totals.youth}명</p><p>청소년 이용률 {youthRate}% / 홍보·협력 {promoTotal}회</p></div><div className="mt-5 flex flex-wrap gap-2"><a className={btnPrimary} href={`/business-results/export/word?year=${year}&month=${month}`}>Word 결과보고서</a><a className={btnPrimary} href={`/business-results/export/excel?year=${year}&month=${month}`}>Excel 결과보고서</a></div><p className="mt-3 text-xs leading-5 text-ink-muted">Word는 한글에서 최종 편집할 수 있고, Excel에는 종합현황·사업실적·홍보대외협력 시트가 포함됩니다.</p></section>}
  </div>;
}
