"use server";

import { revalidatePath } from "next/cache";
import { requirePersonnel } from "@/lib/personnelAccess";
import type { EmployeeAppointment } from "@/lib/supabase";
import {
  applyConfirmAppointment,
  applyRejectAppointment,
} from "@/lib/appointments";
import { loadAppointments, saveAppointments } from "@/lib/appointmentsServer";

// =====================================================================
// 직원이 올린 인사발령(확인 대기) 확정·반려 — 인사기록 관리 화면 인사발령 탭.
//   * 권한: 인사 파일 열람 권한 보유자(관장·부장·master·personnel 직무)만 —
//     lib/personnelAccess.requirePersonnel. 본인 예외 없음(일반 직원이 자기 것을
//     확정하는 길을 막습니다).
//   * 변환 규칙은 lib/appointments(applyConfirm/applyReject) — 화면도 같은 함수로
//     결과를 미리 그리지 않고, 여기서 돌려준 목록으로 다시 그립니다.
//   * 카드 잠금과 무관하게 확정할 수 있습니다(잠긴 카드도 발령은 쌓여야 하므로).
// =====================================================================

type Result =
  | { ok: true; appointments: EmployeeAppointment[] }
  | { ok: false; message: string };

async function review(
  driverId: string,
  apply: (list: EmployeeAppointment[], by: string, at: string) => EmployeeAppointment[]
): Promise<Result> {
  try {
    const viewer = await requirePersonnel();
    if (!driverId) throw new Error("직원을 선택해주세요.");
    const stored = await loadAppointments(driverId);
    if (!stored.exists) throw new Error("인사기록카드가 없습니다.");
    const next = apply(stored.list, viewer.name, new Date().toISOString());
    const saved = await saveAppointments(driverId, next, true);
    revalidatePath("/hr");
    revalidatePath("/profile/hr");
    return { ok: true, appointments: saved };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.",
    };
  }
}

export async function confirmEmployeeAppointment(
  driverId: string,
  appointmentId: string
): Promise<Result> {
  return review(driverId, (list, by, at) =>
    applyConfirmAppointment(list, appointmentId, by, at)
  );
}

export async function rejectEmployeeAppointment(
  driverId: string,
  appointmentId: string,
  reason: string
): Promise<Result> {
  return review(driverId, (list, by, at) =>
    applyRejectAppointment(list, appointmentId, by, at, String(reason ?? ""))
  );
}
