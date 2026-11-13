"use client";

// /hr/leave-plans '설정' 탭(?tab=settings) — 첫해 월차 처리 방식. 관장(M0)만 보고 바꿉니다.
//   탭으로 옮기면서 처음부터 펼쳐 둡니다(화면 탭 정리 2단계).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFirstYearPolicy } from "@/app/(app)/hr/leave-plans/promotionActions";
import { noticeError, noticeSuccess } from "@/lib/ui";

type Policy = "payout" | "carryover";
const OPTIONS: { key: Policy; label: string; desc: string }[] = [
  {
    key: "payout",
    label: "12월 연차수당 정산(기본)",
    desc: "ERP 가 12/31 에 리셋하는 첫해 월차 잔여를 12월 연차수당으로 정산합니다. 연차 사용촉진의 '1년 미만' 줄은 회색으로 표시되고 기한 알림에서 빠집니다.",
  },
  {
    key: "carryover",
    label: "입사 1주년까지 이월 + 1년 미만 사용촉진",
    desc: "첫해 월차를 근속 1년까지 쓰게 하고, 1년 미만 사용촉진(최초 1년 끝나기 3개월·1개월 전) 일정을 관리합니다.",
  },
];

export default function LeavePolicySettings({ policy, canEdit }: { policy: Policy; canEdit: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState<Policy>(policy);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <details open className="rounded-xl border border-line bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        설정 <span className="ml-1 text-xs font-normal text-ink-muted">첫해 월차 처리 방식: {OPTIONS.find((o) => o.key === policy)?.label}</span>
      </summary>
      <p className="mt-2 text-xs text-ink-hint">
        근거: 근로기준법 제60조 ⑦·취업규칙 제29조 ①(첫해 월차는 근속 1년까지 사용 가능), 취업규칙 제28조 ⑤(회계연도 기준). ERP 는 첫해 월차를 12월까지
        선부여하고 1/1 에 리셋합니다.
      </p>
      <div className="mt-2 space-y-2">
        {OPTIONS.map((o) => (
          <label key={o.key} className={`flex items-start gap-2 rounded-md border p-2 text-sm ${pick === o.key ? "border-navy" : "border-line"}`}>
            <input type="radio" disabled={!canEdit} checked={pick === o.key} onChange={() => setPick(o.key)} className="mt-1" />
            <span>
              <span className="font-medium text-ink">{o.label}</span>
              <span className="block text-xs text-ink-muted">{o.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {canEdit ? (
        <button
          type="button"
          disabled={pending || pick === policy}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await setFirstYearPolicy(pick);
              if (!r.ok) return setMsg({ ok: false, text: r.message });
              setMsg({ ok: true, text: "저장했습니다." });
              router.refresh();
            })
          }
          className="mt-2 rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      ) : (
        <p className="mt-2 text-[11px] text-ink-hint">관장·부장만 바꿀 수 있습니다.</p>
      )}
      {msg && <p className={`mt-2 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
    </details>
  );
}
