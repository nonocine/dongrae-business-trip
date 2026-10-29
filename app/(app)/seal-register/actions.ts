"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifySealDecided, notifySealSubmitted } from "@/lib/sealNotify";
import {
  SEAL_BODY_MAX,
  SEAL_MAX_ITEMS,
  SEAL_MAX_RECIPIENTS,
  SEAL_NAME_MAX,
  SEAL_TITLE_MAX,
  isYmd,
  normalizeDocType,
  normalizeItemDefs,
  recipientItems,
  sealDocTypeLabel,
  sealIssueLabel,
  unfilledPlaceholders,
  type SealDraftInput,
} from "@/lib/sealRegister";
import { requireSealRegisterAccess, type SealAccess } from "@/lib/sealRegisterServer";

// =====================================================================
// 직인사용대장 서버 액션 — /seal-register
//   * 모두 service_role. 들어올 때마다 로그인한 사람의 drivers.rank 로 권한을 다시 봅니다.
//   * 상태 변경은 DB 함수로만: seal_submit_request / seal_withdraw_request / seal_reject_request
//     / seal_approve_request / seal_cancel_recipient / seal_set_start_no.
//     표에 직접 쓰는 것은 작성 중·반려·회수 상태의 '내용'(제목·항목·대상자)뿐 — DB 트리거가 그 밖을 막습니다.
//   * DB 오류 문구(한국어)는 그대로 화면에 돌려줍니다.
//   * 슬랙 DM 은 응답을 보낸 뒤(after) — 느려도 화면은 기다리지 않습니다.
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const BASE = "/seal-register";
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (e: unknown, fallback = "처리하지 못했습니다.") => ({
  ok: false as const,
  message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : fallback,
});
const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function refresh(id?: string) {
  revalidatePath(BASE);
  if (id) revalidatePath(`${BASE}/${id}`);
}

type ReqRow = {
  id: string;
  requester_driver_id: string | null;
  requester_name: string;
  doc_type: string;
  title: string;
  status: string;
};

