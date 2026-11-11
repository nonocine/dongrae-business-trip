"use server";

// =====================================================================
// 연차 사용촉진(개편) — 1차 촉구서·2차 지정 통보서 작성, 완료 처리, 보조 안내 기록, ERP 문서 찾기.
//   * 접근: 관장(M0)·hr 직무·인사 파일 열람 보유자(lib/leavePromotionServer). 매 액션 첫 줄에서 확인.
//   * 완료 = 종이 서명 수령본 업로드(paper) 또는 ERP 전자결재 문서 연결(erp)만.
//     앱·이메일은 memo 에 '보조 안내'로만 남고 완료가 되지 않습니다(고용노동부 근로기준정책과-3801).
//   * 서식 PDF 는 hr-documents 버킷 leave-promotion/{연도}/{인사카드id}/ 에 둡니다.
//   * 기존 leave_plan_requests(사용계획서) 데이터·화면은 건드리지 않습니다(연결 id 만 기록).
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { currentAssignment } from "@/lib/appointments";
import { erpLastSyncedAt, leaveBalancesOf } from "@/lib/erp/view";
import { kstTodayYmd } from "@/lib/erp/duty";
import {
  PROMO_TABLE,
  loadPromotionBoard,
  requireLeavePromotionAccess,
  type PromotionBoard,
} from "@/lib/leavePromotionServer";
import {
  isYmd,
  noticeCompleted,
  scheduleFor,
  stage1Body,
  stage2Body,
  tracksFor,
  type DeliveryMethod,
  type PromotionStage,
  type PromotionTrack,
} from "@/lib/leavePromotion";
import { buildPromotionNoticePdf } from "@/lib/leavePromotionPdf";
import { getFirstYearPolicy, writeFirstYearPolicy, type FirstYearPolicy } from "@/lib/leaveSettings";

type Fail = { ok: false; message: string };
const fail = (e: unknown, fb: string): Fail => ({ ok: false, message: e instanceof Error ? e.message : fb });
const DIR = "leave-promotion";
const SIGNED_URL_SECONDS = 300;

export async function getPromotionBoard(year: number): Promise<PromotionBoard> {
  await requireLeavePromotionAccess();
  const y = Number.isFinite(year) && year > 2000 ? Math.round(year) : Number(kstTodayYmd().slice(0, 4));
  return loadPromotionBoard(y);
}

