"use client";

// ERP 동기화 상태판 — API 별 마지막 동기화·성공 여부·건수, 최근 오류, 직원 연결 현황.
//   회계(거래·결의서)는 건수만 보여 줍니다(내용 없음).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  linkErpEmployee,
  syncErpNow,
  type ErpLinkRow,
  type ErpStatusData,
} from "@/app/(app)/admin/erp/actions";
import {
  badgeDanger,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnPrimary,
  cardCls,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

const API_LABEL: Record<string, string> = {
  employees: "직원",
  leaveBalances: "휴가 잔여",
  codes: "예산·수입 코드",
  duties: "근무(출장·휴가 등)",
  schedules: "일정",
  rentals: "대관",
  documents: "문서",
  transactions: "거래내역(회계)",
  expenditures: "지출결의(회계)",
};

function kst(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ErpStatusBoard({ data }: { data: ErpStatusData }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const linked = data.links.filter((l) => l.erpEmployeeId).length;
  const need = data.links.length - linked;

  function syncNow() {
    setMsg(null);
    start(async () => {
      const r = await syncErpNow();
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      const failed = r.results.filter((x) => !x.ok).map((x) => API_LABEL[x.api] ?? x.api);
      setMsg({
        ok: failed.length === 0,
        text:
          failed.length === 0
            ? `동기화했습니다. (${r.results.length}개 API${r.linked ? ` · 직원 ${r.linked}명 자동 연결` : ""})`
            : `일부 실패: ${failed.join(", ")} — 아래 최근 오류를 확인하세요.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-hint">
            ERP 가 원본이고 동업자씨는 받아 적기만 합니다. 자동 동기화: 매일 07:00 · 12:00 · 18:00(한국시간).
          </p>
          <button type="button" className={btnPrimary} disabled={pending} onClick={syncNow}>
            {pending ? "동기화 중…(최대 몇 분)" : "지금 동기화"}
          </button>
        </div>
        {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={thCls}>API</th>
                <th className={thCls}>마지막 실행</th>
                <th className={thCls}>결과</th>
                <th className={`${thCls} text-right`}>받음</th>
                <th className={`${thCls} text-right`}>저장</th>
                <th className={`${thCls} text-right`}>사라짐</th>
                <th className={thCls}>범위</th>
                <th className={thCls}>마지막 성공</th>
                <th className={`${thCls} text-right`}>보관 건수</th>
              </tr>
            </thead>
            <tbody>
              {data.apis.map((a) => (
                <tr key={a.api} className="border-b border-line/60">
                  <td className={`${tdCls} font-medium text-ink`}>
                    {API_LABEL[a.api] ?? a.api}
                    <span className="ml-1 text-[11px] text-ink-hint">{a.api}</span>
                  </td>
                  <td className={`${tdCls} text-xs`}>
                    {kst(a.last?.started_at)}
                    {a.last?.trigger === "manual" && <span className="ml-1 text-[11px] text-ink-hint">수동</span>}
                  </td>
                  <td className={tdCls}>
                    {!a.last ? (
                      <span className={badgeNeutral}>기록 없음</span>
                    ) : a.last.ok == null ? (
                      <span className={badgeWarning}>진행 중</span>
                    ) : a.last.ok ? (
                      <span className={badgeSuccess} title={a.last.error ?? undefined}>
                        성공
                      </span>
                    ) : (
                      <span className={badgeDanger} title={a.last.error ?? undefined}>
                        실패
                      </span>
                    )}
                  </td>
                  <td className={`${tdCls} text-right`}>{a.last?.fetched ?? "-"}</td>
                  <td className={`${tdCls} text-right`}>{a.last?.upserted ?? "-"}</td>
                  <td className={`${tdCls} text-right`}>{a.last?.removed ?? "-"}</td>
                  <td className={`${tdCls} text-xs text-ink-muted`}>
                    {a.last?.range_start ? `${a.last.range_start} ~ ${a.last.range_end}` : a.api === "employees" ? "변경분" : "전체"}
                  </td>
                  <td className={`${tdCls} text-xs`}>{kst(a.lastSuccessAt)}</td>
                  <td className={`${tdCls} text-right`}>{a.rows.toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink-hint">
          거래내역·지출결의(회계)는 이 단계에서 건수만 보여 줍니다. 받음 = ERP 응답 건수, 사라짐 = 받은 기간 안에서 이번 응답에 없어 removed 표시한 건수.
        </p>
      </section>

      <section className={cardCls}>
        <h3 className="mb-2 text-base font-bold text-ink">최근 오류</h3>
        {data.recentErrors.length === 0 ? (
          <p className="text-sm text-ink-hint">최근 오류가 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.recentErrors.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-2 border-b border-line/50 py-1">
                <span className="w-28 shrink-0 text-xs text-ink-hint">{kst(e.started_at)}</span>
                <span className="font-medium text-ink">{API_LABEL[e.api] ?? e.api}</span>
                <span className="text-xs text-stamp">{e.error ?? "(내용 없음)"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardCls}>
        <h3 className="mb-1 text-base font-bold text-ink">
          직원 연결
          <span className="ml-2 text-xs font-normal text-ink-muted">
            연결됨 {linked} · 연결 필요 {need}
          </span>
        </h3>
        <p className="mb-2 text-xs text-ink-hint">
          동기화 때마다, 아직 연결 안 된 직원은 재직 중 ERP 직원과 이름이 정확히 1명 일치하면 자동 연결합니다. 이미 연결된 값은 바꾸지 않습니다.
        </p>
        <ul className="space-y-1">
          {data.links.map((l) => (
            <LinkLine key={l.profileId} l={l} candidates={data.candidates} onDone={() => router.refresh()} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function LinkLine({
  l,
  candidates,
  onDone,
}: {
  l: ErpLinkRow;
  candidates: ErpStatusData["candidates"];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-line/50 py-1.5 text-sm">
      <span className="w-28 font-medium text-ink">{l.driverName}</span>
      {l.erpEmployeeId ? (
        <>
          <span className={badgeSuccess}>연결됨</span>
          <span className="text-xs text-ink-muted">
            ERP: {l.erpName ?? "(ERP 표에 없음)"}
            {l.erpDepartment ? ` · ${l.erpDepartment}` : ""}
          </span>
        </>
      ) : (
        <>
          <span className={badgeWarning}>연결 필요</span>
          <span className="text-xs text-ink-hint">
            {l.reason === "ambiguous" ? "같은 이름 재직자가 여럿" : "같은 이름 재직자 없음"}
          </span>
          {!open ? (
            <button
              type="button"
              className="ml-auto rounded border border-line px-2 py-0.5 text-xs hover:bg-surface"
              onClick={() => setOpen(true)}
            >
              ERP 계정 고르기
            </button>
          ) : (
            <span className="ml-auto flex flex-wrap items-center gap-1">
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="rounded-md border border-line bg-card px-2 py-1 text-xs"
                aria-label="ERP 계정"
              >
                <option value="">ERP 계정 선택</option>
                {candidates.map((c) => (
                  <option key={c.employeeId} value={c.employeeId}>
                    {c.name}
                    {c.department ? ` · ${c.department}` : ""}
                    {c.jobTitle ? ` · ${c.jobTitle}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!pick || pending}
                className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const r = await linkErpEmployee(l.profileId, pick);
                    if (!r.ok) return setErr(r.message);
                    setOpen(false);
                    onDone();
                  })
                }
              >
                연결
              </button>
              <button type="button" className="text-xs text-ink-muted hover:underline" onClick={() => setOpen(false)}>
                취소
              </button>
            </span>
          )}
          {err && <span className="w-full text-xs text-stamp">{err}</span>}
        </>
      )}
    </li>
  );
}
