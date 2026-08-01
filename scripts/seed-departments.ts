// 부서 정리 시드 — DP-1 ②
//   실행: npx tsx scripts/seed-departments.ts            (미리보기, 쓰기 없음)
//         npx tsx scripts/seed-departments.ts --apply    (실제 기입)
//
//   왜 스크립트인가:
//     부서는 employee_profiles.appointments jsonb 안의 필드라 SQL 마이그레이션으로
//     다루려면 jsonb 조작을 손으로 써야 하고, 대상이 이름으로 지정돼 있어
//     drivers 조인이 필요하다. 앱과 같은 정규화 함수(normalizeAppointmentList)를
//     그대로 쓰는 편이 형태 불일치 위험이 없어 스크립트로 처리한다.
//
//   안전장치:
//     · 기본은 미리보기. --apply 를 줘야 쓴다.
//     · 대상 9명 외에는 절대 건드리지 않는다(DENY 목록으로 이중 확인).
//     · 이미 같은 시드가 있으면 건너뛴다(여러 번 실행해도 안전).
//     · is_locked 프로필은 건너뛰고 보고한다(앱 규칙과 동일).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeAppointmentList,
  type EmployeeAppointment,
} from "../lib/supabase";

const APPLY = process.argv.includes("--apply");

const EFFECTIVE_DATE = "2026-01-01";
const NOTE = "부서 정리(시스템 도입)";
const TYPE = "전보" as const; // 배치·전보에 해당하는 기존 AppointmentType

// 이름 → 부서.
const TARGETS: Record<string, string> = {
  김혜지: "교육문화사업팀",
  한지형: "교육문화사업팀",
  박준우: "청소년사업팀",
  김준호: "청소년사업팀",
  박병현: "청소년사업팀",
  김민정: "청소년사업팀",
  김소연: "방과후아카데미팀",
  권수현: "방과후아카데미팀",
  정다영: "방과후아카데미팀",
};

// 절대 건드리지 않을 사람 — 이미 발령이 있거나(이민정·정소연),
// 팀 소속이 없는 자리(허일수 관장·노미현 부장).
const DENY = new Set(["이민정", "정소연", "허일수", "노미현"]);

function env(): { url: string; key: string } {
  const e: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return { url: e.NEXT_PUBLIC_SUPABASE_URL, key: e.SUPABASE_SERVICE_ROLE_KEY };
}

async function main() {
  const { url, key } = env();
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const names = Object.keys(TARGETS);
  for (const n of names) {
    if (DENY.has(n)) throw new Error(`대상과 제외 목록이 충돌합니다: ${n}`);
  }

  const { data: drivers, error: dErr } = await sb
    .from("drivers")
    .select("id, name, rank, is_active");
  if (dErr) throw new Error(dErr.message);
  const { data: profs, error: pErr } = await sb
    .from("employee_profiles")
    .select("driver_id, appointments, is_locked");
  if (pErr) throw new Error(pErr.message);
  const profByDriver = new Map(
    (profs ?? []).map((p) => [
      String((p as { driver_id: string }).driver_id),
      p as { appointments: unknown; is_locked: boolean | null },
    ])
  );

  console.log(
    APPLY ? "=== 적용 모드(--apply) ===" : "=== 미리보기 (쓰기 없음) ==="
  );
  console.log(
    `발령 ${TYPE} · 발령일 ${EFFECTIVE_DATE} · 비고 "${NOTE}" · 직위는 drivers.rank 그대로\n`
  );

  let added = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const name of names) {
    const dept = TARGETS[name];
    const drv = (drivers ?? []).find(
      (d) => String((d as { name: string }).name) === name
    ) as { id: string; name: string; rank: string | null; is_active: boolean } | undefined;

    if (!drv) {
      problems.push(`${name}: drivers 에 없음`);
      continue;
    }
    if (drv.is_active === false) {
      problems.push(`${name}: 비활성 직원`);
      continue;
    }
    const prof = profByDriver.get(drv.id);
    if (!prof) {
      problems.push(`${name}: employee_profiles 행 없음(먼저 인사기록 생성 필요)`);
      continue;
    }
    if (prof.is_locked === true) {
      problems.push(`${name}: 인사기록 잠김(is_locked) — 건너뜀`);
      continue;
    }

    const current = normalizeAppointmentList(prof.appointments);
    // 같은 시드가 이미 있으면 건너뛴다.
    const dup = current.some(
      (a) =>
        a.effective_date === EFFECTIVE_DATE &&
        a.department === dept &&
        a.note === NOTE
    );
    if (dup) {
      console.log(`  · ${name.padEnd(4)} 이미 시드 있음 → 건너뜀`);
      skipped++;
      continue;
    }

    const entry: EmployeeAppointment = {
      type: TYPE,
      title: (drv.rank ?? "").trim(),
      department: dept,
      effective_date: EFFECTIVE_DATE,
      note: NOTE,
    };
    const next = normalizeAppointmentList([...current, entry]);

    console.log(
      `  + ${name.padEnd(4)} ${dept.padEnd(10)} 직위 "${entry.title}" (기존 발령 ${current.length}건 → ${next.length}건)`
    );

    if (APPLY) {
      const { error } = await sb
        .from("employee_profiles")
        .update({ appointments: next, updated_at: new Date().toISOString() })
        .eq("driver_id", drv.id);
      if (error) {
        problems.push(`${name}: 저장 실패 — ${error.message}`);
        continue;
      }
    }
    added++;
  }

  console.log(
    `\n${APPLY ? "기입" : "기입 예정"} ${added}명 · 건너뜀 ${skipped}명 · 문제 ${problems.length}건`
  );
  for (const p of problems) console.log(`  ⚠ ${p}`);
  if (!APPLY)
    console.log("\n실제로 반영하려면: npx tsx scripts/seed-departments.ts --apply");
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
