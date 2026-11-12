// =====================================================================
// 민감정보(직원 주민번호·강사 계좌번호) 서버 전용 모듈 — 2026-11 관장 지시.
//   * 암호화: lib/credentialCrypto(AES-256-GCM, CREDENTIAL_MASTER_KEY) — 강사
//     주민번호(rrn_enc)와 같은 키·함수.
//   * 화면·엑셀 기본값은 가림값(주민번호 앞 7자리, 계좌 뒤 4자리)입니다.
//     전체 값은 이 모듈의 함수로만 복호화하고, 복호화하는 곳은 권한 확인 +
//     sensitive_access_logs 기록을 합니다.
//   * 전환 기간: 저장할 때 암호문·가림값·평문을 함께 쓰고, 읽을 때 암호문 우선
//     (암호문이 없으면 평문). 평문 칸은 검증 뒤 SQL 로 비웁니다.
//   * ⚠️ 평문·암호문을 console·에러 메시지에 넣지 않습니다.
//   * 서버 전용("use server" 아님). 클라이언트 컴포넌트가 import 하면 안 됩니다.
// =====================================================================

import { headers } from "next/headers";
import { getGoogleSession, getSession } from "@/app/actions";
import { resolveAuthContext, ctxIsM0 } from "@/lib/authContext";
import { decryptSecret, encryptSecret } from "@/lib/credentialCrypto";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { accountLast4Of, rrnMaskOf, RRN_VIEW_PURPOSES } from "@/lib/sensitiveMask";
import { parseResidentNumber } from "@/lib/supabase";

export type SensitiveActor = {
  driverId: string | null;
  name: string;
  isM0: boolean;
  roles: string[];
};

// 현재 로그인 직원. 직원 세션이 아니면 null.
export async function resolveSensitiveActor(): Promise<SensitiveActor | null> {
  const g = await getGoogleSession();
  const s = await getSession();
  const ctx = await resolveAuthContext(g, s && s.kind === "employee" ? { name: s.name } : null);
  if (!ctx) return null;
  const roles = ctx.driverId ? await listRolesForDriver(ctx.driverId) : [];
  return { driverId: ctx.driverId, name: ctx.name, isM0: ctxIsM0(ctx), roles };
}

// 직원 주민번호 전체 — M0·hr 직무만.
export function canRevealRrn(a: SensitiveActor | null): boolean {
  return !!a && (a.isM0 || a.roles.includes("hr"));
}

// 강사 계좌 전체 — M0·hr 직무·강사 정산 담당.
//   강사 정산 담당 = saem(강사관리, 정산·지급조서·지급대장 화면) 직무와
//   accounting(회계, 강사비 지출표 화면) 직무. 각 화면의 원래 게이트는 그대로 두고
//   그 위에 이 확인을 한 번 더 겁니다.
const BANK_ROLES = ["hr", "saem", "accounting"];
export function canRevealBankAccount(a: SensitiveActor | null): boolean {
  return !!a && (a.isM0 || a.roles.some((r) => BANK_ROLES.includes(r)));
}

export type SensitiveField = "resident_number" | "bank_account";

// 열람 기록 — 실패해도 throw 하지 않고 false. 호출부는 기록 실패 시 값을 내주지
//   않습니다(기록 없는 열람을 막기 위함).
export async function logSensitiveAccess(input: {
  actor: SensitiveActor;
  targetTable: string;
  targetId: string;
  field: SensitiveField;
  purpose: string;
}): Promise<boolean> {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  } catch {
    ip = null;
  }
  const { error } = await supabaseAdmin.from("sensitive_access_logs").insert({
    actor_driver_id: input.actor.driverId,
    target_table: input.targetTable,
    target_id: input.targetId,
    field: input.field,
    purpose: input.purpose,
    ip,
  });
  if (error) {
    console.warn("[sensitive] 열람 기록 실패:", error.message);
    return false;
  }
  return true;
}

