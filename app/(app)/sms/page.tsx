import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSmsAccess } from "@/lib/smsAccess";
import { listSmsBkStudents, listSmsLogs } from "@/lib/smsServer";
import SmsSender from "@/app/(app)/sms/SmsSender";

export const dynamic = "force-dynamic";

// 문자 발송 — 공통 메뉴. 팀장 이상 + SMS_SEND_EMAILS(lib/smsAccess). 메뉴 조건도 같습니다.
//   발송은 문자 중계 서버(sms-relay) 경유 — 화면은 /api/sms/* 만 부릅니다.
export default async function SmsPage() {
  await enforcePasswordChange();
  if (!(await resolveSmsAccess())) redirect("/");

  let loadError: string | null = null;
  const [students, logs] = await Promise.all([
    listSmsBkStudents().catch((e) => {
      loadError = e instanceof Error ? e.message : String(e);
      return [];
    }),
    listSmsLogs(50).catch((e) => {
      loadError = e instanceof Error ? e.message : String(e);
      return [];
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4">
        <p className="text-xs font-semibold tracking-wide text-navy">
          동래구청소년센터
        </p>
        <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
          문자 발송
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          방과후아카데미 보호자 또는 직접 입력한 번호로 문자를 보냅니다. 받는 번호는
          기록에 남기지 않고 인원 수만 남깁니다.
        </p>
      </div>
      <SmsSender students={students} logs={logs} loadError={loadError} />
    </div>
  );
}