async function loadRequest(id: string): Promise<ReqRow> {
  if (!UUID.test(id)) throw new Error("신청을 찾을 수 없습니다.");
  const { data, error } = await supabaseAdmin
    .from("seal_requests")
    .select("id, requester_driver_id, requester_name, doc_type, title, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("신청을 찾을 수 없습니다.");
  return data as ReqRow;
}

async function loadOwnRequest(a: SealAccess, id: string): Promise<ReqRow> {
  const r = await loadRequest(id);
  if (r.requester_driver_id !== a.driverId) throw new Error("본인 신청만 할 수 있습니다.");
  return r;
}

async function recipientCount(id: string): Promise<number> {
  const { count } = await supabaseAdmin.from("seal_recipients").select("id", { count: "exact", head: true }).eq("request_id", id);
  return count ?? 0;
}

// --- 입력 검사 ----------------------------------------------------------
function cleanDraft(input: SealDraftInput, forSubmit: boolean) {
  const docType = normalizeDocType(input.docType);
  if (!docType) throw new Error("증서 종류를 고르세요.");
  const title = clip(input.title, SEAL_TITLE_MAX + 10).replace(/\s+/g, " ");
  if (!title) throw new Error("제목을 넣으세요.");
  if (title.length > SEAL_TITLE_MAX) throw new Error(`제목은 ${SEAL_TITLE_MAX}자까지입니다.`);
  if (!isYmd(input.certDate)) throw new Error("증서 날짜를 넣으세요.");
  const purpose = clip(input.purpose, 200) || null;

  const defs = normalizeItemDefs(input.itemTemplate);
  if (defs.length > SEAL_MAX_ITEMS) throw new Error(`○ 항목은 ${SEAL_MAX_ITEMS}개까지입니다.`);
  if (defs.filter((d) => d.isName).length !== 1) throw new Error("대상자 이름 항목이 하나 있어야 합니다.");
  const labels = defs.map((d) => d.label);
  if (new Set(labels).size !== labels.length) throw new Error("○ 항목 이름이 겹칩니다. 서로 다르게 해 주세요.");

  const bodyTemplate = String(input.bodyTemplate ?? "").slice(0, SEAL_BODY_MAX);
  const list = Array.isArray(input.recipients) ? input.recipients : [];
  if (list.length === 0) throw new Error("대상자를 한 명 이상 넣으세요.");
  if (list.length > SEAL_MAX_RECIPIENTS) throw new Error(`대상자는 한 신청에 ${SEAL_MAX_RECIPIENTS}명까지입니다.`);

  const recipients = list.map((r, i) => {
    const name = clip(r?.name, SEAL_NAME_MAX + 1);
    if (!name) throw new Error(`${i + 1}번째 줄: 이름(팀명)을 넣으세요.`);
    if (name.length > SEAL_NAME_MAX) throw new Error(`${i + 1}번째 줄: 이름은 ${SEAL_NAME_MAX}자까지입니다.`);
    const values: Record<string, string> = {};
    for (const d of defs) if (d.scope === "person" && !d.isName) values[d.label] = clip(r?.values?.[d.label], 200);
    const body = String(r?.body ?? "").trim();
    if (!body) throw new Error(`${i + 1}번째 줄(${name}): 본문이 비었습니다.`);
    if (body.length > SEAL_BODY_MAX) throw new Error(`${i + 1}번째 줄(${name}): 본문은 ${SEAL_BODY_MAX}자까지입니다.`);
    if (forSubmit) {
      const left = unfilledPlaceholders(body);
      if (left.length) throw new Error(`${i + 1}번째 줄(${name}): 본문에 채워지지 않은 자리 {${left.join("}, {")}} 가 있습니다.`);
      const empty = defs.find((d) => !d.isName && (d.scope === "person" ? !values[d.label] : !(d.value ?? "").trim()));
      if (empty) throw new Error(`○ ${empty.label} 칸이 비었습니다${empty.scope === "person" ? `(${i + 1}번째 줄 ${name})` : ""}.`);
    }
    return { line_no: i + 1, recipient_name: name, items: recipientItems(defs, name, values), body };
  });
  return { docType, title, certDate: input.certDate, purpose, defs, bodyTemplate, recipients };
}

// --- 저장(작성 중) · 올리기 ---------------------------------------------
//   새 신청이면 작성 중(draft)으로 만들고, 고치기면 작성 중·반려·회수 상태에서만 내용을 바꿉니다.
//   submit=true 면 저장 뒤 seal_submit_request 로 결재에 올립니다.
export async function saveSealRequest(input: SealDraftInput, submit: boolean): Promise<Result<{ id: string }>> {
  try {
    const a = await requireSealRegisterAccess();
    const c = cleanDraft(input, submit);
    const content = {
      doc_type: c.docType,
      title: c.title,
      cert_date: c.certDate,
      purpose: c.purpose,
      item_template: c.defs,
      body_template: c.bodyTemplate,
    };

    let id = input.id ? String(input.id) : "";
    if (id) {
      const r = await loadOwnRequest(a, id);
      if (!["draft", "rejected", "withdrawn"].includes(r.status))
        return { ok: false, message: "결재 중이거나 발급된 신청은 고칠 수 없습니다. 결재 대기 중이면 먼저 회수하세요." };
      const { error: e1 } = await supabaseAdmin.from("seal_requests").update(content).eq("id", id);
      if (e1) return fail(e1);
      const { error: e2 } = await supabaseAdmin.from("seal_recipients").delete().eq("request_id", id);
      if (e2) return fail(e2);
    } else {
      const { data, error } = await supabaseAdmin
        .from("seal_requests")
        .insert({ ...content, requester_driver_id: a.driverId, requester_name: a.name })
        .select("id")
        .single();
      if (error) return fail(error);
      id = String((data as { id: string }).id);
    }

    const { error: e3 } = await supabaseAdmin.from("seal_recipients").insert(c.recipients.map((r) => ({ ...r, request_id: id })));
    if (e3) return { ok: false, message: `대상자를 저장하지 못했습니다 — ${e3.message} (작성 중으로 남아 있으니 다시 저장해 주세요)` };

    if (submit) {
      const s = await submitInternal(a, id, c.recipients.length);
      if (!s.ok) return { ok: false, message: `작성 중으로 저장했지만 결재에 올리지 못했습니다 — ${s.message}` };
    }
    refresh(id);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

async function submitInternal(a: SealAccess, id: string, count: number): Promise<Result> {
  const { data: approvalId, error } = await supabaseAdmin.rpc("seal_submit_request", { p_request_id: id });
  if (error) return fail(error);
  const r = await loadRequest(id);
  const { data: ap } = await supabaseAdmin.from("approvals").select("round").eq("id", String(approvalId)).maybeSingle();
  after(() =>
    notifySealSubmitted({
      requestId: id,
      requesterDriverId: a.driverId,
      requesterName: a.name,
      requesterRank: a.rank,
      docLabel: r.title || sealDocTypeLabel(r.doc_type),
      count,
      round: Number((ap as { round?: number } | null)?.round ?? 1),
    }),
  );
  return { ok: true };
}

export async function submitSealRequest(id: string): Promise<Result> {
  try {
    const a = await requireSealRegisterAccess();
    await loadOwnRequest(a, id);
    const res = await submitInternal(a, id, await recipientCount(id));
    if (res.ok) refresh(id);
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function withdrawSealRequest(id: string): Promise<Result> {
  try {
    const a = await requireSealRegisterAccess();
    await loadOwnRequest(a, id);
    const { error } = await supabaseAdmin.rpc("seal_withdraw_request", { p_request_id: id });
    if (error) return fail(error);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// 한 번도 올리지 않은 작성 중 신청만 지울 수 있습니다(DB 도 같은 규칙).
export async function deleteSealDraft(id: string): Promise<Result> {
  try {
    const a = await requireSealRegisterAccess();
    const r = await loadOwnRequest(a, id);
    if (r.status !== "draft") return { ok: false, message: "작성 중(올리기 전) 신청만 지울 수 있습니다." };
    const { error: e1 } = await supabaseAdmin.from("seal_recipients").delete().eq("request_id", id);
    if (e1) return fail(e1);
    const { error: e2 } = await supabaseAdmin.from("seal_requests").delete().eq("id", id);
    if (e2) return fail(e2);
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- 결재(관장·부장) ------------------------------------------------------
async function requireApprover(): Promise<SealAccess> {
  const a = await requireSealRegisterAccess();
  if (!a.isApprover) throw new Error("직인 사용 결재는 관장·부장만 할 수 있습니다.");
  return a;
}

export async function approveSealRequest(id: string): Promise<Result<{ range: string }>> {
  try {
    const a = await requireApprover();
    const r = await loadRequest(id);
    if (r.requester_driver_id === a.driverId) return { ok: false, message: "본인 신청은 결재할 수 없습니다." };
    const { data, error } = await supabaseAdmin.rpc("seal_approve_request", {
      p_request_id: id,
      p_approver_driver_id: a.driverId,
      p_approver_name: a.name,
      p_approver_rank: a.rank ?? "",
    });
    if (error) return fail(error);
    const rows = ((data ?? []) as { issue_year: number; issue_seq: number }[]).sort((x, y) => x.issue_seq - y.issue_seq);
    const range = rows.length
      ? rows.length === 1
        ? sealIssueLabel(rows[0].issue_year, rows[0].issue_seq)
        : `${sealIssueLabel(rows[0].issue_year, rows[0].issue_seq)} ~ ${sealIssueLabel(rows[rows.length - 1].issue_year, rows[rows.length - 1].issue_seq)}`
      : "";
    after(() =>
      notifySealDecided({
        requestId: id,
        requesterDriverId: r.requester_driver_id,
        requesterName: r.requester_name,
        approved: true,
        approverName: a.name,
        approverRank: a.rank,
        docLabel: r.title || sealDocTypeLabel(r.doc_type),
        count: rows.length,
        issueRange: range,
      }),
    );
    refresh(id);
    return { ok: true, range };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectSealRequest(id: string, reason: string): Promise<Result> {
  try {
    const a = await requireApprover();
    const why = clip(reason, 500);
    if (!why) return { ok: false, message: "반려 사유를 적어 주세요." };
    const r = await loadRequest(id);
    if (r.requester_driver_id === a.driverId) return { ok: false, message: "본인 신청은 결재할 수 없습니다." };
    const { error } = await supabaseAdmin.rpc("seal_reject_request", {
      p_request_id: id,
      p_approver_driver_id: a.driverId,
      p_approver_name: a.name,
      p_approver_rank: a.rank ?? "",
      p_reason: why,
    });
    if (error) return fail(error);
    const count = await recipientCount(id);
    after(() =>
      notifySealDecided({
        requestId: id,
        requesterDriverId: r.requester_driver_id,
        requesterName: r.requester_name,
        approved: false,
        approverName: a.name,
        approverRank: a.rank,
        docLabel: r.title || sealDocTypeLabel(r.doc_type),
        count,
        reason: why,
      }),
    );
    refresh(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// 발급 취소(관장·부장, 사유 필수) — 번호는 결번으로 남음
export async function cancelSealRecipient(recipientId: string, reason: string): Promise<Result> {
  try {
    const a = await requireApprover();
    if (!UUID.test(recipientId)) return { ok: false, message: "대상을 찾을 수 없습니다." };
    const why = clip(reason, 500);
    if (!why) return { ok: false, message: "취소 사유를 적어 주세요." };
    const { data: rec } = await supabaseAdmin.from("seal_recipients").select("request_id").eq("id", recipientId).maybeSingle();
    const { error } = await supabaseAdmin.rpc("seal_cancel_recipient", {
      p_recipient_id: recipientId,
      p_by_driver_id: a.driverId,
      p_by_name: a.name,
      p_reason: why,
    });
    if (error) return fail(error);
    refresh((rec as { request_id?: string } | null)?.request_id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// 연도별 시작 번호(관장만) — 그해 첫 발급 뒤에는 DB 가 거절합니다.
export async function setSealStartNo(year: number, start: number): Promise<Result> {
  try {
    const a = await requireSealRegisterAccess();
    if (!a.isBoss) return { ok: false, message: "시작 번호는 관장만 정할 수 있습니다." };
    if (!Number.isInteger(year) || year < 2000 || year > 2999) return { ok: false, message: "연도를 확인해 주세요." };
    if (!Number.isInteger(start) || start < 1 || start > 9999) return { ok: false, message: "시작 번호는 1 이상 숫자로 넣어 주세요." };
    const { error } = await supabaseAdmin.rpc("seal_set_start_no", { p_year: year, p_start: start, p_by: a.name });
    if (error) return fail(error);
    revalidatePath(`${BASE}/settings`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
