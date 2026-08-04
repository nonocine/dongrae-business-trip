"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { badgeNeutral, btnPrimary, cardCls, inputCls, labelCls } from "@/lib/ui";
import { saveBusinessResult, savePromotion, type BusinessResultsData } from "./actions";

type Tab = "overview" | "programs" | "promotions" | "report";
const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "월간 현황" }, { key: "programs", label: "사업실적 입력" },
  { key: "promotions", label: "홍보·대외협력" }, { key: "report", label: "종합보고서" },
];
const categories = ["청소년활동", "청소년참여", "청소년보호", "청소년복지", "지역연계", "시설이용", "기타"];
const promotionCategories = ["홈페이지", "밴드", "SNS", "언론보도", "학교연계", "지역기관", "기관방문", "기타"];

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
    {tab === "overview" && <><section className="grid grid-cols-2 gap-3 lg:grid-cols-6">{[["등록 사업",`${data.results.length}개`],["제출 완료",`${data.results.filter(r=>r.status==="submitted").length}개`],["참가인원",`${totals.participants}명`],["연인원",`${totals.attendance}명`],["실별 이용",`${totals.uses}명`],["홍보·협력",`${promoTotal}회`]].map(([l,v])=><div key={l} className={cardCls}><p className="text-xs font-semibold text-ink-muted">{l}</p><p className="mt-2 text-xl font-bold text-ink">{v}</p></div>)}</section><section className={cardCls}><h2 className="font-bold text-ink">{monthLabel} 진행 현황</h2><p className="mt-3 text-sm text-ink-muted">운영 {totals.sessions}회 · 청소년 이용률 {youthRate}%</p></section></>}
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