const syncedLabel = (iso: string | null) =>
  iso
    ? `ERP 기준 ${new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "ERP 기준";

// [1차 촉구서 만들기] / [2차 지정 통보서 만들기] — 미사용 일수·기한을 박제하고 PDF 를 만듭니다.
//   완료된 통보서는 다시 만들지 않습니다(박제 보존). 미완료면 다시 만들어 덮어씁니다.
export async function createPromotionNotice(input: {
  year: number;
  profileId: string;
  track: PromotionTrack;
  stage: PromotionStage;
  designatedDates?: string[];
  unusedDays?: number | null; // 직접 입력(ERP 잔여가 없을 때) — 없으면 ERP 연차 잔여
}): Promise<{ ok: true; id: string } | Fail> {
  try {
    const access = await requireLeavePromotionAccess();
    const year = Math.round(input.year);
    const stage: PromotionStage = input.stage === 2 ? 2 : 1;
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, driver_id, join_date, appointments, erp_employee_id")
      .eq("id", input.profileId)
      .maybeSingle();
    if (!prof) return { ok: false, message: "직원 인사기록카드를 찾을 수 없습니다." };
    const p = prof as Record<string, unknown>;
    const joinDate = typeof p.join_date === "string" && p.join_date ? p.join_date.slice(0, 10) : null;
    if (!tracksFor(year, joinDate).includes(input.track))
      return { ok: false, message: "이 직원에게 해당하지 않는 구분입니다(입사일 확인)." };
    if (input.track === "first_year" && (await getFirstYearPolicy()) === "payout")
      return { ok: false, message: "첫해 월차를 12월 수당으로 정산하는 방식이라 1년 미만 사용촉진 대상이 아닙니다." };
    const schedule = scheduleFor(input.track, year, joinDate);

    const { data: drv } = await supabaseAdmin.from("drivers").select("name").eq("id", String(p.driver_id)).maybeSingle();
    const name = String((drv as { name?: string } | null)?.name ?? "");
    const today = kstTodayYmd();
    const department = currentAssignment(p.appointments, today).current?.department ?? null;

    const { data: existing } = await supabaseAdmin
      .from(PROMO_TABLE)
      .select("id, delivery_method, signed_receipt_path, erp_document_id")
      .eq("year", year)
      .eq("employee_id", input.profileId)
      .eq("track", input.track)
      .eq("stage", stage)
      .maybeSingle();
    if (existing && noticeCompleted(existing as never))
      return { ok: false, message: "완료 처리된 통보서는 다시 만들지 않습니다(발송 당시 내용 보존)." };

    // 미사용 일수 — ERP 연차 잔여(기본) 또는 직접 입력.
    const erpId = typeof p.erp_employee_id === "string" ? p.erp_employee_id : null;
    const erpRemaining = erpId ? (await leaveBalancesOf([erpId])).get(erpId)?.annual ?? null : null;
    const manual = input.unusedDays != null && Number.isFinite(Number(input.unusedDays)) ? Number(input.unusedDays) : null;
    const unused = manual ?? erpRemaining;
    if (unused == null) return { ok: false, message: "ERP 연차 잔여가 없습니다. 미사용 일수를 직접 입력하세요." };
    if (unused <= 0) return { ok: false, message: "미사용 연차가 없어 촉진 대상이 아닙니다." };
    const basis = manual != null ? "담당자 입력" : syncedLabel(await erpLastSyncedAt("leaveBalances"));

    let designated: string[] = [];
    if (stage === 2) {
      designated = [...new Set((input.designatedDates ?? []).filter(isYmd))].sort();
      if (!designated.length) return { ok: false, message: "지정할 사용일을 하나 이상 고르세요." };
      if (designated.some((d) => d > schedule.periodEnd))
        return { ok: false, message: `지정일은 사용기한(${schedule.periodEnd}) 안이어야 합니다.` };
    }

    const body =
      stage === 1
        ? stage1Body({ name, department, year, track: input.track, unusedDays: unused, unusedBasis: basis, periodEnd: schedule.periodEnd, issueDate: today })
        : stage2Body({
            name,
            department,
            year,
            track: input.track,
            unusedDays: unused,
            unusedBasis: basis,
            periodEnd: schedule.periodEnd,
            designatedDates: designated,
            issueDate: today,
          });
    const title = stage === 1 ? "연차유급휴가 사용 촉구서" : "연차유급휴가 사용시기 지정 통보서";
    const bytes = await buildPromotionNoticePdf({ title, body });
    const path = `${DIR}/${year}/${input.profileId}/${input.track}-${stage}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`PDF 저장 실패: ${upErr.message}`);

    // 사용계획서(기존 표, employee_id = drivers.id) 연결.
    const { data: plan } = await supabaseAdmin
      .from("leave_plan_requests")
      .select("id")
      .eq("year", year)
      .eq("employee_id", String(p.driver_id))
      .maybeSingle();

    const row = {
      year,
      employee_id: input.profileId,
      track: input.track,
      stage,
      period_end: schedule.periodEnd,
      legal_window_start: stage === 1 ? schedule.stage1.start : schedule.stage1.end,
      legal_window_end: stage === 1 ? schedule.stage1.end : schedule.stage2Due,
      unused_days: unused,
      unused_source: manual != null ? "manual" : "erp",
      designated_dates: stage === 2 ? designated : null,
      body_snapshot: body,
      pdf_path: path,
      leave_plan_request_id: (plan as { id?: string } | null)?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabaseAdmin
      .from(PROMO_TABLE)
      .upsert(row, { onConflict: "year,employee_id,track,stage" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    void access;
    revalidatePath("/hr/leave-plans");
    return { ok: true, id: String((saved as { id: string }).id) };
  } catch (e) {
    return fail(e, "통보서를 만들지 못했습니다.");
  }
}

const RECEIPT_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 완료 처리 — paper: 서명 수령본 스캔 필수 / erp: ERP 전자결재 문서 연결 필수.
export async function completePromotionNotice(formData: FormData): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireLeavePromotionAccess();
    const id = String(formData.get("id") ?? "");
    const method = String(formData.get("method") ?? "") as DeliveryMethod;
    const sentDate = String(formData.get("sent_date") ?? "") || kstTodayYmd();
    if (!isYmd(sentDate)) return { ok: false, message: "발송(수령)일이 올바르지 않습니다." };
    if (method !== "paper" && method !== "erp")
      return { ok: false, message: "완료 처리는 종이 서명 수령 또는 ERP 전자결재로만 할 수 있습니다." };
    const { data: cur } = await supabaseAdmin.from(PROMO_TABLE).select("*").eq("id", id).maybeSingle();
    if (!cur) return { ok: false, message: "통보서를 찾을 수 없습니다." };
    const c = cur as Record<string, unknown>;
    if (noticeCompleted(c as never)) return { ok: false, message: "이미 완료 처리된 통보서입니다." };

    const patch: Record<string, unknown> = {
      delivery_method: method,
      sent_at: `${sentDate}T09:00:00+09:00`,
      sent_by: access.name,
      updated_at: new Date().toISOString(),
    };
    if (method === "paper") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { ok: false, message: "서명 수령본 스캔 파일을 올리세요." };
      if (file.size > 16 * 1024 * 1024) return { ok: false, message: "파일 용량은 16MB 이하여야 합니다." };
      const ext = RECEIPT_EXT[file.type];
      if (!ext) return { ok: false, message: "PDF·JPG·PNG·WEBP 만 올릴 수 있습니다." };
      const path = `${DIR}/${c.year}/${c.employee_id}/${c.track}-${c.stage}_receipt.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(HR_DOCUMENTS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);
      patch.signed_receipt_path = path;
      patch.acknowledged_at = `${sentDate}T09:00:00+09:00`; // 서명 수령 = 도달 확인
    } else {
      const docId = String(formData.get("erp_document_id") ?? "").trim();
      if (!docId) return { ok: false, message: "연결할 ERP 문서를 고르세요." };
      const { data: doc } = await supabaseAdmin
        .from("erp_documents")
        .select("document_id, document_number")
        .eq("document_id", docId)
        .is("removed_at", null)
        .maybeSingle();
      if (!doc) return { ok: false, message: "ERP 문서를 찾을 수 없습니다(동기화 확인)." };
      const d = doc as { document_id: number; document_number: number | null };
      patch.erp_document_id = d.document_id;
      patch.erp_document_number = d.document_number;
    }
    const { error } = await supabaseAdmin.from(PROMO_TABLE).update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/leave-plans");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e, "완료 처리하지 못했습니다.");
  }
}

// 앱·이메일 안내 — 보조 기록(memo)만. 완료가 되지 않습니다.
export async function recordAuxDelivery(id: string, method: "app" | "email", note: string): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireLeavePromotionAccess();
    if (method !== "app" && method !== "email") return { ok: false, message: "앱 또는 이메일만 보조 안내로 기록합니다." };
    const { data: cur } = await supabaseAdmin.from(PROMO_TABLE).select("memo").eq("id", id).maybeSingle();
    if (!cur) return { ok: false, message: "통보서를 찾을 수 없습니다." };
    const line = `[보조 안내] ${method === "app" ? "앱" : "이메일"} ${kstTodayYmd()} ${access.name}${note.trim() ? ` — ${note.trim().slice(0, 200)}` : ""}`;
    const prev = ((cur as { memo?: string | null }).memo ?? "").trim();
    const { error } = await supabaseAdmin
      .from(PROMO_TABLE)
      .update({ memo: prev ? `${prev}\n${line}` : line, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/leave-plans");
    return { ok: true };
  } catch (e) {
    return fail(e, "기록하지 못했습니다.");
  }
}

// ERP 문서 찾기 — 문서번호(숫자) 또는 제목 일부. 완료 처리(erp) 연결용.
export async function searchErpDocuments(q: string): Promise<
  { id: number; number: number | null; title: string; registeredAt: string | null; status: string | null }[]
> {
  await requireLeavePromotionAccess();
  const term = (q ?? "").trim();
  if (!term) return [];
  let query = supabaseAdmin
    .from("erp_documents")
    .select("document_id, document_number, title, registered_at, status")
    .is("removed_at", null)
    .order("registered_at", { ascending: false })
    .limit(20);
  query = /^\d+$/.test(term) ? query.eq("document_number", Number(term)) : query.ilike("title", `%${term.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  return ((data ?? []) as { document_id: number; document_number: number | null; title: string | null; registered_at: string | null; status: string | null }[]).map(
    (d) => ({ id: d.document_id, number: d.document_number, title: d.title ?? "", registeredAt: d.registered_at, status: d.status })
  );
}

// 첫해 월차 처리 방식 변경 — 관장(M0)만.
export async function setFirstYearPolicy(policy: FirstYearPolicy): Promise<{ ok: true } | Fail> {
  try {
    const access = await requireLeavePromotionAccess();
    if (!access.isM0) return { ok: false, message: "첫해 월차 처리 방식은 관장·부장만 바꿀 수 있습니다." };
    if (policy !== "payout" && policy !== "carryover") return { ok: false, message: "알 수 없는 방식입니다." };
    await writeFirstYearPolicy(policy);
    revalidatePath("/hr/leave-plans");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e, "저장하지 못했습니다.");
  }
}

// 통보서 PDF·서명 수령본 열기 — 5분 서명 URL.
export async function openPromotionFile(id: string, kind: "pdf" | "receipt"): Promise<{ ok: true; url: string } | Fail> {
  try {
    await requireLeavePromotionAccess();
    const { data: cur } = await supabaseAdmin.from(PROMO_TABLE).select("pdf_path, signed_receipt_path").eq("id", id).maybeSingle();
    const c = (cur ?? {}) as { pdf_path?: string | null; signed_receipt_path?: string | null };
    const path = kind === "pdf" ? c.pdf_path : c.signed_receipt_path;
    if (!path) return { ok: false, message: "저장된 파일이 없습니다." };
    const { data, error } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) return { ok: false, message: "파일 주소를 만들지 못했습니다." };
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return fail(e, "파일을 열지 못했습니다.");
  }
}
