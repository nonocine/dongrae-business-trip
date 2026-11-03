import { findSmsSource } from "@/lib/sms/sources";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";
import type { SmsOptionsRequest } from "@/lib/sms/text";

// 출처 선택기 목록 — 이름·소속·번호 있음 여부만(번호는 내보내지 않음).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const body = await readJson<SmsOptionsRequest>(req);
  const src = body?.source ? findSmsSource(body.source) : undefined;
  if (!src) return smsFail(400, "알 수 없는 출처입니다.");
  if (!src.canUse(user)) return smsFail(403, `"${src.label}" 출처를 쓸 권한이 없습니다.`);
  const filter: Record<string, string> = {};
  for (const [k, v] of Object.entries(body?.filter ?? {}))
    if (typeof v === "string") filter[k] = v.slice(0, 100);
  try {
    const r = await src.loadOptions(user, {
      filter,
      query: typeof body?.query === "string" ? body.query.slice(0, 50) : "",
    });
    return smsJson({ ok: true, ...r });
  } catch (e) {
    console.error(`[sms] 출처 목록 실패(${src.key}): ${errText(e)}`);
    return smsFail(500, errText(e));
  }
}
