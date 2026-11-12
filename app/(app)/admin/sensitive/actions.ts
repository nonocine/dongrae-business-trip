"use server";

// =====================================================================
// /admin/sensitive — 민감정보 암호화 채우기(일회성) + 열람 기록. M0 전용.
//   * 암호화 채우기: 평문만 있고 암호문이 없는 행만 채웁니다(이미 있으면 건너뜀).
//     평문 칸은 건드리지 않습니다 — 비우기는 검증 뒤 SQL 로 따로 합니다.
//   * 결과는 건수만 돌려줍니다. 값·암호문은 화면·로그에 내보내지 않습니다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { encryptSecret } from "@/lib/credentialCrypto";
import { accountLast4Of, rrnMaskOf } from "@/lib/sensitiveMask";
import { resolveSensitiveActor } from "@/lib/sensitiveServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function requireM0() {
  const actor = await resolveSensitiveActor();
  if (!actor || !actor.isM0) throw new Error("관장·부장(M0)만 할 수 있습니다.");
  return actor;
}

export async function canViewSensitiveAdmin(): Promise<boolean> {
  const actor = await resolveSensitiveActor();
  return !!actor?.isM0;
}

export type BackfillCount = { encrypted: number; alreadyEncrypted: number; invalid: number; failed: number };
export type BackfillResult =
  | { ok: true; rrn: BackfillCount; bank: BackfillCount }
  | { ok: false; message: string };

export async function backfillSensitiveEncryption(): Promise<BackfillResult> {
  try {
    await requireM0();

    // --- 직원 주민번호 ---
    const rrn: BackfillCount = { encrypted: 0, alreadyEncrypted: 0, invalid: 0, failed: 0 };
    {
      const { data, error } = await supabaseAdmin
        .from("employee_profiles")
        .select("driver_id, resident_number, resident_number_enc, resident_number_mask");
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const r = row as Record<string, string | null>;
        const plain = (r.resident_number ?? "").trim();
        if (!plain) continue;
        if ((r.resident_number_enc ?? "").trim()) {
          rrn.alreadyEncrypted++;
          continue;
        }
        const digits = plain.replace(/\D/g, "");
        const mask = rrnMaskOf(digits);
        if (!mask) {
          rrn.invalid++;
          continue;
        }
        const { error: upErr } = await supabaseAdmin
          .from("employee_profiles")
          .update({
            resident_number_enc: encryptSecret(digits),
            resident_number_mask: r.resident_number_mask || mask,
            resident_number_updated_at: new Date().toISOString(),
          })
          .eq("driver_id", r.driver_id)
          .is("resident_number_enc", null);
        if (upErr) rrn.failed++;
        else rrn.encrypted++;
      }
    }

    // --- 강사 계좌번호 ---
    const bank: BackfillCount = { encrypted: 0, alreadyEncrypted: 0, invalid: 0, failed: 0 };
    {
      const { data, error } = await supabaseAdmin
        .from("saem_instructors")
        .select("id, bank_account, bank_account_enc, bank_account_last4");
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const r = row as Record<string, string | null>;
        const plain = (r.bank_account ?? "").trim();
        if (!plain) continue;
        if ((r.bank_account_enc ?? "").trim()) {
          bank.alreadyEncrypted++;
          continue;
        }
        const last4 = accountLast4Of(plain);
        if (!last4) {
          bank.invalid++;
          continue;
        }
        const { error: upErr } = await supabaseAdmin
          .from("saem_instructors")
          .update({
            bank_account_enc: encryptSecret(plain),
            bank_account_last4: r.bank_account_last4 || last4,
            bank_account_updated_at: new Date().toISOString(),
          })
          .eq("id", r.id)
          .is("bank_account_enc", null);
        if (upErr) bank.failed++;
        else bank.encrypted++;
      }
    }

    revalidatePath("/admin/sensitive");
    return { ok: true, rrn, bank };
  } catch (e) {
    // 마스터키 없음 등 — 메시지에 값이 들어가지 않습니다(credentialCrypto 규칙).
    return { ok: false, message: e instanceof Error ? e.message : "암호화 채우기에 실패했습니다." };
  }
}

export type SensitiveLogRow = {
  id: string;
  accessedAt: string;
  actorName: string;
  targetTable: string;
  targetLabel: string;
  field: string;
  purpose: string;
  ip: string | null;
};

// 최근순 열람 기록 — 대상·열람자는 이름으로 풀어서 보여 줍니다.
export async function listSensitiveAccessLogs(limit = 300): Promise<SensitiveLogRow[]> {
  await requireM0();
  const { data, error } = await supabaseAdmin
    .from("sensitive_access_logs")
    .select("id, accessed_at, actor_driver_id, target_table, target_id, field, purpose, ip")
    .order("accessed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, string | null>[];

  const driverIds = [
    ...new Set(
      rows.flatMap((r) => [
        r.actor_driver_id,
        r.target_table === "employee_profiles" ? r.target_id : null,
      ])
    ),
  ].filter((v): v is string => !!v);
  const instructorIds = [
    ...new Set(
      rows
        .filter((r) => r.target_table === "saem_instructors" && r.target_id && !r.target_id.startsWith("export:"))
        .map((r) => r.target_id as string)
    ),
  ];
  const [{ data: drv }, { data: ins }] = await Promise.all([
    driverIds.length
      ? supabaseAdmin.from("drivers").select("id, name").in("id", driverIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    instructorIds.length
      ? supabaseAdmin.from("saem_instructors").select("id, name").in("id", instructorIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const dName = new Map((drv ?? []).map((d) => [String((d as { id: string }).id), String((d as { name: string }).name)]));
  const iName = new Map((ins ?? []).map((d) => [String((d as { id: string }).id), String((d as { name: string }).name)]));

  const EXPORT_LABEL: Record<string, string> = {
    payout: "강사비 지출표 엑셀",
    settlement: "지급조서 엑셀",
    ledger: "강사비 지급대장 엑셀",
  };

  return rows.map((r) => {
    const tid = r.target_id ?? "";
    let targetLabel = tid;
    if (r.target_table === "employee_profiles") targetLabel = `직원 ${dName.get(tid) ?? "(알 수 없음)"}`;
    else if (tid.startsWith("export:")) targetLabel = EXPORT_LABEL[tid.slice(7)] ?? tid;
    else if (r.target_table === "saem_instructors") targetLabel = `강사 ${iName.get(tid) ?? "(알 수 없음)"}`;
    return {
      id: String(r.id),
      accessedAt: String(r.accessed_at ?? ""),
      actorName: r.actor_driver_id ? dName.get(r.actor_driver_id) ?? "(알 수 없음)" : "(직원 아님)",
      targetTable: String(r.target_table ?? ""),
      targetLabel,
      field: r.field === "resident_number" ? "주민번호" : r.field === "bank_account" ? "계좌번호" : String(r.field ?? ""),
      purpose: String(r.purpose ?? ""),
      ip: r.ip ?? null,
    };
  });
}
