"use server";

// =====================================================================
// 공용 비밀번호 관리 서버 액션 — /hr/credentials
//   * 절대 규칙(보안):
//     1. 비밀번호 평문을 DB 에 저장하지 않습니다. AES-256-GCM 으로 암호화한
//        값만 shared_credentials.password_encrypted 에 들어갑니다.
//     2. 마스터키는 CREDENTIAL_MASTER_KEY 환경변수. 없으면 명확한 에러로 멈추고
//        무암호화 폴백은 없습니다(lib/credentialCrypto).
//     3. 목록 응답에 password_encrypted 를 **절대** 실어 보내지 않습니다.
//        평문은 revealCredential(항목 1건)만 반환하며, 그 안에서 권한을 다시
//        확인합니다.
//     4. 평문·암호문·마스터키를 console 등 어떤 로그에도 남기지 않습니다.
//     5. 모든 액션이 진입 시 서버에서 권한을 재검증합니다(UI 우회 차단).
//   * 권한 (2026-08-21 개정, lib/credentialAccess):
//     - 열람 = M0 는 전 항목 / 그 외 직원은 credential_viewers 지정 항목만.
//     - 등록 = 로그인 직원 누구나. 등록자는 자동으로 그 항목의 열람자가 됩니다.
//     - 수정 = M0 또는 등록자 본인(created_by_driver_id 일치).
//     - 삭제·열람자 지정 = M0 만. 비M0 가 보낸 viewerIds 는 서버에서 무시합니다.
//   * shared_credentials·credential_viewers 는 RLS on(정책 0개) → service_role
//     경유만 가능합니다.
//   * 열람자는 credential_id FK on delete cascade — 항목을 지우면 함께 지워집니다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  requireCredentialAccess,
  requireCredentialManager,
  requireCredentialWriter,
} from "@/lib/credentialAccess";
import {
  decryptSecret,
  encryptSecret,
  isCredentialKeyConfigured,
} from "@/lib/credentialCrypto";
import {
  normalizeCredentialCategory,
  type CredentialRow,
  type CredentialStaff,
} from "@/lib/credentials";
import { loadTrainingRoster } from "@/lib/trainingRoster";
import { fmtKstDate } from "@/lib/datetime";

const CRED = "shared_credentials";
const VIEWERS = "credential_viewers";

// 목록에서 읽는 컬럼 — password_encrypted 는 여기 없습니다(규칙 3).
const LIST_COLUMNS =
  "id, name, category, account, url, memo, created_by, created_by_driver_id, created_at, updated_at";

type ActionResult = { ok: true } | { ok: false; message: string };

function actionError(
  e: unknown,
  fallback: string
): { ok: false; message: string } {
  // ⚠️ 에러 객체만 문자열화합니다 — 입력값(평문)은 절대 메시지에 넣지 않습니다.
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

const trim = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// timestamptz → KST "YYYY.MM.DD" (없으면 ""). 서버에서 미리 만들어 보냅니다 —
//   클라이언트에서 Date 를 쓰면 하이드레이션이 어긋납니다.
function kstDate(ts: unknown): string {
  const s = ts == null ? "" : String(ts);
  if (!s) return "";
  const out = fmtKstDate(s);
  return out === "-" ? "" : out;
}

export type CredentialInput = {
  name: string;
  category: string;
  account: string;
  password: string; // 수정에서 비우면 "기존 유지"
  url: string;
  memo: string;
  viewerIds: string[];
};

// 내가 볼 수 있는 항목 id — M0 는 null(제한 없음), 그 외는 지정된 id 목록.
async function visibleIdsFor(ctx: {
  isM0: boolean;
  driverId: string | null;
}): Promise<string[] | null> {
  if (ctx.isM0) return null;
  if (!ctx.driverId) return [];
  const { data, error } = await supabaseAdmin
    .from(VIEWERS)
    .select("credential_id")
    .eq("driver_id", ctx.driverId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) =>
    String((r as { credential_id: unknown }).credential_id ?? "")
  );
}

