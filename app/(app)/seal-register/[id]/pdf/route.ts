import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadOrgSeal } from "@/lib/orgSeal";
import { buildSealCertPdf, type SealCertPage } from "@/lib/sealCertPdf";
import { certDateLabel, normalizeItemValues } from "@/lib/sealRegister";
import { canViewRequest, resolveSealRegisterAccess } from "@/lib/sealRegisterServer";
import { kstTodayYmd } from "@/lib/trainings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 직인사용대장 증서 PDF — 한 파일, 1인 1쪽.  ?ids=대상자id,대상자id (없으면 전부)
//   · 발급 전(작성 중·결재 대기·반려·회수): "미리보기 — 직인 없음", 번호 자리 "제2026-○○호(승인 시 부여)". 기록 없음.
//   · 발급 후: snapshot 만으로 그림(재출력해도 같은 PDF) + 기관 직인. 취소된 줄은 빠짐.
//     출력할 때마다 seal_print_logs 한 줄 — 같은 줄을 전에 뽑은 적 있으면 재출력.
//   · 권한: 본인 신청 또는 관장·부장(drivers.rank). 남의 신청은 있는지조차 알리지 않음(404).
const CERTIFIER = "동래구청소년센터장";
const UUID = /^[0-9a-f-]{36}$/i;
type Raw = Record<string, unknown>;

function fileResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_");

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await resolveSealRegisterAccess();
  if (!a) return new Response("로그인해 주세요.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("신청을 찾을 수 없습니다.", { status: 404 });

  const { data: req } = await supabaseAdmin
    .from("seal_requests")
    .select("id, requester_driver_id, title, cert_date, status")
    .eq("id", id)
    .maybeSingle();
  const r = req as Raw | null;
  if (!r || !canViewRequest(a, (r.requester_driver_id as string | null) ?? null))
    return new Response("신청을 찾을 수 없습니다.", { status: 404 });

  const wanted = new URL(request.url).searchParams.get("ids");
  const pick = wanted ? new Set(wanted.split(",").filter((x) => UUID.test(x))) : null;

  const { data: recs, error } = await supabaseAdmin
    .from("seal_recipients")
    .select("id, line_no, recipient_name, items, body, issue_seq, snapshot, canceled_at")
    .eq("request_id", id)
    .order("line_no");
  if (error) return new Response(error.message, { status: 500 });
  const rows = ((recs ?? []) as Raw[]).filter((x) => !pick || pick.has(String(x.id)));

  const issued = r.status === "issued";
  if (!issued) {
    const year = kstTodayYmd().slice(0, 4);
    const pages: SealCertPage[] = rows.map((x) => ({
      issueLabel: `제${year}-○○호(승인 시 부여)`,
      title: String(r.title ?? ""),
      items: normalizeItemValues(x.items),
      body: String(x.body ?? ""),
      certDateText: certDateLabel(String(r.cert_date ?? "").slice(0, 10)),
      certifier: CERTIFIER,
    }));
    if (!pages.length) return new Response("대상자가 없습니다.", { status: 400 });
    const pdf = await buildSealCertPdf(pages, { preview: true });
    return fileResponse(pdf, `${safeName(String(r.title))}_미리보기.pdf`);
  }

  const live = rows.filter((x) => x.issue_seq != null && x.canceled_at == null && x.snapshot);
  if (!live.length) return new Response("출력할 증서가 없습니다(모두 취소됨).", { status: 400 });
  const pages: SealCertPage[] = live.map((x) => {
    const s = x.snapshot as Raw;
    return {
      issueLabel: String(s.issueLabel ?? ""),
      title: String(s.title ?? ""),
      items: normalizeItemValues(s.items),
      body: String(s.body ?? ""),
      certDateText: certDateLabel(String(s.certDate ?? "").slice(0, 10)),
      certifier: String(s.certifier ?? CERTIFIER),
    };
  });
  const sealBytes = await loadOrgSeal();
  const pdf = await buildSealCertPdf(pages, { preview: false, sealBytes });

  // 출력 기록 — 같은 줄을 전에 뽑은 적 있으면 재출력
  const ids = live.map((x) => String(x.id));
  const { count } = await supabaseAdmin
    .from("seal_print_logs")
    .select("id", { count: "exact", head: true })
    .eq("request_id", id)
    .overlaps("recipient_ids", ids);
  const { error: logErr } = await supabaseAdmin.from("seal_print_logs").insert({
    request_id: id,
    recipient_ids: ids,
    is_reprint: (count ?? 0) > 0,
    printed_by_driver_id: a.driverId,
    printed_by_name: a.name,
  });
  if (logErr) return new Response(`출력 기록을 남기지 못해 출력을 멈췄습니다 — ${logErr.message}`, { status: 500 });

  const first = pages[0].issueLabel;
  const last = pages[pages.length - 1].issueLabel;
  return fileResponse(pdf, `${safeName(pages[0].title)}_${first}${pages.length > 1 ? `~${last}` : ""}.pdf`);
}
