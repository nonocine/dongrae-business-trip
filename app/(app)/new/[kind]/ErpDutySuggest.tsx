"use client";

// 활동 작성 화면 — 고른 날짜에 작성자 본인의 ERP 출장·외근(진행·완료)이 있으면 제안 버튼.
//   누르면 장소(#location)에 ERP 장소, 목적(#purpose)에 "출장"/"외근"을 채웁니다.
//   자동 저장은 하지 않습니다(직원이 확인 후 저장). 여러 건이면 버튼 여러 개.
import { useEffect, useState } from "react";
import { getMyErpFieldDuties, type ErpFieldSuggestion } from "@/app/(app)/new/[kind]/erpActions";
import { ERP_NOTE } from "@/lib/erp/duty";

function setField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  // 비제어 입력 — 값만 바꾸고 input 이벤트를 알려 둡니다.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export default function ErpDutySuggest({ dateInputId = "start_date" }: { dateInputId?: string }) {
  const [date, setDate] = useState<string>("");
  // 받은 결과는 날짜와 함께 둡니다 — 날짜가 바뀌면 이전 결과는 자연히 안 보입니다.
  const [result, setResult] = useState<{ date: string; items: ErpFieldSuggestion[]; syncedAt: string | null } | null>(null);
  const [applied, setApplied] = useState<string | null>(null); // `${date}:${dutyId}`

  // 날짜 칸을 따라갑니다(비제어 입력이라 DOM 이벤트로).
  useEffect(() => {
    const el = document.getElementById(dateInputId) as HTMLInputElement | null;
    if (!el) return;
    const sync = () => setDate(el.value);
    sync();
    el.addEventListener("change", sync);
    el.addEventListener("input", sync);
    return () => {
      el.removeEventListener("change", sync);
      el.removeEventListener("input", sync);
    };
  }, [dateInputId]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    getMyErpFieldDuties(date)
      .then((r) => alive && setResult({ date, items: r.items, syncedAt: r.syncedAt }))
      .catch(() => alive && setResult({ date, items: [], syncedAt: null }));
    return () => {
      alive = false;
    };
  }, [date]);

  const items = result && result.date === date ? result.items : [];
  const syncedAt = result?.syncedAt ?? null;
  if (!items.length) return null;
  const when = syncedAt
    ? new Date(syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "기록 없음";
  return (
    <div className="rounded-lg border border-navy/30 bg-navy-soft/20 p-3">
      <p className="mb-2 text-xs font-semibold text-navy">이 날짜의 ERP 출장·외근 — 누르면 장소·목적을 채웁니다(저장은 직접)</p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <button
            key={it.dutyId}
            type="button"
            onClick={() => {
              if (it.location) setField("location", it.location);
              setField("purpose", it.type);
              setApplied(`${date}:${it.dutyId}`);
            }}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
              applied === `${date}:${it.dutyId}` ? "border-navy bg-navy text-white" : "border-navy/40 bg-card text-navy hover:bg-navy-soft"
            }`}
          >
            ERP {it.type}: {it.location || "(장소 없음)"}
            {it.time ? ` (${it.time})` : ""}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-hint">
        {ERP_NOTE} · 마지막 동기화 {when}
      </p>
    </div>
  );
}
