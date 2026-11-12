import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminDashboardData } from "@/app/(app)/admin/dashboardData";
import { pendingTaskTotal, type PendingTask } from "@/lib/pendingTasks";

// =====================================================================
// 관리자 대시보드 구역 카드(서버 컴포넌트, 표시 전용).
//   * 숫자 카드는 누르면 해당 화면으로 갑니다.
//   * 0건이면 회색으로 작게, null(못 셌음)이면 "—".
//   * 휴대폰 폭에서는 한 줄에 한 카드(grid-cols-1), sm 이상에서 여러 칸.
// =====================================================================

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-navy">{title}</h3>
      {children}
    </section>
  );
}

export function CardGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

function NumberCard({
  href,
  label,
  value,
  unit = "건",
  sub,
  tone = "navy",
}: {
  href: string;
  label: string;
  value: number | null;
  unit?: string;
  sub?: ReactNode;
  tone?: "navy" | "stamp" | "warning";
}) {
  const empty = value === 0;
  const unknown = value == null;
  const color = tone === "stamp" ? "text-stamp" : tone === "warning" ? "text-warning" : "text-navy";
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-4 shadow-sm transition hover:border-navy ${
        empty || unknown ? "border-line bg-surface/60" : "border-line bg-card"
      }`}
    >
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className={`mt-0.5 font-mono font-bold ${empty || unknown ? "text-base text-ink-hint" : `text-2xl ${color}`}`}>
        {unknown ? "—" : `${value}${unit}`}
      </p>
      {sub && <div className="mt-1 text-[11px] text-ink-body">{sub}</div>}
    </Link>
  );
}

// ① 오늘 -------------------------------------------------------------------
// 결재 대기 = lib/pendingTasks 의 '내가 처리할 일' 합계 — 메인 '확인할 일' 카드·헤더 배지와 같은 숫자.
export function TodaySection({ d, tasks }: { d: AdminDashboardData; tasks: PendingTask[] }) {
  const absent = d.absent;
  const total = pendingTaskTotal(tasks);
  return (
    <Section title="오늘">
      <CardGrid cols={2}>
        <NumberCard
          href="/duties"
          label="오늘 부재 직원 (ERP 휴가·출장·외근)"
          value={absent ? absent.length : null}
          unit="명"
          sub={
            absent && absent.length > 0 ? (
              <ul className="space-y-0.5">
                {absent.slice(0, 8).map((p, i) => (
                  <li key={i}>
                    {p.name} · <span className="text-ink-muted">{p.type}</span>
                  </li>
                ))}
                {absent.length > 8 && <li className="text-ink-hint">외 {absent.length - 8}명</li>}
              </ul>
            ) : null
          }
        />
        <NumberCard
          href={tasks[0]?.href ?? "/"}
          label="결재 대기·확인할 일 (내가 처리할 것)"
          value={total}
          tone="warning"
          sub={
            total ? (
              <ul className="space-y-0.5 text-ink-muted">
                {tasks.map((t, i) => (
                  <li key={i}>
                    {t.label} {t.count}
                    {t.kind === "appointment" ? ` · ${t.names.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
            ) : null
          }
        />
      </CardGrid>
    </Section>
  );
}

// ② 기한 알림(연차 사용촉진 카드는 페이지가 PromotionAlerts 를 끼워 넣습니다) ------------
export function DeadlineCards({ d, tasks }: { d: AdminDashboardData; tasks: PendingTask[] }) {
  const ic = d.instructorContracts;
  // 직인 결재 대기 — '내 차례' 기준(본인 신청 제외)이라 pendingTasks 에서 가져옵니다.
  const seal = tasks.filter((t) => t.kind === "seal").reduce((n, t) => n + t.count, 0);
  return (
    <CardGrid cols={3}>
      <NumberCard href="/hr/saems/contracts" label="강사 계약서 — 강사 서명 대기" value={ic ? ic.waitingInstructor : null} />
      <NumberCard href="/hr/saems/contracts?filter=seal_pending" label="강사 계약서 — 관장 날인 대기" value={ic ? ic.waitingSeal : null} tone="warning" />
      <NumberCard href="/seal-register" label="직인 결재 대기" value={seal} tone="warning" />
    </CardGrid>
  );
}

