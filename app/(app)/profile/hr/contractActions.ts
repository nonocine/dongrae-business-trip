"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { sendSlack } from "@/lib/slack";
import {
  CONTRACT_LIST_COLUMNS,
  checkSignature,
  contractPdfFilename,
  toContract,
  type ContractBlock,
  type EmploymentContract,
} from "@/lib/employmentContracts";
import { getMyDriver, blocksFor, readSavedSignature } from "@/lib/employmentContractServer";

// =====================================================================
// 직원 본인 근로계약서 — /profile/hr '내 계약서'
//   ⚠️ 본인 계약서는 본인만 봅니다(관장 지시). driver_id 는 언제나 세션에서만
//     도출하고, 모든 select/update 에 .eq("driver_id", 나) 를 겁니다. 화면에서
//     숨기는 게 아니라 쿼리에서 거르므로 남의 계약서는 RSC 페이로드에도 실리지
//     않습니다. 작성 중(draft)·무효(void)는 직원에게 보이지 않습니다.
//   * 교부(취업규칙 6조②): 확정 PDF 를 내려받으면 delivered_at 을 처음 한 번 기록.
// =====================================================================

const TABLE = "employment_contracts";
const VISIBLE = ["sent", "signed"];
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type MyContract = EmploymentContract & { blocks: ContractBlock[] };

export type MyContractsData = {
  contracts: MyContract[];
  savedSignature: string | null; // 본인 저장 서명(PNG dataURL)
};

export async function listMyContracts(): Promise<MyContractsData | null> {
  const me = await getMyDriver();
  if (!me) return null;
  const [{ data, error }, savedSignature] = await Promise.all([
    supabaseAdmin
      .from(TABLE)
      .select(CONTRACT_LIST_COLUMNS)
      .eq("driver_id", me.id) // ← 서버 쿼리 단계에서 본인 것만
      .in("status", VISIBLE)
      .order("contract_start", { ascending: false }),
    readSavedSignature(me.id),
  ]);
  if (error) throw new Error(error.message);
  const contracts = await Promise.all(
    ((data ?? []) as Record<string, unknown>[]).map(async (r) => {
      const c = toContract(r, me.name);
      // 주민번호는 가린 값(full=false). 전체 번호는 PDF 에만 들어갑니다.
      return { ...c, blocks: await blocksFor(c, false) };
    })
  );
  return { contracts, savedSignature };
}

export type SignInput = {
  readConfirmed: boolean; // 끝까지 읽고 확인란 체크
  mode: "saved" | "drawn";
  dataUrl?: string | null;
  saveForLater?: boolean;
};

export async function signMyContract(id: string, input: SignInput): Promise<Result> {
  try {
    const me = await getMyDriver();
    if (!me) return { ok: false, message: "로그인이 필요합니다." };
    if (!input.readConfirmed) return { ok: false, message: "계약서 내용을 끝까지 읽고 확인란에 체크해주세요." };

    let signature: string;
    if (input.mode === "saved") {
      const saved = await readSavedSignature(me.id);
      if (!saved) return { ok: false, message: "저장된 서명이 없습니다. 직접 그려주세요." };
      signature = saved;
    } else {
      const checked = checkSignature(input.dataUrl);
      if (!checked.ok) return { ok: false, message: checked.message };
      signature = checked.dataUrl;
    }

    const now = new Date().toISOString();
    const { error, count } = await supabaseAdmin
      .from(TABLE)
      .update(
        { status: "signed", employee_signature: signature, employee_signed_at: now },
        { count: "exact" }
      )
      .eq("id", id)
      .eq("driver_id", me.id) // ← 남의 계약서는 서명할 수 없습니다
      .eq("status", "sent");
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, message: "서명할 수 있는 계약서가 아닙니다. 새로고침해주세요." };

    // 새로 그린 서명을 다음에도 쓰도록 저장(본인 프로필만).
    if (input.mode === "drawn" && input.saveForLater) {
      await supabaseAdmin
        .from("employee_profiles")
        .update({ signature_data: signature, signature_updated_at: now })
        .eq("driver_id", me.id);
    }

    // 관리자 채널 알림 — 부가기능(실패해도 서명은 그대로).
    try {
      await sendSlack("SLACK_WEBHOOK_ADMIN", `✍️ ${me.name} 님이 근로계약서에 서명했습니다. 센터장 서명 대기 (/hr/contracts)`);
    } catch {
      /* 격리 */
    }
    revalidatePath("/profile/hr");
    revalidatePath("/hr/contracts");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "서명 처리 중 오류가 발생했습니다." };
  }
}

export async function downloadMyContractPdf(id: string): Promise<Result<{ base64: string; filename: string }>> {
  try {
    const me = await getMyDriver();
    if (!me) return { ok: false, message: "로그인이 필요합니다." };
    const { data: row, error } = await supabaseAdmin
      .from(TABLE)
      .select("id, contract_start, contract_pdf_url, delivered_at")
      .eq("id", id)
      .eq("driver_id", me.id) // ← 본인 것만
      .eq("status", "signed")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const r = row as { contract_start: string; contract_pdf_url: string | null; delivered_at: string | null } | null;
    if (!r || !r.contract_pdf_url) return { ok: false, message: "내려받을 수 있는 계약서가 없습니다. (체결 전이면 센터장 서명 대기 중입니다)" };
    const { data, error: dlErr } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(r.contract_pdf_url);
    if (dlErr || !data) throw new Error("계약서 PDF 를 읽지 못했습니다.");
    const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
    // 교부 기록 — 처음 내려받은 시각만 남깁니다.
    if (!r.delivered_at) {
      await supabaseAdmin
        .from(TABLE)
        .update({ delivered_at: new Date().toISOString() })
        .eq("id", id)
        .eq("driver_id", me.id)
        .is("delivered_at", null);
      revalidatePath("/hr/contracts");
    }
    return { ok: true, base64, filename: contractPdfFilename(me.name, r.contract_start) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "다운로드 중 오류가 발생했습니다." };
  }
}
