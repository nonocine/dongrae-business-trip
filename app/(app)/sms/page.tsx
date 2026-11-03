import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSmsAccess } from "@/lib/sms/access";
import { listSmsLogs } from "@/lib/sms/logs";
import { smsSourceMetas } from "@/lib/sms/sources";
import { smsChannelMetas } from "@/lib/sms/channels";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import SmsSender from "@/app/(app)/sms/SmsSender";
import { pageBg } from "@/app/(app)/sms/ui";

export const dynamic = "force-dynamic";

// 문자 발송 — 전 직원 공통 메뉴. 로그인 직원 + SMS_SEND_EMAILS(lib/sms/access). 메뉴 조건도 같습니다.
//   받는 사람 출처 카드는 등록표(lib/sms/sources/index.ts)에서 이 사람이 쓸 수 있는 것만.
//   발송은 문자 중계 서버(sms-relay) 경유 — 화면은 /api/sms/* 만 부릅니다.
export default async function SmsPage() {
  await enforcePasswordChange();
  const user = await resolveSmsAccess();
  if (!user) redirect("/");

  const [logsResult, programs] = await Promise.all([
    listSmsLogs(user, 50).then(
      (rows) => ({ rows, error: null as string | null }),
      (e: unknown) => ({ rows: [], error: e instanceof Error ? e.message : String(e) }),
    ),
    supabaseAdmin
      .from("business_programs")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => (data ?? []) as { id: string; name: string }[]),
  ]);

  return (
    <div className={`${pageBg} min-h-full`}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-5">
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">문자 발송</h2>
          <p className="mt-1 text-xs text-ink-muted">
            받는 사람을 여러 출처에서 골라 담고 한 번에 보냅니다. 받는 번호는 화면·기록에 남기지 않고 인원
            수만 남깁니다.
          </p>
        </div>
        <SmsSender
          sources={smsSourceMetas(user)}
          channels={smsChannelMetas(user)}
          logs={logsResult.rows}
          programs={programs}
          loadError={logsResult.error}
        />
      </div>
    </div>
  );
}
