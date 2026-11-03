import { cleanTemplate, deleteTemplate, updateTemplate, type TemplateInput } from "@/lib/sms/templates";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 문구 수정·즐겨찾기·삭제 — 만든 사람과 M0(lib/sms/templates 가 확인).
//   body 가 { is_favorite } 만이면 즐겨찾기만 바꿉니다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await readJson<Partial<TemplateInput>>(req)) ?? {};
  let patch: Partial<TemplateInput>;
  if (Object.keys(body).length === 1 && typeof body.is_favorite === "boolean") {
    patch = { is_favorite: body.is_favorite };
  } else {
    const input = cleanTemplate(body);
    if (typeof input === "string") return smsFail(400, input);
    patch = input;
  }
  try {
    await updateTemplate(user, id, patch);
    return smsJson({ ok: true });
  } catch (e) {
    return smsFail(400, errText(e));
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const { id } = await params;
  try {
    await deleteTemplate(user, id);
    return smsJson({ ok: true });
  } catch (e) {
    return smsFail(400, errText(e));
  }
}
