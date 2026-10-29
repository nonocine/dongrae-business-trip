// =====================================================================
// 직인사용대장 — 서버 전용 권한·조회(service_role). 서버 액션·PDF 라우트·페이지가 씁니다.
//   * seal_* · approvals 표는 RLS on(정책 0개) → 브라우저 키로는 못 읽음. 여기서만 읽습니다.
//   * 권한은 로그인한 사람의 drivers.rank 로만 판단(화면에서 넘긴 값은 믿지 않음 — 관장 결정):
//       결재(승인·반려)·전체 대장·발급 취소 = 관장·부장 / 시작 번호 = 관장 / 나머지 = 본인 신청분만.
//     DB 함수(seal_check_approver)도 결재자 직급을 한 번 더 확인합니다.
//   * 상태 변경은 DB 함수로만(seal_submit_request 등). 표의 status 를 직접 바꾸지 않습니다.
//   * 서버 전용 모듈("use server" 아님).
// =====================================================================

import { getSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  normalizeDocType,
  normalizeItemDefs,
  normalizeItemValues,
  sealIssueLabel,
  type SealApprovalView,
  type SealLedgerRow,
  type SealPrintLogView,
  type SealRecipientView,
  type SealRequestDetail,
  type SealRequestSummary,
  type SealStatus,
} from "@/lib/sealRegister";

export const SEAL_APPROVER_RANKS = ["관장", "부장"] as const;

export type SealAccess = {
  name: string;
  driverId: string;
  rank: string | null;
  isApprover: boolean; // 관장·부장
  isBoss: boolean; // 관장
};

export async function resolveSealRegisterAccess(): Promise<SealAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const { data } = await supabaseAdmin.from("drivers").select("id, rank").eq("name", me.name.trim()).maybeSingle();
  const row = data as { id?: unknown; rank?: string | null } | null;
  if (!row || typeof row.id !== "string") return null;
  const rank = row.rank?.trim() || null;
  return {
    name: me.name.trim(),
    driverId: row.id,
    rank,
    isApprover: !!rank && (SEAL_APPROVER_RANKS as readonly string[]).includes(rank),
    isBoss: rank === "관장",
  };
}

export async function requireSealRegisterAccess(): Promise<SealAccess> {
  const a = await resolveSealRegisterAccess();
  if (!a) throw new Error("직인사용대장은 로그인한 직원만 쓸 수 있습니다.");
  return a;
}

// 신청 한 건을 볼 수 있는가 — 본인 신청 또는 관장·부장.
export function canViewRequest(a: SealAccess, requesterDriverId: string | null): boolean {
  return a.isApprover || (!!requesterDriverId && requesterDriverId === a.driverId);
}

// --- 변환 ---------------------------------------------------------------
type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));

function statusOf(v: unknown): SealStatus {
  return v === "pending" || v === "rejected" || v === "withdrawn" || v === "issued" ? v : "draft";
}

function issueRange(recs: { issue_year: unknown; issue_seq: unknown }[]): string | null {
  const nums = recs
    .filter((r) => r.issue_seq != null)
    .map((r) => ({ y: Number(r.issue_year), s: Number(r.issue_seq) }))
    .sort((a, b) => a.y - b.y || a.s - b.s);
  if (!nums.length) return null;
  const first = sealIssueLabel(nums[0].y, nums[0].s);
  const last = nums[nums.length - 1];
  return nums.length === 1 ? first : `${first} ~ ${sealIssueLabel(last.y, last.s)}`;
}

const REQ_COLS =
  "id, requester_driver_id, requester_name, doc_type, title, cert_date, purpose, item_template, body_template, status, created_at, updated_at";

async function summarize(rows: Raw[]): Promise<SealRequestSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => str(r.id));
  const { data, error } = await supabaseAdmin
    .from("seal_recipients")
    .select("request_id, line_no, recipient_name, issue_year, issue_seq")
    .in("request_id", ids)
    .order("line_no");
  if (error) throw new Error(error.message);
  const byReq = new Map<string, Raw[]>();
  for (const r of (data ?? []) as Raw[]) {
    const k = str(r.request_id);
    byReq.set(k, [...(byReq.get(k) ?? []), r]);
  }
  return rows.map((r) => {
    const recs = byReq.get(str(r.id)) ?? [];
    return {
      id: str(r.id),
      docType: normalizeDocType(r.doc_type) ?? "custom",
      title: str(r.title),
      certDate: str(r.cert_date).slice(0, 10),
      status: statusOf(r.status),
      requesterName: str(r.requester_name),
      requesterDriverId: strOrNull(r.requester_driver_id),
      recipientCount: recs.length,
      firstName: recs.length ? str(recs[0].recipient_name) : null,
      issueRange: issueRange(recs as { issue_year: unknown; issue_seq: unknown }[]),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    };
  });
}

