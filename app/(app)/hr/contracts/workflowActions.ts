"use server";

import { revalidatePath } from "next/cache";
import { isContractKind, CONTRACT_KINDS, type ContractBlock, type ContractKind } from "@/lib/contractCore";
import {
  requireContractPersonnel,
  adminBlocks,
  sendContractCore,
  recallContractCore,
  voidContractCore,
  deleteDraftCore,
  employerSignCore,
  adminPdfCore,
  bulkPreviewPdfCore,
  bytesToDataUrl,
  readSavedSignature,
  setContractDateCore,
  listContractDateChangesCore,
  fail,
  type ContractDateChange,
  type EmployerSignInput,
  type Result,
} from "@/lib/contractServer";
import { loadOrgSeal } from "@/lib/orgSeal";

// =====================================================================
// 계약서 공용 관리자 액션 — 근로계약서·연봉계약서가 함께 씁니다(kind 로 구분).
//   보내기 · 발송취소 · 무효(M0) · 작성 중 삭제 · 센터장 서명(M0)→PDF 확정 ·
//   내용/PDF 미리보기 · 일괄 발송 · 일괄 미리보기.
//   모든 액션 진입 시 requireContractPersonnel(인사 파일 열람 보유자) — RLS 정책 0 이라 방어선.
// =====================================================================

function kindOf(kind: unknown): ContractKind {
  if (!isContractKind(kind)) throw new Error("알 수 없는 계약서 종류입니다.");
  return kind;
}

function refresh() {
  revalidatePath("/hr/contracts");
  revalidatePath("/hr"); // 체결·계약일 변경 → 인사기록카드 자동 첨부
  revalidatePath("/profile/hr");
}

export async function getContractBlocks(kind: ContractKind, id: string): Promise<Result<{ blocks: ContractBlock[] }>> {
  try {
    await requireContractPersonnel();
    return { ok: true, blocks: await adminBlocks(kindOf(kind), id) };
  } catch (e) {
    return fail(e);
  }
}

export async function sendContract(kind: ContractKind, id: string): Promise<Result<{ dmFailed: string | null }>> {
  try {
    await requireContractPersonnel();
    const res = await sendContractCore(kindOf(kind), id);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

// 여러 건 한 번에 보내기(연말 연봉계약서 13명 등). 한 건이 실패해도 나머지는 계속.
export async function bulkSendContracts(
  kind: ContractKind,
  ids: string[]
): Promise<Result<{ sent: number; failed: { id: string; message: string }[]; dmFailed: number }>> {
  try {
    await requireContractPersonnel();
    const k = kindOf(kind);
    let sent = 0;
    let dmFailed = 0;
    const failed: { id: string; message: string }[] = [];
    for (const id of ids.slice(0, 100)) {
      try {
        const res = await sendContractCore(k, id);
        if (res.ok) {
          sent++;
          if (res.dmFailed) dmFailed++;
        } else failed.push({ id, message: res.message });
      } catch (e) {
        failed.push({ id, message: e instanceof Error ? e.message : "실패" });
      }
    }
    refresh();
    return { ok: true, sent, failed, dmFailed };
  } catch (e) {
    return fail(e);
  }
}

export async function recallContract(kind: ContractKind, id: string): Promise<Result> {
  try {
    await requireContractPersonnel();
    const res = await recallContractCore(kindOf(kind), id);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

// 계약일 수정 — 인사 파일 열람 보유자만(requireContractPersonnel). 사유 필수, 체결 후에도 가능.
//   서명 시각(보냄·직원 서명·센터장 서명)은 바꾸지 않습니다. 미래·시작일+30일 초과는 화면이 확인만 받습니다.
export async function setContractDate(
  kind: ContractKind,
  id: string,
  date: string,
  reason: string
): Promise<Result<{ pdf: "regenerated" | "kept" | "none"; cardFile: boolean; note: string | null }>> {
  try {
    const me = await requireContractPersonnel();
    const res = await setContractDateCore(kindOf(kind), id, { date, reason }, me);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function getContractDateChanges(
  kind: ContractKind,
  id: string
): Promise<Result<{ changes: ContractDateChange[] }>> {
  try {
    await requireContractPersonnel();
    return { ok: true, changes: await listContractDateChangesCore(kindOf(kind), id) };
  } catch (e) {
    return fail(e);
  }
}

export async function voidContract(kind: ContractKind, id: string): Promise<Result> {
  try {
    const me = await requireContractPersonnel();
    if (!me.isM0) return { ok: false, message: "무효 처리는 관장·부장만 할 수 있습니다." };
    const res = await voidContractCore(kindOf(kind), id);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDraftContract(kind: ContractKind, id: string): Promise<Result> {
  try {
    await requireContractPersonnel();
    const res = await deleteDraftCore(kindOf(kind), id);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function getEmployerSignOptions(): Promise<
  Result<{ seal: string | null; mySignature: string | null; canSign: boolean }>
> {
  try {
    const me = await requireContractPersonnel();
    const [seal, mySignature] = await Promise.all([
      loadOrgSeal(),
      me.driverId ? readSavedSignature(me.driverId) : Promise.resolve(null),
    ]);
    return { ok: true, seal: bytesToDataUrl(seal), mySignature, canSign: me.isM0 };
  } catch (e) {
    return fail(e);
  }
}

export async function employerSignContract(
  kind: ContractKind,
  id: string,
  input: EmployerSignInput
): Promise<Result<{ dmFailed: string | null }>> {
  try {
    const me = await requireContractPersonnel();
    if (!me.isM0) return { ok: false, message: "센터장 서명은 관장·부장만 할 수 있습니다." };
    const res = await employerSignCore(kindOf(kind), id, input, me);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function downloadContractPdf(
  kind: ContractKind,
  id: string
): Promise<Result<{ base64: string; filename: string; preview: boolean }>> {
  try {
    await requireContractPersonnel();
    return await adminPdfCore(kindOf(kind), id);
  } catch (e) {
    return fail(e);
  }
}

// 선택한 여러 건을 한 PDF 로 미리보기(서명 전 내용 확인용).
export async function bulkPreviewPdf(
  kind: ContractKind,
  ids: string[]
): Promise<Result<{ base64: string; filename: string }>> {
  try {
    await requireContractPersonnel();
    const k = kindOf(kind);
    if (ids.length === 0) return { ok: false, message: "선택한 계약서가 없습니다." };
    const bytes = await bulkPreviewPdfCore(k, ids.slice(0, 60));
    return {
      ok: true,
      base64: Buffer.from(bytes).toString("base64"),
      filename: `${CONTRACT_KINDS[k].label}_일괄미리보기_${ids.length}건.pdf`,
    };
  } catch (e) {
    return fail(e);
  }
}