// ③ 인사·복무 ----------------------------------------------------------------
export function HrSection({ d }: { d: AdminDashboardData }) {
  return (
    <Section title="인사·복무">
      <CardGrid cols={2}>
        <NumberCard
          href="/hr/duty-dashboard"
          label="연차 잔여 5일 이상 인원"
          value={d.leave5 ? d.leave5.count : null}
          unit="명"
          sub={d.leave5 ? <span className="text-ink-muted">잔여가 집계된 재직자 {d.leave5.total}명 중</span> : null}
        />
        <Link
          href="/hr/duty-dashboard"
          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-4 shadow-sm transition hover:border-navy"
        >
          <div>
            <p className="text-sm font-semibold text-ink">📈 복무·연차 대시보드</p>
            <p className="mt-0.5 text-xs text-ink-muted">직원별 연차·대휴 잔여, 부재·출장·초과근무 현황 (ERP)</p>
          </div>
          <span aria-hidden className="text-lg text-ink-hint">→</span>
        </Link>
      </CardGrid>
    </Section>
  );
}

// ④ 시스템 상태(작게) -----------------------------------------------------------
function fmtKst(iso: string | null): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

const HOUR = 3600 * 1000;

// 점 색: bad(빨강) > warn(노랑) > 정상(옅은 회색).
function StatusRow({
  href,
  label,
  text,
  bad,
  warn = false,
}: {
  href: string;
  label: string;
  text: string;
  bad: boolean;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs transition hover:border-navy"
    >
      <span
        aria-label={bad ? "문제 있음" : warn ? "확인 필요" : "정상"}
        className={`h-2 w-2 shrink-0 rounded-full ${bad ? "bg-stamp" : warn ? "bg-warning" : "bg-ink-hint/40"}`}
      />
      <span className="shrink-0 font-semibold text-ink-body">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-ink-muted">{text}</span>
    </Link>
  );
}

export function SystemSection({ d, now }: { d: AdminDashboardData; now: number }) {
  const { erp, backup, sms7d, sensitive7d } = d.system;
  // 문자 — 빨간 점은 통째로 실패한 발송(ok=false)이 있을 때만, 일부 번호 실패만 있으면 노란 점.
  const smsText = !sms7d
    ? "확인 실패"
    : [
        sms7d.failedSends > 0 ? `발송 실패 ${sms7d.failedSends}회` : "",
        sms7d.partialNumbers > 0 ? `일부 번호 실패 ${sms7d.partialNumbers}건(발송 ${sms7d.partialSends}회)` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "실패 없음";
  // ERP — 하루 3번(07·12·18시 KST) 자동 실행이라, 최근 실행이 26시간 넘게 없거나 24시간 안에 실패가 있으면 빨간 점.
  const erpBad = !erp || erp.failed24h > 0 || !erp.lastAt || now - new Date(erp.lastAt).getTime() > 26 * HOUR;
  // 주간 백업 — 최근 결과가 성공이 아니거나 8일 넘게 없으면 빨간 점.
  const backupBad =
    !backup || backup.status !== "success" || now - new Date(backup.startedAt).getTime() > 8 * 24 * HOUR;
  return (
    <Section title="시스템 상태">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatusRow
          href="/admin/erp"
          label="ERP 동기화"
          text={erp ? `최근 ${fmtKst(erp.lastAt)} · 24시간 오류 ${erp.failed24h}건` : "확인 실패"}
          bad={erpBad}
        />
        <StatusRow
          href="/hr/backup"
          label="주간 백업"
          text={backup ? `${fmtKst(backup.startedAt)} · ${backup.status === "success" ? "성공" : backup.status}` : "기록 없음"}
          bad={backupBad}
        />
        <StatusRow
          href="/sms#sms-history"
          label="문자 발송(7일)"
          text={smsText}
          bad={!sms7d || sms7d.failedSends > 0}
          warn={!!sms7d && sms7d.partialNumbers > 0}
        />
        <StatusRow
          href="/admin/sensitive"
          label="민감정보 열람(7일)"
          text={sensitive7d == null ? "확인 실패" : `${sensitive7d}건`}
          bad={sensitive7d == null}
        />
      </div>
    </Section>
  );
}

// ⑤ 바로가기 ----------------------------------------------------------------
const SHORTCUTS = [
  { href: "/hr?tab=records", icon: "👥", label: "직원 인사관리" },
  { href: "/hr/leave-plans", icon: "🌴", label: "연차 사용촉진" },
  { href: "/hr/leave-payout", icon: "💰", label: "연차수당 산정" },
  { href: "/admin/sensitive", icon: "🔒", label: "민감정보" },
  { href: "/admin/erp", icon: "🔄", label: "ERP 연결" },
] as const;

export function ShortcutSection() {
  return (
    <Section title="바로가기">
      <CardGrid cols={5}>
        {SHORTCUTS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-3 text-sm font-semibold text-ink shadow-sm transition hover:border-navy"
          >
            <span aria-hidden>{s.icon}</span>
            {s.label}
          </Link>
        ))}
      </CardGrid>
    </Section>
  );
}
