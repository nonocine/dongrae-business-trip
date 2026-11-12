import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { canViewSensitiveAdmin, listSensitiveAccessLogs } from "@/app/(app)/admin/sensitive/actions";
import BackfillButton from "@/app/(app)/admin/sensitive/BackfillButton";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 민감정보 열람 기록 — M0(관장·부장·master) 전용.
//   주민번호 [보기]·계좌 [복사]·계좌가 들어간 엑셀 내보내기가 남긴 기록(sensitive_access_logs)을 최근순으로.
function fmtKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default async function SensitiveAdminPage() {
  await enforcePasswordChange();
  if (!(await canViewSensitiveAdmin())) redirect("/");
  const logs = await listSensitiveAccessLogs(300);

  const th = "px-2 py-2 text-left whitespace-nowrap";
  const td = "px-2 py-2 align-top text-sm text-ink-body";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">민감정보 열람 기록</h2>
        <Link href="/admin" className="text-sm text-ink-muted hover:underline">
          ← 관리자 대시보드
        </Link>
      </div>

      <section className={`${cardCls} mb-5 space-y-2`}>
        <h3 className="text-sm font-semibold text-ink">암호화 채우기(일회성)</h3>
        <p className="text-xs text-ink-muted">
          직원 주민번호·강사 계좌번호 중 아직 암호문이 없는 행을 암호화합니다. 이미 암호화된 행은
          건너뛰고, 평문 칸은 건드리지 않습니다. 결과는 건수만 보여 줍니다.
        </p>
        <BackfillButton />
      </section>

      <section className={cardCls}>
        <h3 className="mb-2 text-sm font-semibold text-ink">최근 열람 {logs.length}건</h3>
        {logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">아직 열람 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-line text-xs text-ink-muted">
                  <th className={th}>시각</th>
                  <th className={th}>열람자</th>
                  <th className={th}>항목</th>
                  <th className={th}>대상</th>
                  <th className={th}>목적</th>
                  <th className={th}>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-line/60">
                    <td className={`${td} whitespace-nowrap font-mono text-xs`}>{fmtKst(l.accessedAt)}</td>
                    <td className={td}>{l.actorName}</td>
                    <td className={td}>{l.field}</td>
                    <td className={td}>{l.targetLabel}</td>
                    <td className={td}>{l.purpose}</td>
                    <td className={`${td} font-mono text-xs text-ink-muted`}>{l.ip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