// --- 목록 ---------------------------------------------------------------
export async function listMySealRequests(a: SealAccess): Promise<SealRequestSummary[]> {
  const { data, error } = await supabaseAdmin
    .from("seal_requests")
    .select(REQ_COLS)
    .eq("requester_driver_id", a.driverId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return summarize((data ?? []) as Raw[]);
}

// 결재함 — 관장·부장. 본인 신청은 결재할 수 없어 뺍니다.
export async function listPendingSealRequests(a: SealAccess): Promise<SealRequestSummary[]> {
  if (!a.isApprover) return [];
  const { data, error } = await supabaseAdmin
    .from("seal_requests")
    .select(REQ_COLS)
    .eq("status", "pending")
    .order("updated_at", { ascending: true });
  if (error) throw new Error(error.message);
  return summarize(((data ?? []) as Raw[]).filter((r) => str(r.requester_driver_id) !== a.driverId));
}

export async function countPendingSealRequests(a: SealAccess | null): Promise<number> {
  if (!a?.isApprover) return 0;
  const { data, error } = await supabaseAdmin.from("seal_requests").select("id, requester_driver_id").eq("status", "pending");
  if (error) return 0;
  return ((data ?? []) as Raw[]).filter((r) => str(r.requester_driver_id) !== a.driverId).length;
}

// 전체 대장 — 관장·부장. 발급된 줄만, 발급번호순(취소 = 결번 표시).
export async function listSealLedger(
  a: SealAccess,
  filter: { year: number; docType: string | null },
): Promise<SealLedgerRow[]> {
  if (!a.isApprover) return [];
  let q = supabaseAdmin
    .from("seal_recipients")
    .select(
      "id, request_id, recipient_name, issue_year, issue_seq, issued_at, snapshot, canceled_at, canceled_by_name, cancel_reason, seal_requests!inner(doc_type, title, cert_date, requester_name)",
    )
    .eq("issue_year", filter.year)
    .not("issue_seq", "is", null)
    .order("issue_seq", { ascending: true });
  if (filter.docType) q = q.eq("seal_requests.doc_type", filter.docType);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Raw[]).map((r) => {
    const req = (Array.isArray(r.seal_requests) ? r.seal_requests[0] : r.seal_requests) as Raw | null;
    const snap = (r.snapshot ?? {}) as Raw;
    const year = Number(r.issue_year);
    const seq = Number(r.issue_seq);
    return {
      recipientId: str(r.id),
      requestId: str(r.request_id),
      issueYear: year,
      issueSeq: seq,
      issueLabel: str(snap.issueLabel) || sealIssueLabel(year, seq),
      docType: normalizeDocType(req?.doc_type) ?? "custom",
      title: str(snap.title) || str(req?.title),
      name: str(r.recipient_name),
      certDate: str(snap.certDate || req?.cert_date).slice(0, 10),
      requesterName: str(req?.requester_name),
      approverName: strOrNull(snap.approvedBy),
      issuedAt: str(r.issued_at),
      canceledAt: strOrNull(r.canceled_at),
      cancelReason: strOrNull(r.cancel_reason),
      canceledBy: strOrNull(r.canceled_by_name),
    };
  });
}

// 대장 연도 고르기 — 번호 줄이 있는 해 + 올해
export async function listSealYears(currentYear: number): Promise<number[]> {
  const { data } = await supabaseAdmin.from("seal_number_counters").select("year");
  const ys = new Set<number>([currentYear, ...((data ?? []) as Raw[]).map((r) => Number(r.year)).filter(Number.isInteger)]);
  return [...ys].sort((a, b) => b - a);
}

