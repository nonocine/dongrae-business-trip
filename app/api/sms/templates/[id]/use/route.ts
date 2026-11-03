import { markTemplateUsed } from "@/lib/sms/templates";
import { errText, smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 문구를 본문에 넣었을 때 사용 횟수 +1(많이 쓴 순 정렬용).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const { id } = await params;
  try {
    await markTemplateUsed(user, id);
    return smsJson({ ok: true });
  } catch (e) {
    return smsFail(400, errText(e));
  }
}