// 목록 — 비밀번호는 담기지 않습니다. 비M0 에게는 지정된 항목만 내려갑니다
//   (지정 안 된 항목은 존재 자체가 보이지 않음).
export async function listCredentials(): Promise<CredentialRow[]> {
  const ctx = await requireCredentialAccess();
  const allowed = await visibleIdsFor(ctx);
  if (allowed !== null && allowed.length === 0) return [];

  let q = supabaseAdmin
    .from(CRED)
    .select(LIST_COLUMNS)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (allowed !== null) q = q.in("id", allowed);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // 열람자 명단은 관리 화면(M0)에서만 필요합니다 — 그 외 직원에게 "누가 더 보는지"
  //   를 알려줄 이유가 없어 비워 보냅니다.
  const viewerIdsByCred = new Map<string, string[]>();
  const viewerNamesByCred = new Map<string, string[]>();
  if (ctx.isM0) {
    const [{ data: vs, error: vErr }, { data: drivers }] = await Promise.all([
      supabaseAdmin.from(VIEWERS).select("credential_id, driver_id"),
      supabaseAdmin.from("drivers").select("id, name"),
    ]);
    if (vErr) throw new Error(vErr.message);
    const nameById = new Map<string, string>();
    for (const d of drivers ?? []) {
      const r = d as { id: unknown; name: unknown };
      nameById.set(String(r.id ?? ""), String(r.name ?? ""));
    }
    for (const v of vs ?? []) {
      const r = v as { credential_id: unknown; driver_id: unknown };
      const cid = String(r.credential_id ?? "");
      const did = String(r.driver_id ?? "");
      if (!cid || !did) continue;
      viewerIdsByCred.set(cid, [...(viewerIdsByCred.get(cid) ?? []), did]);
      const nm = nameById.get(did);
      if (nm)
        viewerNamesByCred.set(cid, [...(viewerNamesByCred.get(cid) ?? []), nm]);
    }
  }

  return rows.map((r) => {
    const id = String(r.id ?? "");
    // 등록자 driver_id 는 판정에만 쓰고 클라이언트로 내려보내지 않습니다.
    const ownerId = r.created_by_driver_id == null ? "" : String(r.created_by_driver_id);
    return {
      id,
      name: String(r.name ?? ""),
      category: normalizeCredentialCategory(r.category),
      account: String(r.account ?? ""),
      url: String(r.url ?? ""),
      memo: String(r.memo ?? ""),
      createdBy: String(r.created_by ?? ""),
      updatedOn: kstDate(r.updated_at ?? r.created_at),
      viewerIds: viewerIdsByCred.get(id) ?? [],
      viewerNames: (viewerNamesByCred.get(id) ?? []).sort((a, b) =>
        a.localeCompare(b, "ko-KR")
      ),
      canEdit: ctx.isM0 || (!!ctx.driverId && ownerId === ctx.driverId),
    } satisfies CredentialRow;
  });
}

// 화면이 관리 UI(열람자 지정·삭제 버튼)를 그릴지 정하는 표시용 값 + 마스터키
//   설정 여부. canCreate 는 등록 버튼 노출용입니다.
//   ⚠️ 표시용일 뿐이며 실제 차단은 각 액션의 서버 재검증이 담당합니다.
export async function getCredentialContext(): Promise<{
  canManage: boolean;
  canCreate: boolean;
  keyConfigured: boolean;
}> {
  const ctx = await requireCredentialAccess();
  return {
    canManage: ctx.isM0,
    canCreate: ctx.isM0 || !!ctx.driverId,
    keyConfigured: isCredentialKeyConfigured(),
  };
}

// 열람자 지정 후보 — 재직 직원 명단(의무교육 로스터 단일 출처 재사용). M0 만.
export async function listCredentialStaff(): Promise<CredentialStaff[]> {
  await requireCredentialManager();
  const roster = await loadTrainingRoster();
  return roster.map((r) => ({
    driverId: r.driver_id,
    name: r.name,
    rank: r.rank,
  }));
}

