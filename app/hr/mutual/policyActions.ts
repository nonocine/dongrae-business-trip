"use server";

// =====================================================================
// 상조회 규정 전문 — MU-5
//   * 저장 위치: 기존 settings(key, value) 테이블의 단일 키 'mutual_policy'.
//     새 테이블을 만들지 않은 이유 —
//       ① settings 는 이미 조직명·대표자·주소 등 기관 단위 설정을 담고 있는
//          범용 key/value 테이블이고 key 에 UNIQUE 제약이 있다(중복 행 불가).
//       ② 규정은 "한 기관에 한 문서" 이므로 행이 하나면 충분하다.
//       ③ 새 테이블은 사용자가 직접 SQL 을 실행해야 하지만(이 환경에서는 DDL 을
//          코드로 실행할 수 없다) settings 는 지금 바로 쓸 수 있다 — 마이그레이션 0.
//     본문·이력·수정자를 한 JSON 으로 묶어 한 행을 통째로 갱신하므로 원자적이다.
//   * 열람은 로그인 직원 전원, 수정은 mutual 직무·M0(2층 게이트).
//   * 금액표는 여기에 저장하지 않는다 — 화면이 lib/mutual 의 MUTUAL_RULES 를
//     직접 렌더링해 코드 상수와 화면이 단일 출처가 된다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMutualView, requireMutualManage } from "@/lib/mutualAccess";

const SETTINGS = "settings";
// "use server" 모듈은 async 함수만 export 할 수 있어 상수는 내부에 둔다.
const POLICY_KEY = "mutual_policy";

export type PolicyRevision = {
  date: string; // YYYY-MM-DD
  label: string; // "제정" / "수정"
};

export type MutualPolicy = {
  text: string;
  revisions: PolicyRevision[];
  updatedAt: string | null;
  updatedBy: string | null;
  /** settings 에 저장된 값이 아직 없어 기본 초안을 보여 주는 중. */
  isDefault: boolean;
  canManage: boolean;
};

// 실제 규정 전문을 받기 전까지 보여 줄 기본 초안.
//   아는 사실(회비·지급 기준·제정/수정일)만 담고, 확인이 필요한 대목은 그대로
//   표시해 담당이 실제 조문으로 바꿔 넣게 한다.
const DEFAULT_REVISIONS: PolicyRevision[] = [
  { date: "2023-02-17", label: "제정" },
  { date: "2024-11-01", label: "수정" },
];

const DEFAULT_TEXT = `제1조(명칭) 이 회는 동래구청소년센터 상조회(이하 "상조회")라 한다.

제2조(목적) 상조회는 직원 상호간의 친목을 도모하고 경조사 시 상호 부조함을
목적으로 한다.

제3조(회원) 상조회의 회원은 상조회비를 납부하는 재직 직원으로 한다.
  ① 가입·탈퇴는 본인의 의사에 따른다.
  ② 회비를 납부하지 않는 사람에게는 상조회 지원을 하지 않는다.
  ③ 휴직 등으로 회비 납부가 중단된 경우 일시정지로 관리한다.

제4조(회비) 회비는 월 15,000원으로 하고 매월 급여에서 공제한다.

제5조(지급 기준) 경조사 지원 금액은 별표(금액표)에 따른다.
  ① 생일 축하금 및 생일 간식비
  ② 결혼(본인) 축하금
  ③ 조의금(본인·배우자 / 부모·배우자 부모 / 자녀 / 형제자매)
  ④ 출산 축하금
  ⑤ 퇴사지원금(근속 기간에 따라 차등)

제6조(연말 상여) 회계연도 말 잔액이 충분한 경우 총회 의결로 회원에게
연말 상여를 지급할 수 있다.

제7조(운영) 상조회는 회장 1명과 총무 1명을 두어 운영하며, 장부는 연 1회
결산하여 회원에게 공개한다.

제8조(기타) 이 규정에 정하지 않은 사항은 총회의 의결에 따른다.

※ 위 내용은 실제 규정 문서를 받기 전에 확인된 사실(회비·지급 기준·개정 이력)만
   담아 정리한 초안입니다. [수정]을 눌러 실제 조문으로 바꿔 주세요.`;

function parsePolicy(raw: string | null): {
  text: string;
  revisions: PolicyRevision[];
  updatedAt: string | null;
  updatedBy: string | null;
} | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const revisions = Array.isArray(p.revisions)
      ? (p.revisions as Record<string, unknown>[])
          .map((r) => ({
            date: String(r?.date ?? "").trim(),
            label: String(r?.label ?? "").trim(),
          }))
          .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.label.length > 0)
      : [];
    return {
      text: typeof p.text === "string" ? p.text : "",
      revisions,
      updatedAt: p.updatedAt == null ? null : String(p.updatedAt),
      updatedBy: p.updatedBy == null ? null : String(p.updatedBy),
    };
  } catch {
    // JSON 이 아니면 예전에 평문으로 넣었을 수 있으니 본문으로 살린다.
    return { text: raw, revisions: [], updatedAt: null, updatedBy: null };
  }
}

export async function getMutualPolicy(): Promise<MutualPolicy> {
  const ctx = await requireMutualView();
  const { data } = await supabaseAdmin
    .from(SETTINGS)
    .select("value")
    .eq("key", POLICY_KEY)
    .maybeSingle();
  const parsed = parsePolicy(
    data == null ? null : String((data as { value: unknown }).value ?? "")
  );
  if (!parsed || !parsed.text.trim())
    return {
      text: DEFAULT_TEXT,
      revisions: DEFAULT_REVISIONS,
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
      canManage: ctx.canManage,
    };
  return {
    text: parsed.text,
    revisions: parsed.revisions.length ? parsed.revisions : DEFAULT_REVISIONS,
    updatedAt: parsed.updatedAt,
    updatedBy: parsed.updatedBy,
    isDefault: false,
    canManage: ctx.canManage,
  };
}

export async function saveMutualPolicy(input: {
  text: string;
  revisions: PolicyRevision[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const ctx = await requireMutualManage();
    const text = (input.text ?? "").trim();
    if (!text) return { ok: false, message: "규정 본문을 입력하세요." };
    if (text.length > 60_000)
      return { ok: false, message: "본문이 너무 깁니다. (6만자 이내)" };

    const revisions = (input.revisions ?? [])
      .map((r) => ({
        date: String(r?.date ?? "").trim(),
        label: String(r?.label ?? "").trim(),
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.label.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    const payload = JSON.stringify({
      text,
      revisions,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.name,
    });

    // settings.key 에 UNIQUE 가 있어 upsert 로 한 행만 유지된다.
    const { data: existing } = await supabaseAdmin
      .from(SETTINGS)
      .select("id")
      .eq("key", POLICY_KEY)
      .maybeSingle();
    if (existing) {
      const { error } = await supabaseAdmin
        .from(SETTINGS)
        .update({ value: payload })
        .eq("key", POLICY_KEY);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from(SETTINGS)
        .insert({ key: POLICY_KEY, value: payload });
      if (error) throw new Error(error.message);
    }

    revalidatePath("/hr/mutual/policy");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
}
