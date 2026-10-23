"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getMyDriver } from "@/lib/contractServer";
import {
  normalizeAppointmentList,
  type EmployeeAppointment,
} from "@/lib/supabase";
import {
  APPOINTMENT_EDITABLE_KEYS,
  appointmentStatusOf,
} from "@/lib/appointments";
import {
  loadAppointments,
  notifyReviewersOnce,
  saveAppointments,
} from "@/lib/appointmentsServer";

// =====================================================================
// 직원 본인 — 인사발령 입력 (/profile/hr '인사발령' 탭)
//   * 2026-10 노미현 부장 공지 "처음 입사 발령은 본인이 기록" — daabbce 의 읽기 전용을
//     풀되, 본인이 올린 것은 확인 대기(pending)로만 들어갑니다. 규칙은 lib/appointments.
//   * driver_id 는 언제나 세션에서만 도출(남의 카드 차단). 입력값은 고칠 수 있는 칸
//     (APPOINTMENT_EDITABLE_KEYS)만 읽고 status·확정 정보는 서버가 붙입니다 —
//     status 를 confirmed 로 보내도 무시됩니다.
//   * 확정된(confirmed) 발령은 수정·삭제 불가. [수정 요청] 은 원본을 두고 바뀐 내용을
//     pending 으로 따로 올립니다(original_id).
//   * 카드 잠금과 무관 — 대기 건은 확정 전까지 기록을 바꾸지 않기 때문입니다.
// =====================================================================

type Result =
  | { ok: true; appointments: EmployeeAppointment[] }
  | { ok: false; message: string };

export type MyAppointmentInput = Pick<
  EmployeeAppointment,
  (typeof APPOINTMENT_EDITABLE_KEYS)[number]
>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// 고칠 수 있는 칸만 뽑아 정규화 — 그 밖의 칸(status·id·confirmed_* …)은 버립니다.
function cleanInput(input: unknown): MyAppointmentInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  const picked = Object.fromEntries(
    APPOINTMENT_EDITABLE_KEYS.map((k) => [k, raw[k]])
  );
  const [a] = normalizeAppointmentList([picked]);
  if (!YMD.test(a.effective_date)) throw new Error("발령일을 입력해 주세요.");
  return Object.fromEntries(
    APPOINTMENT_EDITABLE_KEYS.map((k) => [k, a[k]])
  ) as MyAppointmentInput;
}

const sameFields = (a: EmployeeAppointment, b: MyAppointmentInput) =>
  APPOINTMENT_EDITABLE_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));

async function run(
  fn: (
    me: { id: string; name: string },
    list: EmployeeAppointment[]
  ) => { list: EmployeeAppointment[]; notifyId: string | null }
): Promise<Result> {
  try {
    const me = await getMyDriver();
    if (!me) throw new Error("직원 로그인이 필요합니다.");
    const stored = await loadAppointments(me.id);
    const { list, notifyId } = fn(me, stored.list);
    let saved = await saveAppointments(me.id, list, stored.exists);
    if (notifyId) {
      const stamped = await notifyReviewersOnce(me.id, me.name, saved, notifyId);
      if (stamped !== saved) saved = await saveAppointments(me.id, stamped, true);
    }
    revalidatePath("/profile/hr");
    revalidatePath("/hr");
    return { ok: true, appointments: saved };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.",
    };
  }
}

function newPending(
  me: { name: string },
  fields: MyAppointmentInput,
  originalId?: string
): EmployeeAppointment {
  return {
    ...fields,
    id: randomUUID(),
    status: "pending",
    requested_at: new Date().toISOString(),
    requested_by: me.name,
    ...(originalId ? { original_id: originalId } : {}),
  };
}

// 발령 추가 — 확인 대기로 들어갑니다.
export async function addMyAppointment(input: unknown): Promise<Result> {
  return run((me, list) => {
    const item = newPending(me, cleanInput(input));
    return { list: [...list, item], notifyId: item.id! };
  });
}

// 확정된 발령의 수정 요청 — 원본은 그대로 두고 바뀐 내용을 대기로 올립니다.
//   원본은 id 로, id 가 없던 옛 항목은 (index + 화면에서 본 값)으로 찾습니다.
export async function requestMyAppointmentChange(
  original: { id?: string; index?: number; snapshot?: unknown },
  input: unknown
): Promise<Result> {
  return run((me, list) => {
    const fields = cleanInput(input);
    let oi = original.id ? list.findIndex((a) => a.id === original.id) : -1;
    if (oi < 0 && !original.id && typeof original.index === "number") {
      const cand = list[original.index];
      const snap = cleanInputLoose(original.snapshot);
      if (cand && !cand.id && snap && sameFields(cand, snap)) oi = original.index;
    }
    if (oi < 0)
      throw new Error("원래 발령을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.");
    if (appointmentStatusOf(list[oi]) !== "confirmed")
      throw new Error("확정된 발령만 수정 요청할 수 있습니다.");
    if (sameFields(list[oi], fields)) throw new Error("바뀐 내용이 없습니다.");

    const next = [...list];
    const originalId = next[oi].id ?? randomUUID();
    next[oi] = { ...next[oi], id: originalId };
    if (
      next.some(
        (a) => a.original_id === originalId && appointmentStatusOf(a) === "pending"
      )
    )
      throw new Error("이 발령의 수정 요청이 이미 확인 대기 중입니다. 그 요청을 고쳐 주세요.");
    const item = newPending(me, fields, originalId);
    return { list: [...next, item], notifyId: item.id! };
  });
}

// 대기·반려 건 수정 — 다시 확인 대기로 올라갑니다. 확정 건은 거부.
export async function updateMyAppointment(
  id: string,
  input: unknown
): Promise<Result> {
  return run((me, list) => {
    const idx = list.findIndex((a) => !!id && a.id === id);
    if (idx < 0) throw new Error("수정할 발령을 찾을 수 없습니다.");
    if (appointmentStatusOf(list[idx]) === "confirmed")
      throw new Error("확정된 발령은 직접 고칠 수 없습니다. [수정 요청]을 이용해 주세요.");
    const prev = list[idx];
    const item: EmployeeAppointment = {
      ...cleanInput(input),
      id: prev.id,
      status: "pending",
      requested_at: new Date().toISOString(),
      requested_by: me.name,
      ...(prev.original_id ? { original_id: prev.original_id } : {}),
      ...(prev.notified_at ? { notified_at: prev.notified_at } : {}),
    };
    return {
      list: list.map((a, i) => (i === idx ? item : a)),
      notifyId: item.id!,
    };
  });
}

// 대기·반려 건 삭제(요청 철회). 확정 건은 거부.
export async function deleteMyAppointment(id: string): Promise<Result> {
  return run((_me, list) => {
    const idx = list.findIndex((a) => !!id && a.id === id);
    if (idx < 0) throw new Error("삭제할 발령을 찾을 수 없습니다.");
    if (appointmentStatusOf(list[idx]) === "confirmed")
      throw new Error("확정된 발령은 삭제할 수 없습니다. 관장·부장께 요청해 주세요.");
    return { list: list.filter((_, i) => i !== idx), notifyId: null };
  });
}

// 스냅샷 비교용 — 발령일 검사 없이 칸만 정규화.
function cleanInputLoose(input: unknown): MyAppointmentInput | null {
  if (!input || typeof input !== "object") return null;
  const [a] = normalizeAppointmentList([input]);
  return Object.fromEntries(
    APPOINTMENT_EDITABLE_KEYS.map((k) => [k, a[k]])
  ) as MyAppointmentInput;
}
