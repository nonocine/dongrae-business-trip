"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMyDriver } from "@/lib/contractServer";
import { isYmd } from "@/lib/hrDiscipline";
import {
  uploadAttachment,
  readPendingRequests,
  writePendingRequests,
} from "@/lib/hrDisciplineServer";

// =====================================================================
// 직원 본인 — 경위서 제출 (/profile/hr '경위서')
//   ⚠️ 관장 지시: 상벌·경위서 열람은 관장·부장만.
//     · 포상: 2026-10 인사기록카드 '수상·포상' 탭(app/(app)/hr/awardActions)으로 옮김.
//     · 경위서: 본인이 제출만. 제출 후엔 본인도 내용을 볼 수 없고 "제출함" 날짜만.
//     · 징계: 본인 쪽 액션 자체가 없습니다(조회 경로 없음).
//   driver_id 는 언제나 세션에서만 도출하고, 본인 조회 select 에는 확인용 칸만 넣습니다
//   (경위서 subject·content·review_note 는 응답에 싣지 않음).
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const t = typeof v === "string" ? v.trim() : "";
  return t.length ? t : null;
};

export type MyDisciplineReceipts = {
  reports: { submitted_at: string }[];
  request: { at: string } | null; // 관장·부장의 경위서 제출 요청(요청자·메모는 내려보내지 않음)
};

export async function getMyDisciplineReceipts(): Promise<MyDisciplineReceipts | null> {
  const me = await getMyDriver();
  if (!me) return null;
  const [{ data: reports }, pending] = await Promise.all([
    supabaseAdmin
      .from("hr_incident_reports")
      .select("submitted_at") // ← 내용·제목·검토의견은 본인에게도 보내지 않음
      .eq("driver_id", me.id)
      .order("submitted_at", { ascending: false }),
    readPendingRequests(),
  ]);
  const req = pending[me.id];
  return {
    reports: (reports ?? []) as MyDisciplineReceipts["reports"],
    request: req ? { at: req.at } : null,
  };
}

// 경위서 제출. FormData: occurredOn, subject, content, confirmed("1"), file
export async function submitMyIncidentReport(fd: FormData): Promise<Result<{ submittedAt: string }>> {
  try {
    const me = await getMyDriver();
    if (!me) return { ok: false, message: "로그인이 필요합니다." };
    if (s(fd, "confirmed") !== "1") {
      return { ok: false, message: "제출 후에는 본인도 내용을 다시 볼 수 없습니다. 확인란에 체크해주세요." };
    }
    const subject = s(fd, "subject");
    const content = s(fd, "content");
    const occurred = s(fd, "occurredOn");
    if (!subject) return { ok: false, message: "제목을 적어주세요." };
    if (!content) return { ok: false, message: "내용을 적어주세요." };
    if (occurred && !isYmd(occurred)) return { ok: false, message: "사건일을 확인해주세요." };
    const pending = await readPendingRequests();
    const req = pending[me.id];
    const { data, error } = await supabaseAdmin
      .from("hr_incident_reports")
      .insert({
        driver_id: me.id, // ← 언제나 세션의 나
        occurred_on: occurred,
        subject,
        content,
        requested_by: req?.by ?? null,
      })
      .select("id, submitted_at")
      .single();
    if (error) throw new Error(error.message);
    const id = String((data as { id: string }).id);
    try {
      const path = await uploadAttachment("hr_incident_reports", id, fd.get("file"));
      if (path) await supabaseAdmin.from("hr_incident_reports").update({ attachment_path: path }).eq("id", id);
    } catch (e) {
      await supabaseAdmin.from("hr_incident_reports").delete().eq("id", id);
      throw e;
    }
    if (req) {
      delete pending[me.id];
      await writePendingRequests(pending);
    }
    revalidatePath("/profile/hr");
    revalidatePath("/hr/discipline");
    return { ok: true, submittedAt: String((data as { submitted_at: string }).submitted_at) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "제출 중 오류가 발생했습니다." };
  }
}