// ★ 비밀번호 열람 — 이 액션만 평문을 반환합니다.
//   권한을 여기서 다시 확인합니다: M0 이거나, 그 항목의 지정 열람자여야 합니다.
//   (목록을 우회해 id 를 직접 넣어 호출하는 경우를 여기서 막습니다)
export async function revealCredential(
  id: string
): Promise<{ ok: true; password: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireCredentialAccess();
    const target = trim(id, 60);
    if (!target) return { ok: false, message: "대상이 없습니다." };

    if (!ctx.isM0) {
      if (!ctx.driverId) return { ok: false, message: "열람 권한이 없습니다." };
      const { data: v, error: vErr } = await supabaseAdmin
        .from(VIEWERS)
        .select("id")
        .eq("credential_id", target)
        .eq("driver_id", ctx.driverId)
        .maybeSingle();
      if (vErr) throw new Error(vErr.message);
      // 권한이 없으면 "없는 항목"과 같은 답을 줍니다 — 존재 여부도 알리지 않습니다.
      if (!v) return { ok: false, message: "열람 권한이 없습니다." };
    }

    const { data, error } = await supabaseAdmin
      .from(CRED)
      .select("password_encrypted")
      .eq("id", target)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "열람 권한이 없습니다." };

    const enc = String(
      (data as { password_encrypted?: unknown }).password_encrypted ?? ""
    );
    if (!enc) return { ok: false, message: "저장된 비밀번호가 없습니다." };
    // 복호화 실패(키 불일치·변조)는 그대로 메시지로 올립니다 — 값은 남기지 않습니다.
    return { ok: true, password: decryptSecret(enc) };
  } catch (e) {
    return actionError(e, "비밀번호를 열지 못했습니다.");
  }
}

