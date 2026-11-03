import { cleanGroupMeta, deleteGroup, updateGroup, type GroupMetaInput } from "@/lib/sms/groups";
import { computeRecipients } from "@/lib/sms/recipients";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 주소록 수정·삭제 — 만든 사람과 M0(lib/sms/groups 가 확인).
//   text 를 주면 그 붙여넣기 명단으로 사람을 통째로 바꿉니다(직접 입력 그룹 고치기).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await readJson<{ meta?: Partial<GroupMetaInput>; text?: string }>(req);
  const meta = cleanGroupMeta(body?.meta ?? {});
  if (typeof meta === "string") return smsFail(400, meta);
  try {
    let members;
    if (typeof body?.text === "string" && body.text.trim()) {
      const r = await computeRecipients(user, [
        { uid: "paste", source: "manual", selection: { text: body.text }, excluded: [] },
      ]);
      members = r.refs;
    }
    await updateGroup(user, id, meta, members);
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
    await deleteGroup(user, id);
    return smsJson({ ok: true });
  } catch (e) {
    return smsFail(400, errText(e));
  }
}
