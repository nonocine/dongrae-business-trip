"use server";

import { revalidatePath } from "next/cache";
import { isContractKind, type ContractKind, type MyContract } from "@/lib/contractCore";
import {
  getMyDriver,
  listMineCore,
  signMineCore,
  downloadMineCore,
  readSavedSignature,
  fail,
  type Result,
  type SignInput,
} from "@/lib/contractServer";

// =====================================================================
// 직원 본인 계약서 — /profile/hr '내 계약서' (근로계약서·연봉계약서 공용)
//   ⚠️ 본인 계약서는 본인만 봅니다(관장 지시). driver_id 는 언제나 세션에서만
//     도출하고, lib/contractServer 의 모든 조회·서명·다운로드가
//     .eq("driver_id", 나) 를 쿼리에 겁니다. 작성 중·무효는 보이지 않습니다.
//   * 교부(취업규칙 6조②): 확정 PDF 를 내려받으면 delivered_at 을 처음 한 번 기록.
// =====================================================================


export type MyContractsData = {
  contracts: MyContract[];
  savedSignature: string | null; // 본인 저장 서명(PNG dataURL)
};

export async function listMyContracts(): Promise<MyContractsData | null> {
  const me = await getMyDriver();
  if (!me) return null;
  const [employment, salary, savedSignature] = await Promise.all([
    listMineCore("employment", me),
    listMineCore("salary", me),
    readSavedSignature(me.id),
  ]);
  return { contracts: [...employment, ...salary], savedSignature };
}

export async function signMyContract(kind: ContractKind, id: string, input: SignInput): Promise<Result> {
  try {
    const me = await getMyDriver();
    if (!me) return { ok: false, message: "로그인이 필요합니다." };
    if (!isContractKind(kind)) return { ok: false, message: "알 수 없는 계약서 종류입니다." };
    const res = await signMineCore(kind, id, input, me);
    if (res.ok) {
      revalidatePath("/profile/hr");
      revalidatePath("/hr/contracts");
    }
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function downloadMyContractPdf(
  kind: ContractKind,
  id: string
): Promise<Result<{ base64: string; filename: string }>> {
  try {
    const me = await getMyDriver();
    if (!me) return { ok: false, message: "로그인이 필요합니다." };
    if (!isContractKind(kind)) return { ok: false, message: "알 수 없는 계약서 종류입니다." };
    const res = await downloadMineCore(kind, id, me);
    if (res.ok) revalidatePath("/hr/contracts");
    return res;
  } catch (e) {
    return fail(e);
  }
}
