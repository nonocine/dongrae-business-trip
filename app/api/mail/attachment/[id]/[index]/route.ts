// =====================================================================
// 공용 메일함 — 첨부 다운로드 (0단계)
//   GET /api/mail/attachment/{메일id}/{첨부순번}
//     → 서명 URL 로 302. 화면은 이 주소를 <a href> 에 그대로 겁니다.
//
//   왜 라우트인가 (0단계 이전: 서버액션 + window.open):
//     예전에는 화면이 서버액션으로 서명 URL 을 받은 뒤 window.open 을 불렀는데,
//     await 를 지난 뒤라 사용자 제스처가 이미 끊겨 사파리와 일부 크롬이
//     팝업으로 보고 차단했습니다. 라우트로 넘기면 클릭이 곧 이동이라
//     차단될 여지가 없고, 서명을 미리 받아두지 않아 만료 문제도 없습니다.
//
//   ★ 경로(storage_path)를 주소로 받지 않습니다. 메일 id + 순번만 받고
//     경로는 DB 에서 다시 읽습니다. 예전 signMailAttachment(path) 는 버킷 안
//     아무 경로나 클라이언트가 지정할 수 있었습니다 — 그 문을 닫았습니다.
//
//   ★ 접근은 requireMailAccess 하나로 막습니다. mail_messages 는 RLS 정책이
//     0개라 service_role 로만 읽히므로, 이 가드가 유일한 방어선입니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMailAccess } from "@/lib/mailAccess";
import { signedAttachmentUrl } from "@/lib/mailAttachment";
import { attachmentSkipNotice, toAttachments } from "@/lib/mail";

export const dynamic = "force-dynamic";

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; index: string }> },
): Promise<Response> {
  try {
    await requireMailAccess();
  } catch {
    return text("로그인이 필요합니다.", 401);
  }

  const { id, index } = await ctx.params;
  const at = Number(index);
  if (!id || !Number.isInteger(at) || at < 0) {
    return text("잘못된 첨부 주소입니다.", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("mail_messages")
    .select("attachments")
    .eq("id", id)
    .maybeSingle();
  if (error) return text("첨부를 불러오지 못했습니다.", 500);
  if (!data) return text("메일을 찾을 수 없습니다.", 404);

  const att = toAttachments((data as { attachments: unknown }).attachments)[at];
  if (!att) return text("첨부를 찾을 수 없습니다.", 404);

  // 사본이 없는 첨부(10MB 초과·업로드 실패·2단계 이전 기존 행).
  //   화면이 이 경우를 미리 걸러 안내하므로 여기까지 오는 일은 거의 없지만,
  //   주소를 직접 열었을 때 빈 화면이 되지 않도록 같은 문구를 돌려줍니다.
  if (!att.storage_path) {
    return text(attachmentSkipNotice(att.name, att.skip_reason), 409);
  }

  const url = await signedAttachmentUrl(att.storage_path, att.name);
  if (!url) return text("첨부 링크를 만들지 못했습니다.", 502);

  // 서명 URL 이 공용 캐시에 남지 않도록 no-store 를 함께 보냅니다.
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
