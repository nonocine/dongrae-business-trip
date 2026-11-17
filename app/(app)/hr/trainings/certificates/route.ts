import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { resolveTrainingAccess } from "@/lib/trainingAccess";
import { kstTodayYmd, toTraining } from "@/lib/trainings";
import { buildCertificateBundle, type BundleItem, type BundlePerson } from "@/lib/trainingCertBundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// =====================================================================
// 의무교육 수료증 일괄 다운로드 — POST /hr/trainings/certificates
//   body: { trainingId, driverIds: string[](표 순서), cover: boolean }
//   * 권한: 이수 현황판과 같게 — 인사 파일 열람 보유자만(isPersonnel).
//   * 합친 PDF 는 응답 본문으로 바로 보내지 않고 hr-documents 의 임시 폴더에 올린 뒤
//     10분짜리 다운로드 URL 을 돌려줍니다. 수십 명분이면 서버 응답 크기 한도(Vercel 4.5MB)를
//     넘기 때문입니다. 임시 파일은 다음 요청 때 1시간 지난 것부터 지웁니다.
//   * 수료증 미등록 직원은 서버에서 다시 판정해 빼고, 명단을 돌려줍니다.
// =====================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TMP_DIR = "training-bundles";
const TMP_TTL_MS = 60 * 60 * 1000;
const MAX_PEOPLE = 300;

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

export async function POST(req: Request) {
  const access = await resolveTrainingAccess();
  if (!access?.isPersonnel) return fail(403, "수료증 일괄 받기는 이수 현황판을 볼 수 있는 사람만 할 수 있습니다.");

  let body: { trainingId?: unknown; driverIds?: unknown; cover?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "잘못된 요청입니다.");
  }
  const trainingId = typeof body.trainingId === "string" ? body.trainingId : "";
  const driverIds = Array.isArray(body.driverIds)
    ? [...new Set(body.driverIds.filter((x): x is string => typeof x === "string" && UUID.test(x)))]
    : [];
  if (!UUID.test(trainingId)) return fail(400, "교육을 먼저 고르세요.");
  if (driverIds.length === 0) return fail(400, "직원을 한 명 이상 고르세요.");
  if (driverIds.length > MAX_PEOPLE) return fail(400, `한 번에 ${MAX_PEOPLE}명까지 받을 수 있습니다.`);

  const [tRes, cRes, dRes] = await Promise.all([
    supabaseAdmin.from("mandatory_trainings").select("*").eq("id", trainingId).maybeSingle(),
    supabaseAdmin
      .from("training_completions")
      .select("driver_id, certificate_path")
      .eq("training_id", trainingId)
      .in("driver_id", driverIds),
    supabaseAdmin.from("drivers").select("id, name, rank").in("id", driverIds),
  ]);
  if (tRes.error || cRes.error || dRes.error)
    return fail(500, (tRes.error ?? cRes.error ?? dRes.error)!.message);
  if (!tRes.data) return fail(404, "교육을 찾지 못했습니다.");
  const training = toTraining(tRes.data as Record<string, unknown>);

  const paths = new Map<string, string>();
  for (const c of (cRes.data ?? []) as { driver_id: string; certificate_path: string | null }[])
    if (c.certificate_path) paths.set(c.driver_id, c.certificate_path);
  const people = new Map<string, BundlePerson>();
  for (const d of (dRes.data ?? []) as { id: string; name: string | null; rank: string | null }[])
    people.set(d.id, { name: (d.name ?? "").trim() || "(이름 없음)", rank: d.rank ?? null });

  // 표 순서 유지. 직원 정보가 없는 id 는 조용히 버립니다(화면에 없던 사람).
  const ordered = driverIds.filter((id) => people.has(id));
  const withCert = ordered.filter((id) => paths.has(id));
  const missing = ordered.filter((id) => !paths.has(id)).map((id) => people.get(id)!);
  if (withCert.length === 0) return fail(400, "선택한 직원 모두 수료증이 등록되어 있지 않습니다.");

  // 내려받기 — 동시에 4개씩.
  const storage = supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET);
  const items: BundleItem[] = new Array(withCert.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, withCert.length) }, async () => {
      while (next < withCert.length) {
        const i = next++;
        const id = withCert[i];
        const { data } = await storage.download(paths.get(id)!);
        items[i] = { ...people.get(id)!, bytes: data ? new Uint8Array(await data.arrayBuffer()) : null };
      }
    }),
  );

  const { bytes, failed } = await buildCertificateBundle({
    trainingName: training.name,
    year: training.year,
    generatedOn: kstTodayYmd(),
    cover: body.cover !== false,
    items,
    missing,
  });

  // 임시 파일 정리(1시간 지난 것) — 실패해도 다운로드는 계속.
  try {
    const { data: old } = await storage.list(TMP_DIR, { limit: 1000 });
    const stale = (old ?? [])
      .filter((f) => Number(f.name.split("-")[0]) < Date.now() - TMP_TTL_MS)
      .map((f) => `${TMP_DIR}/${f.name}`);
    if (stale.length > 0) await storage.remove(stale);
  } catch {}

  const tmpPath = `${TMP_DIR}/${Date.now()}-${randomUUID()}.pdf`;
  const up = await storage.upload(tmpPath, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) return fail(500, `PDF 저장 실패: ${up.error.message}`);

  const safeName = training.name.replace(/[\\/:*?"<>|\r\n\t]+/g, "_").trim() || "교육";
  const filename = `${training.year}_${safeName}_수료증_${withCert.length}명.pdf`;
  const signed = await storage.createSignedUrl(tmpPath, 600, { download: filename });
  if (signed.error || !signed.data) return fail(500, "다운로드 주소를 만들지 못했습니다.");

  return Response.json({
    ok: true,
    url: signed.data.signedUrl,
    filename,
    included: withCert.length,
    missing: missing.map((p) => p.name),
    failed,
  });
}
