"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMealPhotoUpload,
  deleteMealPhoto,
  finalizeMealPhoto,
  previewMealPaste,
  saveMeal,
  saveMealPaste,
} from "@/app/(app)/bangka/meals/actions";
import { uploadToSlot } from "@/app/(app)/bangka/uploadClient";
import { monthGrid, shiftYm, type BkMealLine, type BkMealRow } from "@/lib/bangkaContent";
import {
  badgeNeutral,
  badgeSuccess,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 급식 달력 — 날짜를 누르면 아래에 그날 편집(메뉴 줄바꿈·알레르기·사진).
//   · 폰: 칸에는 날짜와 표시(● 메뉴 있음, 📷 사진)만 — 눌러서 편집. 사진은 [사진 올리기]
//     를 누르면 카메라/앨범을 고를 수 있습니다(서버에서 긴 변 1600px 로 줄임).
//   · [일괄 입력]: 위탁업체 월간표에서 "날짜 탭 메뉴" 를 복사해 붙여 넣기 → 미리보기 → 저장.
//     메뉴만 바뀌고 이미 올린 사진은 그대로입니다.
// =====================================================================

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export default function MealsCalendar({ ym, meals, todayYmd }: { ym: string; meals: BkMealRow[]; todayYmd: string }) {
  const router = useRouter();
  const byDate = new Map(meals.map((m) => [m.meal_date, m]));
  const [selected, setSelected] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [y, m] = ym.split("-").map(Number);

  function pick(date: string) {
    setSelected(date);
    setBulk(false);
    // 폰에서는 달력 아래 편집 칸으로 내려 줍니다.
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} flex flex-wrap items-center gap-2`}>
        <button type="button" onClick={() => router.push(`/bangka/meals?ym=${shiftYm(ym, -1)}`)} className={btnSecondary}>
          ◀
        </button>
        <span className="min-w-[7rem] text-center text-lg font-bold text-ink">
          {y}년 {m}월
        </span>
        <button type="button" onClick={() => router.push(`/bangka/meals?ym=${shiftYm(ym, 1)}`)} className={btnSecondary}>
          ▶
        </button>
        <span className="text-xs text-ink-muted">메뉴 {meals.filter((x) => x.menu_text).length}일 · 사진 {meals.filter((x) => x.photo_url).length}일</span>
        <Link href="/bangka/meals/upload" className={`ml-auto ${btnPrimary}`}>
          식단표 올리기(엑셀)
        </Link>
        <a href={`/bangka/meals/plan-pdf?ym=${ym}`} className={btnSecondary}>
          {m}월 급식계획 PDF
        </a>
        <button
          type="button"
          onClick={() => {
            setBulk((v) => !v);
            setSelected(null);
          }}
          className={btnSecondary}
        >
          {bulk ? "일괄 입력 닫기" : "일괄 입력(붙여넣기)"}
        </button>
      </div>

      {bulk && <BulkMealPaste ym={ym} onDone={() => router.refresh()} />}

      <div className={panelToneCls("green")}>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-muted">
          {WEEK.map((w, i) => (
            <div key={w} className={i === 0 ? "text-stamp" : i === 6 ? "text-navy" : ""}>
              {w}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {monthGrid(ym).map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const meal = byDate.get(d);
            const dow = i % 7;
            return (
              <button
                key={d}
                type="button"
                onClick={() => pick(d)}
                className={`min-h-[3.5rem] min-w-0 rounded-md border p-1 text-left align-top sm:min-h-[6.5rem] ${
                  selected === d ? "border-navy ring-2 ring-navy/40" : "border-line"
                } ${d === todayYmd ? "bg-warning-soft" : "bg-card"} hover:bg-surface`}
              >
                <span className={`text-xs font-bold ${dow === 0 ? "text-stamp" : dow === 6 ? "text-navy" : "text-ink"}`}>
                  {Number(d.slice(8))}
                </span>
                {/* 폰: 칸이 좁아(특히 큰 글씨) 표시(●📷)는 날짜 아래 줄로 */}
                <span className="block text-[10px] leading-tight sm:ml-1 sm:inline">
                  {meal?.menu_text ? <span className="text-success">●</span> : null}
                  {meal?.photo_url ? "📷" : null}
                </span>
                {meal?.menu_text && (
                  <span className="mt-0.5 hidden whitespace-pre-line text-[11px] leading-tight text-ink-body sm:line-clamp-5 sm:block">
                    {meal.menu_text}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={editorRef}>
        {selected && (
          <DayEditor
            key={selected}
            date={selected}
            meal={byDate.get(selected) ?? null}
            onChanged={() => router.refresh()}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

function DayEditor({
  date,
  meal,
  onChanged,
  onClose,
}: {
  date: string;
  meal: BkMealRow | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState(meal?.menu_text ?? "");
  const [allergy, setAllergy] = useState(meal?.allergy_note ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dow = WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()];

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveMeal({ date, menu, allergy });
      setMsg(res.ok ? { ok: true, text: "저장했습니다." } : { ok: false, text: res.message });
      if (res.ok) onChanged();
    });
  }

  function uploadPhoto(file: File) {
    setMsg(null);
    start(async () => {
      try {
        const slot = await createMealPhotoUpload({ date, name: file.name, mime: file.type, size: file.size });
        if (!slot.ok) throw new Error(slot.message);
        await uploadToSlot(slot, file);
        const fin = await finalizeMealPhoto({ date, path: slot.path, mime: file.type });
        if (!fin.ok) throw new Error(fin.message);
        setMsg({ ok: true, text: "사진을 올렸습니다." });
        onChanged();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "사진을 올리지 못했습니다." });
      }
    });
  }

  function removePhoto() {
    if (!confirm("이날 사진을 지울까요?")) return;
    start(async () => {
      const res = await deleteMealPhoto(date);
      setMsg(res.ok ? { ok: true, text: "사진을 지웠습니다." } : { ok: false, text: res.message });
      if (res.ok) onChanged();
    });
  }

  return (
    <section className={`${panelToneCls("yellow")} space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className={sectionTitleCls("yellow")}>
          {Number(date.slice(5, 7))}월 {Number(date.slice(8))}일({dow}) 급식
        </h3>
        <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:underline">
          닫기
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          <label className="block">
            <span className={labelCls}>메뉴(한 줄에 하나)</span>
            <textarea value={menu} onChange={(e) => setMenu(e.target.value)} rows={7} className={`${inputCls} h-auto`} placeholder={"잡곡밥\n된장국\n제육볶음\n깍두기"} />
          </label>
          <label className="block">
            <span className={labelCls}>알레르기 표시(선택)</span>
            <input value={allergy} onChange={(e) => setAllergy(e.target.value)} className={inputCls} placeholder="예: 5.대두 6.밀 10.돼지고기" />
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
              {pending ? "저장 중…" : "메뉴 저장"}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <span className={labelCls}>급식 사진</span>
          {meal?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- 비공개 버킷 서명 URL(1시간)
            <img src={meal.photo_url} alt={`${date} 급식`} className="w-full rounded-lg border border-line object-cover" />
          ) : (
            <p className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-ink-hint">사진 없음</p>
          )}
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex flex-1 cursor-pointer justify-center ${btnPrimary} ${pending ? "pointer-events-none opacity-60" : ""}`}>
              📷 {meal?.photo_url ? "사진 바꾸기" : "사진 올리기"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={pending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadPhoto(file);
                }}
              />
            </label>
            {meal?.photo_url && (
              <button type="button" onClick={removePhoto} disabled={pending} className={btnSecondary}>
                사진 삭제
              </button>
            )}
          </div>
        </div>
      </div>
      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}
    </section>
  );
}

function BulkMealPaste({ ym, onDone }: { ym: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ lines: BkMealLine[]; existing: string[]; for: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const stale = preview !== null && preview.for !== text;
  const errorCount = preview?.lines.filter((l) => l.errors.length).length ?? 0;
  const [y, m] = ym.split("-").map(Number);

  function runPreview() {
    setMsg(null);
    const snap = text;
    start(async () => {
      const res = await previewMealPaste(snap, ym);
      if (!res.ok) setMsg({ ok: false, text: res.message });
      else setPreview({ lines: res.lines, existing: res.existing, for: snap });
    });
  }

  function save() {
    if (!preview) return;
    const over = preview.lines.filter((l) => l.date && preview.existing.includes(l.date)).length;
    if (!confirm(`${preview.lines.length}일 메뉴를 저장할까요?${over ? `\n(이미 메뉴가 있는 ${over}일은 새 메뉴로 바뀝니다. 사진은 그대로)` : ""}`)) return;
    start(async () => {
      const res = await saveMealPaste(text, ym);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: `${res.saved}일 메뉴를 저장했습니다.` });
      setText("");
      setPreview(null);
      onDone();
    });
  }

  return (
    <section className={`${panelToneCls("yellow")} space-y-3`}>
      <h3 className={sectionTitleCls("yellow")}>
        일괄 입력 — {y}년 {m}월
      </h3>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-hint">
        <li>엑셀 식단표에서 날짜 칸과 메뉴 칸을 함께 골라 복사(Ctrl+C) 후 붙여 넣으세요. 한 줄 = 하루.</li>
        <li>날짜는 2026-11-03 · 11/3 · 11월 3일 · 3일 · 3 모두 됩니다(연·월이 없으면 위의 달).</li>
        <li>메뉴는 날짜 다음 칸들을 한 줄씩 이어 붙입니다. 셀 안 줄바꿈도 그대로 살립니다.</li>
      </ul>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        spellCheck={false}
        className={`${inputCls} h-auto font-mono text-xs`}
        placeholder={"3\t잡곡밥\t된장국\t제육볶음\n4\t카레라이스\t미역국\t깍두기"}
      />
      <div className="flex justify-end">
        <button type="button" onClick={runPreview} disabled={pending || !text.trim()} className={btnSecondary}>
          미리보기
        </button>
      </div>

      {preview && (
        <div className="space-y-2">
          {stale && <p className="text-xs text-warning">붙여넣은 내용이 바뀌었습니다. [미리보기]를 다시 눌러 주세요.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="px-2 py-1 text-left">줄</th>
                  <th className="px-2 py-1 text-left">날짜</th>
                  <th className="px-2 py-1 text-left">메뉴</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.line} className={tableRowCls}>
                    <td className="px-2 py-1 align-top text-xs text-ink-muted">{l.line}</td>
                    <td className="px-2 py-1 align-top whitespace-nowrap text-xs">
                      {l.date ?? <span className="text-stamp">{l.dateRaw || "(빈칸)"}</span>}
                      {l.date &&
                        (preview.existing.includes(l.date) ? (
                          <span className={`ml-1 ${badgeNeutral}`}>바꿈</span>
                        ) : (
                          <span className={`ml-1 ${badgeSuccess}`}>새로</span>
                        ))}
                    </td>
                    <td className="px-2 py-1 align-top text-xs">
                      <span className="whitespace-pre-line text-ink-body">{l.menu}</span>
                      {l.errors.length > 0 && <p className="text-stamp">{l.errors.join(" / ")}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            {errorCount > 0 && <span className="text-xs text-stamp">오류 {errorCount}줄 — 고친 뒤 다시 미리보기</span>}
            <button
              type="button"
              onClick={save}
              disabled={pending || stale || errorCount > 0 || preview.lines.length === 0}
              className={btnPrimary}
            >
              {pending ? "저장 중…" : `${preview.lines.length}일 저장`}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}
    </section>
  );
}