// --- 저장용 칸 묶음 -------------------------------------------------------
// 주민번호 새 값(13자리) → employee_profiles 에 함께 쓸 칸. 형식이 아니면 throw.
//   마스터키가 없으면 encryptSecret 이 throw — 평문만 저장하는 폴백은 없습니다.
export function rrnColumnsForSave(raw: string): Record<string, string> {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const mask = rrnMaskOf(digits);
  if (!mask) throw new Error("주민등록번호 13자리를 입력하세요.");
  return {
    resident_number_enc: encryptSecret(digits),
    resident_number_mask: mask,
    // 전환 기간에만 평문을 함께 씁니다(검증 뒤 칸을 비울 예정).
    resident_number: `${digits.slice(0, 6)}-${digits.slice(6)}`,
    resident_number_updated_at: new Date().toISOString(),
  };
}

// 계좌번호 새 값 → saem_instructors 에 함께 쓸 칸.
export function bankAccountColumnsForSave(raw: string): Record<string, string> {
  const v = String(raw ?? "").trim();
  if (!v) throw new Error("계좌번호가 비어 있습니다.");
  return {
    bank_account_enc: encryptSecret(v),
    bank_account_last4: accountLast4Of(v) ?? "",
    bank_account: v, // 전환 기간에만
    bank_account_updated_at: new Date().toISOString(),
  };
}

// --- 복호화(권한·기록은 호출부 책임) ---------------------------------------
function decryptOr(enc: unknown, plain: unknown): string | null {
  const e = typeof enc === "string" ? enc.trim() : "";
  if (e) {
    try {
      return decryptSecret(e);
    } catch {
      return null; // 원인·값을 남기지 않습니다
    }
  }
  const p = typeof plain === "string" ? plain.trim() : "";
  return p || null;
}

// 직원 주민번호 전체("900101-1234567"). 없으면 null.
export async function readEmployeeRrnFull(driverId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("resident_number_enc, resident_number")
    .eq("driver_id", driverId)
    .maybeSingle();
  const r = (data ?? {}) as Record<string, unknown>;
  const v = decryptOr(r.resident_number_enc, r.resident_number);
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : v;
}

// 강사 계좌 전체 — id → 계좌번호(없으면 null).
export async function readInstructorAccountsFull(ids: string[]): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string | null>();
  if (!uniq.length) return out;
  const { data } = await supabaseAdmin
    .from("saem_instructors")
    .select("id, bank_account_enc, bank_account")
    .in("id", uniq);
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    out.set(String(r.id), decryptOr(r.bank_account_enc, r.bank_account));
  }
  return out;
}

// 엑셀 내보내기용 — 권한 확인 + 기록(1회 1건) 뒤 계좌 전체 맵. 권한이 없거나 기록에
//   실패하면 null(호출부는 뒤 4자리로 내보냅니다).
export async function bankAccountsForExport(
  ids: string[],
  kind: string
): Promise<Map<string, string | null> | null> {
  const actor = await resolveSensitiveActor();
  if (!actor || !canRevealBankAccount(actor)) return null;
  const logged = await logSensitiveAccess({
    actor,
    targetTable: "saem_instructors",
    targetId: `export:${kind}`,
    field: "bank_account",
    purpose: `엑셀 내보내기(${kind}) ${[...new Set(ids)].length}명`,
  });
  if (!logged) return null;
  return readInstructorAccountsFull(ids);
}

// 인사기록카드 저장용 — 주민번호 칸 입력값 → 함께 쓸 칸(생년월일·성별 포함).
//   비어 있으면 {} (기존 값 유지). 형식이 틀리면 throw.
export function residentNumberPatch(input: string | null): Record<string, unknown> {
  const v = (input ?? "").trim();
  if (!v) return {};
  const parsed = parseResidentNumber(v);
  if (!parsed) throw new Error("주민등록번호 형식이 올바르지 않습니다.");
  return { ...rrnColumnsForSave(v), birth_date: parsed.birthDate, gender: parsed.gender };
}

// [주민번호 보기] 목적 검사 — 정해진 선택지 또는 "기타: 내용".
export function normalizeRrnPurpose(purpose: string): string | null {
  const p = String(purpose ?? "").trim();
  if ((RRN_VIEW_PURPOSES as readonly string[]).includes(p)) return p;
  const m = /^기타\s*[:：]\s*(.+)$/.exec(p);
  if (m && m[1].trim()) return `기타: ${m[1].trim().slice(0, 200)}`;
  return null;
}
