// =====================================================================
// 문자 발송 — 서버 데이터(받는 사람·발송 이력). 서버 전용.
//   ⚠️ 전화번호는 이 파일 밖(화면·로그·DB)으로 나가지 않습니다.
//     화면에는 보호자 id 만 주고, 발송 때 서버가 id → 번호로 바꿉니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canSeeFullBody, previewBody, type SmsAccess } from "@/lib/smsAccess";
import {
  isValidSmsPhone,
  normalizeSmsPhone,
  type SmsBkStudent,
  type SmsLogRow,
} from "@/lib/smsText";

export const SMS_LOG_TABLE = "sms_send_logs";

type GuardianLink = {
  student_id: string;
  guardian_id: string;
  is_primary: boolean;
};
type Guardian = { id: string; phone: string | null; status: string };

async function loadActiveGuardians(ids: string[]): Promise<Map<string, string>> {
  // id → 정규화된 유효 번호(정상 보호자만).
  const phones = new Map<string, string>();
  if (ids.length === 0) return phones;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("bk_guardians")
      .select("id, phone, status")
      .in("id", ids.slice(i, i + 200))
      .eq("status", "active");
    if (error) throw new Error(`보호자 조회 실패: ${error.message}`);
    for (const g of (data ?? []) as Guardian[]) {
      const d = normalizeSmsPhone(g.phone ?? "");
      if (isValidSmsPhone(d)) phones.set(g.id, d);
    }
  }
  return phones;
}

// 재원생 + 번호 있는 정상 보호자 id(대표/그 밖). 번호는 넘기지 않습니다.
export async function listSmsBkStudents(): Promise<SmsBkStudent[]> {
  const { data: stuData, error: stuError } = await supabaseAdmin
    .from("bk_students")
    .select("id, name, grade, class_code")
    .eq("status", "active")
    .order("class_code")
    .order("grade")
    .order("name");
  if (stuError) throw new Error(`학생 조회 실패: ${stuError.message}`);
  const students = (stuData ?? []) as {
    id: string;
    name: string;
    grade: string | null;
    class_code: string;
  }[];
  if (students.length === 0) return [];

  const { data: linkData, error: linkError } = await supabaseAdmin
    .from("bk_guardian_students")
    .select("student_id, guardian_id, is_primary")
    .in(
      "student_id",
      students.map((s) => s.id),
    );
  if (linkError) throw new Error(`보호자 연결 조회 실패: ${linkError.message}`);
  const links = (linkData ?? []) as GuardianLink[];
  const phones = await loadActiveGuardians([
    ...new Set(links.map((l) => l.guardian_id)),
  ]);

  return students.map((s) => {
    const mine = links.filter((l) => l.student_id === s.id && phones.has(l.guardian_id));
    return {
      id: s.id,
      name: s.name,
      grade: s.grade ?? "",
      class_code: s.class_code,
      primaryGuardianIds: mine.filter((l) => l.is_primary).map((l) => l.guardian_id),
      otherGuardianIds: mine.filter((l) => !l.is_primary).map((l) => l.guardian_id),
    };
  });
}

// 발송 직전 — 고른 학생들의 보호자 번호(중복 제거). 화면 값을 믿지 않고 다시 셉니다.
export async function resolveBkRecipients(
  studentIds: string[],
  mode: "primary" | "all",
): Promise<{ phones: string[]; studentCount: number }> {
  const all = await listSmsBkStudents();
  const wanted = new Set(studentIds);
  const picked = all.filter((s) => wanted.has(s.id));
  const guardianIds = new Set<string>();
  for (const s of picked) {
    for (const id of s.primaryGuardianIds) guardianIds.add(id);
    if (mode === "all") for (const id of s.otherGuardianIds) guardianIds.add(id);
  }
  const phoneById = await loadActiveGuardians([...guardianIds]);
  const phones = [...new Set([...guardianIds].map((id) => phoneById.get(id)).filter(Boolean))] as string[];
  return { phones, studentCount: picked.length };
}

// 전 직원이 같은 목록을 봅니다. 본문 전체는 보낸 본인·관장·부장만 — 나머지는 앞 20자를
//   서버에서 잘라 보냅니다(화면에서 가리는 게 아니라 아예 내려보내지 않음).
export async function listSmsLogs(
  viewer: Pick<SmsAccess, "driverId" | "isM0">,
  limit = 50,
): Promise<SmsLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from(SMS_LOG_TABLE)
    .select(
      "id, created_at, sent_by, program, audience_desc, recipient_count, text_body, msg_type, sender, is_test, ok, sent_count, failed_count, provider_msg_id, error",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`발송 이력 조회 실패: ${error.message}`);
  const rows = (data ?? []) as (Omit<
    SmsLogRow,
    "sender_name" | "text_truncated"
  > & {
    sent_by: string | null;
  })[];
  const ids = [...new Set(rows.map((r) => r.sent_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .in("id", ids);
    for (const d of (drv ?? []) as { id: string; name: string }[])
      names.set(d.id, d.name);
  }
  return rows.map(({ sent_by, text_body, ...r }) => {
    const full = canSeeFullBody(viewer, sent_by);
    const body = text_body ?? "";
    const shown = full ? body : previewBody(body);
    return {
      ...r,
      sender_name: sent_by ? names.get(sent_by) ?? null : null,
      text_body: shown,
      text_truncated: shown !== body,
    };
  });
}
