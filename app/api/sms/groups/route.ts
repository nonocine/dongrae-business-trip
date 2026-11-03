import { cleanGroupMeta, createGroup, listGroups, type GroupMetaInput } from "@/lib/sms/groups";
import { cleanBundles, computeRecipients } from "@/lib/sms/recipients";
import { errText, readJson, smsFail, smsGate, smsJson } from "@/lib/sms/http";

// 주소록 — 목록(내 것 + 공유) · 새로 만들기.
//   만들기: { meta, bundles } 로 담긴 명단을 저장하거나 { meta, text } 로 붙여넣기 명단을 저장.
//   DB 출처 사람은 {source, ref_id} 참조로, 직접 입력만 번호로 저장합니다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await smsGate();
  if (user instanceof Response) return user;
  try {
    return smsJson({ ok: true, ...(await listGroups(user)) });
  } catch (e) {
    return smsFail(500, errText(e));
  }
}

export async function POST(req: Request) {
  const user = await smsGate();
  if (user instanceof Response) return user;
  const body = await readJson<{ meta?: Partial<GroupMetaInput>; bundles?: unknown; text?: string }>(req);
  const meta = cleanGroupMeta(body?.meta ?? {});
  if (typeof meta === "string") return smsFail(400, meta);
  try {
    const bundles =
      typeof body?.text === "string"
        ? [{ uid: "paste", source: "manual", selection: { text: body.text }, excluded: [] }]
        : cleanBundles(body?.bundles);
    const { refs } = await computeRecipients(user, bundles);
    if (refs.length === 0) return smsFail(400, "저장할 사람이 없습니다(번호 있는 사람만 저장됩니다).");
    const id = await createGroup(user, meta, refs);
    return smsJson({ ok: true, id, count: refs.length });
  } catch (e) {
    return smsFail(400, errText(e));
  }
}
