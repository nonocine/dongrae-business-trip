import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import Tabs from "@/app/components/Tabs";
import {
  getSealCounter,
  listMySealRequests,
  listPendingSealRequests,
  listSealLedger,
  listSealYears,
  resolveSealRegisterAccess,
} from "@/lib/sealRegisterServer";
import { SEAL_DOC_TYPES, certDateLabel, normalizeDocType, sealDocTypeLabel } from "@/lib/sealRegister";
import { kstTodayYmd } from "@/lib/trainings";
import { btnPrimary, btnSecondary, inputCls, labelCls, linkCls, tableHeadCls, tableRowCls } from "@/lib/ui";
import { SealRequestList, tap } from "@/app/(app)/seal-register/parts";

export const dynamic = "force-dynamic";

type Tab = "mine" | "pending" | "ledger";

// 직인사용대장 — 공통 메뉴. 모든 직원: 내 신청 / 관장·부장: + 결재함·전체 대장.
//   권한은 로그인한 사람의 drivers.rank(관장·부장)로만 판단합니다.
export default async function SealRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; year?: string; type?: string }>;
}) {
  await enforcePasswordChange();
  const a = await resolveSealRegisterAccess();
  if (!a) redirect("/");
  const sp = await searchParams;
  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const tab: Tab = a.isApprover && (sp.tab === "pending" || sp.tab === "ledger") ? sp.tab : "mine";
  const year = Number.isInteger(Number(sp.year)) && Number(sp.year) >= 2000 ? Number(sp.year) : thisYear;
  const docType = normalizeDocType(sp.type);

  const [mine, pending] = await Promise.all([
    tab === "mine" ? listMySealRequests(a) : Promise.resolve([]),
    a.isApprover ? listPendingSealRequests(a) : Promise.resolve([]),
  ]);
  const [ledger, years, counter] =
    tab === "ledger"
      ? await Promise.all([listSealLedger(a, { year, docType }), listSealYears(thisYear), getSealCounter(year)])
      : [[], [], null];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">직인사용대장</h2>
          <p className="mt-1 break-keep text-xs text-ink-muted">
            센터 직인이 들어가는 증서(수상확인증·수료증·표창장·상장·위촉장 등)를 신청하고, 관장 또는 부장 한 명이 승인하면 발급번호가 붙습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.isBoss && (
            <Link href="/seal-register/settings" className={`${btnSecondary} ${tap}`}>
              번호 설정
            </Link>
          )}
          <Link href="/seal-register/new" className={`${btnPrimary} ${tap}`}>
            + 새 신청
          </Link>
        </div>
      </div>

      {a.isApprover && (
        <Tabs
          variant="segment"
          ariaLabel="직인사용대장 보기"
          value={tab}
          className="mb-4"
          items={[
            { key: "mine", label: "내 신청", href: "/seal-register" },
            { key: "pending", label: "결재함", href: "/seal-register?tab=pending", badge: pending.length },
            { key: "ledger", label: "전체 대장", href: "/seal-register?tab=ledger" },
          ]}
        />
      )}

      {tab === "mine" && <SealRequestList items={mine} empty="아직 신청이 없습니다. [+ 새 신청]으로 시작하세요." />}
      {tab === "pending" && <SealRequestList items={pending} showRequester empty="결재할 신청이 없습니다." />}

      {tab === "ledger" && (
        <section className="space-y-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="ledger" />
            <label className="min-w-0">
              <span className={labelCls}>연도</span>
              <select name="year" defaultValue={String(year)} className={`${inputCls} h-11 text-base sm:h-auto sm:text-sm`}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className={labelCls}>종류</span>
              <select name="type" defaultValue={docType ?? ""} className={`${inputCls} h-11 text-base sm:h-auto sm:text-sm`}>
                <option value="">전체</option>
                {SEAL_DOC_TYPES.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${btnSecondary} ${tap}`}>
              보기
            </button>
          </form>

          <p className="break-keep text-xs text-ink-muted">
            {year}년 발급 {ledger.length}건{docType ? `(${sealDocTypeLabel(docType)})` : ""} · 취소 {ledger.filter((l) => l.canceledAt).length}건(결번)
            {counter?.startSeq ? ` · 시작 번호 ${counter.startSeq}(그 앞은 종이 발급분)` : ""}
          </p>

          {ledger.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">발급된 증서가 없습니다.</p>
          ) : (
            <>
              {/* 폰: 카드 */}
              <ul className="space-y-2 sm:hidden">
                {ledger.map((l) => (
                  <li key={l.recipientId} className={`rounded-lg border bg-card px-4 py-3 ${l.canceledAt ? "border-stamp/40" : "border-rule"}`}>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className={`font-semibold ${l.canceledAt ? "text-ink-muted line-through" : "text-ink"}`}>{l.issueLabel}</span>
                      {l.canceledAt && <span className="text-xs font-semibold text-stamp">취소(결번)</span>}
                    </div>
                    <p className="mt-1 break-all text-sm text-ink-body">
                      {l.title} · {l.name}
                    </p>
                    <p className="mt-0.5 break-keep text-xs text-ink-muted">
                      증서 날짜 {certDateLabel(l.certDate)} · 신청 {l.requesterName} · 승인 {l.approverName ?? "-"}
                    </p>
                    {l.canceledAt && (
                      <p className="mt-1 break-all text-xs text-stamp">
                        취소 {l.canceledBy} · {l.cancelReason}
                      </p>
                    )}
                    <Link href={`/seal-register/${l.requestId}`} className={`${linkCls} mt-1 inline-flex min-h-11 items-center text-sm`}>
                      신청 보기
                    </Link>
                  </li>
                ))}
              </ul>
              {/* PC: 표 */}
              <div className="hidden overflow-x-auto rounded-lg border border-rule bg-card sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={tableHeadCls}>
                      <th className="px-3 py-2 text-left">발급번호</th>
                      <th className="px-3 py-2 text-left">종류·제목</th>
                      <th className="px-3 py-2 text-left">대상</th>
                      <th className="px-3 py-2 text-left">증서 날짜</th>
                      <th className="px-3 py-2 text-left">신청·승인</th>
                      <th className="px-3 py-2 text-left">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.recipientId} className={tableRowCls}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Link href={`/seal-register/${l.requestId}`} className={`${linkCls} ${l.canceledAt ? "line-through" : ""}`}>
                            {l.issueLabel}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{l.title}</td>
                        <td className="break-all px-3 py-2">{l.name}</td>
                        <td className="whitespace-nowrap px-3 py-2">{certDateLabel(l.certDate)}</td>
                        <td className="px-3 py-2 text-xs text-ink-muted">
                          {l.requesterName} / {l.approverName ?? "-"}
                        </td>
                        <td className="px-3 py-2">
                          {l.canceledAt ? (
                            <span className="text-xs text-stamp" title={l.cancelReason ?? ""}>
                              취소(결번) · {l.canceledBy}
                              <br />
                              {l.cancelReason}
                            </span>
                          ) : (
                            <span className="text-xs text-success">발급</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
