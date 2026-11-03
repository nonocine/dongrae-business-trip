import { cleanBundles, computeRecipients } from "@/lib/sms/recipients";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 담긴 명단 인원 계산 — 중복·번호 없음 반영. 응답엔 이름·출처·번호 있음 여부만.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const body = await readJson<{ bundles?: unknown }>(req);
  try {
    const r = await computeRecipients(user, cleanBundles(body?.bundles));
    return smsJson(r.preview);
  } catch (e) {
    return smsFail(400, errText(e));
  }
}
