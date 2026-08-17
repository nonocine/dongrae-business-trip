// =====================================================================
// 의무교육 대상 판정용 로스터 — 단일 출처.
//   * 이전에는 현황판(app/hr/trainings/actions.ts)과 D-7 독촉(lib/trainingReminder)
//     이 각자 재직자 명단을 만들어 규칙이 갈라질 수 있었습니다. 한 곳으로 합칩니다.
//   * 명단 범위는 종전과 동일 — drivers.is_active 이면서 employment_status 가
//     'resigned' 아닌 직원(= 현재 재직자). 정렬도 종전대로 입사(created_at) 순.
//   * 여기에 join_date / resignation_date 를 함께 실어, 교육별 대상 판정
//     (lib/trainings.ts 의 isTargetOn)을 호출부가 같은 규칙으로 수행합니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·Cron 코어가 import 합니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { EmploymentSpan } from "@/lib/trainings";

export type TrainingRosterEmployee = EmploymentSpan & {
  driver_id: string;
  name: string;
  rank: string | null;
  email: string | null;
};

export async function loadTrainingRoster(): Promise<TrainingRosterEmployee[]> {
  const [{ data: drivers, error: dErr }, { data: profiles, error: pErr }] =
    await Promise.all([
      supabaseAdmin
        .from("drivers")
        .select("id, name, rank, is_active, created_at"),
      supabaseAdmin
        .from("employee_profiles")
        .select("driver_id, employment_status, email, join_date, resignation_date"),
    ]);
  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);

  type Prof = {
    status: string;
    email: string | null;
    joinDate: string | null;
    resignationDate: string | null;
  };
  const profByDriver = new Map<string, Prof>();
  for (const p of profiles ?? []) {
    const r = p as Record<string, unknown>;
    profByDriver.set(String(r.driver_id ?? ""), {
      status: String(r.employment_status ?? "active"),
      email: (r.email as string | null) ?? null,
      joinDate: (r.join_date as string | null) ?? null,
      resignationDate: (r.resignation_date as string | null) ?? null,
    });
  }

  const rows: (TrainingRosterEmployee & { created: string })[] = [];
  for (const d of drivers ?? []) {
    const r = d as Record<string, unknown>;
    const id = String(r.id ?? "");
    if (r.is_active === false) continue;
    const prof = profByDriver.get(id);
    if (prof?.status === "resigned") continue;
    rows.push({
      driver_id: id,
      name: String(r.name ?? ""),
      rank: (r.rank as string | null) ?? null,
      email: prof?.email ?? null,
      joinDate: prof?.joinDate ?? null,
      resignationDate: prof?.resignationDate ?? null,
      created: String(r.created_at ?? ""),
    });
  }
  rows.sort((a, b) => a.created.localeCompare(b.created));
  return rows.map((r) => ({
    driver_id: r.driver_id,
    name: r.name,
    rank: r.rank,
    email: r.email,
    joinDate: r.joinDate,
    resignationDate: r.resignationDate,
  }));
}