// 등록자 본인을 열람자로 추가 — 자기가 올린 비번은 자기가 봐야 합니다.
//   이미 있으면 unique(credential_id, driver_id) 로 걸리므로 조용히 넘어갑니다.
async function addSelfAsViewer(credentialId: string, driverId: string | null) {
  if (!driverId) return; // driver 연결이 없는 M0(master 계정) — 전 항목을 보므로 불필요.
  const { error } = await supabaseAdmin
    .from(VIEWERS)
    .upsert(
      { credential_id: credentialId, driver_id: driverId },
      { onConflict: "credential_id,driver_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

// 열람자 교체 — 지정된 driver_id 집합으로 통째로 바꿉니다(M0 전용 경로에서만 호출).
async function replaceViewers(credentialId: string, viewerIds: string[]) {
  const ids = [...new Set((viewerIds ?? []).map((v) => trim(v, 60)).filter(Boolean))];
  const { error: delErr } = await supabaseAdmin
    .from(VIEWERS)
    .delete()
    .eq("credential_id", credentialId);
  if (delErr) throw new Error(delErr.message);
  if (ids.length === 0) return;
  const { error: insErr } = await supabaseAdmin
    .from(VIEWERS)
    .insert(
      ids.map((driver_id) => ({ credential_id: credentialId, driver_id }))
    );
  if (insErr) throw new Error(insErr.message);
}

// 공통 입력 검증 — 통과하면 정리된 값, 아니면 안내 문구(문자열).
//   ⚠️ 비밀번호는 여기서 다루지 않습니다(로그·메시지에 섞일 여지를 없앱니다).
function validate(
  input: CredentialInput
): { name: string; category: string } | string {
  const name = trim(input.name, 120);
  if (!name) return "이름을 입력하세요.";
  return { name, category: normalizeCredentialCategory(input.category) };
}

// 등록 — 로그인 직원 누구나. 등록자는 자동으로 열람자가 됩니다.
//   ⚠️ 열람자 지정은 M0 만 — 비M0 가 보낸 viewerIds 는 서버에서 버립니다
//   (UI 에 체크박스가 없더라도 요청은 위조될 수 있습니다).
export async function createCredential(
  input: CredentialInput
): Promise<ActionResult> {
  try {
    const ctx = await requireCredentialWriter();
    const checked = validate(input);
    if (typeof checked === "string") return { ok: false, message: checked };
    const password = String(input.password ?? "");
    if (!password.trim()) return { ok: false, message: "비밀번호를 입력하세요." };

    // 암호화가 실패하면(마스터키 미설정 등) 여기서 멈춥니다 — 평문 저장 없음.
    const password_encrypted = encryptSecret(password);

    const { data, error } = await supabaseAdmin
      .from(CRED)
      .insert({
        name: checked.name,
        category: checked.category,
        account: trim(input.account, 200) || null,
        password_encrypted,
        url: trim(input.url, 500) || null,
        memo: trim(input.memo, 1000) || null,
        created_by: ctx.name,
        // 수정 권한 판정용 — 이름은 동명이인 위험이 있어 driver_id 로 남깁니다.
        created_by_driver_id: ctx.driverId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const newId = String((data as { id: string }).id);
    if (ctx.isM0) await replaceViewers(newId, input.viewerIds ?? []);
    await addSelfAsViewer(newId, ctx.driverId);
    revalidatePath("/hr/credentials");
    return { ok: true };
  } catch (e) {
    return actionError(e, "등록하지 못했습니다.");
  }
}

// 수정 — M0 또는 등록자 본인(사업실적의 "관리자 ∥ 작성자" 판정과 같은 논리).
//   본인 항목이 아니면 "찾을 수 없음"으로 답합니다 — 존재 여부를 알리지 않습니다.
//   열람자 교체는 M0 만 — 비M0 의 수정은 열람자를 건드리지 않습니다.
export async function updateCredential(
  id: string,
  input: CredentialInput
): Promise<ActionResult> {
  try {
    const ctx = await requireCredentialAccess();
    const target = trim(id, 60);
    if (!target) return { ok: false, message: "대상이 없습니다." };
    const checked = validate(input);
    if (typeof checked === "string") return { ok: false, message: checked };

    const fields: Record<string, unknown> = {
      name: checked.name,
      category: checked.category,
      account: trim(input.account, 200) || null,
      url: trim(input.url, 500) || null,
      memo: trim(input.memo, 1000) || null,
      updated_at: new Date().toISOString(),
    };
    // 비밀번호는 "입력했을 때만" 바꿉니다. 비워 두면 기존 암호문을 그대로 둡니다 —
    //   기존 값을 읽어 다시 쓰지 않습니다(평문을 만들 이유가 없습니다).
    const password = String(input.password ?? "");
    if (password.trim()) fields.password_encrypted = encryptSecret(password);

    let q = supabaseAdmin.from(CRED).update(fields).eq("id", target);
    // 비M0 는 자기가 등록한 항목만 — 조건을 쿼리에 넣어 남의 항목은 애초에
    //   맞지 않게 합니다(0건 → "찾을 수 없음").
    if (!ctx.isM0) {
      if (!ctx.driverId) return { ok: false, message: "항목을 찾을 수 없습니다." };
      q = q.eq("created_by_driver_id", ctx.driverId);
    }
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "항목을 찾을 수 없습니다." };

    if (ctx.isM0) await replaceViewers(target, input.viewerIds ?? []);
    revalidatePath("/hr/credentials");
    return { ok: true };
  } catch (e) {
    return actionError(e, "수정하지 못했습니다.");
  }
}

export async function deleteCredential(id: string): Promise<ActionResult> {
  try {
    await requireCredentialManager();
    const target = trim(id, 60);
    if (!target) return { ok: false, message: "대상이 없습니다." };
    // 열람자(credential_viewers)는 FK cascade 로 함께 지워집니다.
    const { error } = await supabaseAdmin.from(CRED).delete().eq("id", target);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/credentials");
    return { ok: true };
  } catch (e) {
    return actionError(e, "삭제하지 못했습니다.");
  }
}

// 대시보드 카드용 요약 — 내가 열람 가능한 건수. 미로그인·오류면 null.
//   비밀번호는 물론 항목 이름조차 내려보내지 않습니다(건수만).
export async function getMyCredentialSummary(): Promise<{
  count: number;
  canManage: boolean;
} | null> {
  try {
    const ctx = await requireCredentialAccess();
    if (ctx.isM0) {
      const { count, error } = await supabaseAdmin
        .from(CRED)
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return { count: count ?? 0, canManage: true };
    }
    if (!ctx.driverId) return { count: 0, canManage: false };
    const { count, error } = await supabaseAdmin
      .from(VIEWERS)
      .select("id", { count: "exact", head: true })
      .eq("driver_id", ctx.driverId);
    if (error) throw new Error(error.message);
    return { count: count ?? 0, canManage: false };
  } catch {
    return null;
  }
}
