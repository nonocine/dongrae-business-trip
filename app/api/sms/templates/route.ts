import { cleanTemplate, createTemplate, listTemplates, type TemplateInput } from "@/lib/sms/templates";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 문구함 — 목록(내 것 + 공유) · 새 문구 저장.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await smsGate();
  if (user instanceof Response) return user;
  try {
    return smsJson({ ok: true, ...(await listTemplates(user)) });
  } catch (e) {
    return smsFail(500, errText(e));
  }
}

export async function POST(req: Request) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const input = cleanTemplate((await readJson<Partial<TemplateInput>>(req)) ?? {});
  if (typeof input === "string") return smsFail(400, input);
  try {
    return smsJson({ ok: true, id: await createTemplate(user, input) });
  } catch (e) {
    return smsFail(400, errText(e));
  }
}