// --- 상세 ---------------------------------------------------------------
// 볼 권한이 없거나 없는 신청이면 null(화면은 notFound — 있는지조차 알리지 않음).
export async function getSealRequestDetail(a: SealAccess, id: string): Promise<SealRequestDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: req, error } = await supabaseAdmin.from("seal_requests").select(REQ_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) return null;
  const r = req as Raw;
  if (!canViewRequest(a, strOrNull(r.requester_driver_id))) return null;

  const [recsRes, apprRes, printRes] = await Promise.all([
    supabaseAdmin
      .from("seal_recipients")
      .select("id, line_no, recipient_name, items, body, issue_year, issue_seq, issued_at, snapshot, canceled_at, canceled_by_name, cancel_reason")
      .eq("request_id", id)
      .order("line_no"),
    supabaseAdmin
      .from("approvals")
      .select("round, status, requested_at, approver_name, approver_rank, decided_at, reject_reason")
      .eq("doc_kind", "seal_use")
      .eq("target_id", id)
      .order("round"),
    supabaseAdmin
      .from("seal_print_logs")
      .select("recipient_ids, is_reprint, printed_by_name, printed_at")
      .eq("request_id", id)
      .order("printed_at", { ascending: false }),
  ]);
  if (recsRes.error) throw new Error(recsRes.error.message);
  if (apprRes.error) throw new Error(apprRes.error.message);
  if (printRes.error) throw new Error(printRes.error.message);

  const prints = (printRes.data ?? []) as Raw[];
  const printedIds = new Set(prints.flatMap((p) => (Array.isArray(p.recipient_ids) ? p.recipient_ids.map(String) : [])));

  const recipients: SealRecipientView[] = ((recsRes.data ?? []) as Raw[]).map((x) => {
    const year = numOrNull(x.issue_year);
    const seq = numOrNull(x.issue_seq);
    const snap = (x.snapshot ?? null) as Raw | null;
    return {
      id: str(x.id),
      lineNo: Number(x.line_no),
      name: str(x.recipient_name),
      items: normalizeItemValues(x.items),
      body: str(x.body),
      issueYear: year,
      issueSeq: seq,
      issueLabel: year != null && seq != null ? str(snap?.issueLabel) || sealIssueLabel(year, seq) : null,
      issuedAt: strOrNull(x.issued_at),
      canceledAt: strOrNull(x.canceled_at),
      canceledBy: strOrNull(x.canceled_by_name),
      cancelReason: strOrNull(x.cancel_reason),
      printed: printedIds.has(str(x.id)),
    };
  });

  const approvals: SealApprovalView[] = ((apprRes.data ?? []) as Raw[]).map((p) => ({
    round: Number(p.round),
    status: (["pending", "approved", "rejected", "withdrawn"].includes(str(p.status)) ? str(p.status) : "pending") as SealApprovalView["status"],
    requestedAt: str(p.requested_at),
    approverName: strOrNull(p.approver_name),
    approverRank: strOrNull(p.approver_rank),
    decidedAt: strOrNull(p.decided_at),
    rejectReason: strOrNull(p.reject_reason),
  }));

  const printLogs: SealPrintLogView[] = prints.map((p) => ({
    printedAt: str(p.printed_at),
    printedBy: str(p.printed_by_name),
    count: Array.isArray(p.recipient_ids) ? p.recipient_ids.length : 0,
    isReprint: p.is_reprint === true,
  }));

  const [summary] = await summarize([r]);
  const lastRejected = [...approvals].reverse().find((p) => p.status === "rejected");
  return {
    ...summary,
    purpose: strOrNull(r.purpose),
    itemTemplate: normalizeItemDefs(r.item_template),
    bodyTemplate: str(r.body_template),
    recipients,
    approvals,
    prints: printLogs,
    lastRejectReason: summary.status === "rejected" ? (lastRejected?.rejectReason ?? null) : null,
  };
}

// --- 연도 번호 ----------------------------------------------------------
export type SealCounterInfo = {
  year: number;
  nextSeq: number;
  startSeq: number | null;
  startSetBy: string | null;
  startSetAt: string | null;
  issuedCount: number; // 그해 발급(취소 포함) — 1 이상이면 시작 번호 잠김
};

export async function getSealCounter(year: number): Promise<SealCounterInfo> {
  const [{ data: c, error: e1 }, { count, error: e2 }] = await Promise.all([
    supabaseAdmin.from("seal_number_counters").select("year, next_seq, start_seq, start_set_by, start_set_at").eq("year", year).maybeSingle(),
    supabaseAdmin.from("seal_recipients").select("id", { count: "exact", head: true }).eq("issue_year", year),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const row = c as Raw | null;
  return {
    year,
    nextSeq: row ? Number(row.next_seq) : 1,
    startSeq: row ? numOrNull(row.start_seq) : null,
    startSetBy: row ? strOrNull(row.start_set_by) : null,
    startSetAt: row ? strOrNull(row.start_set_at) : null,
    issuedCount: count ?? 0,
  };
}
