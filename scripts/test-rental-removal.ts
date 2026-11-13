// 홈페이지에서 삭제된 대관예약 표시(removed_at) — 판정 규칙 시험(DB·API 접근 없음).
//   실행: node --import tsx scripts/test-rental-removal.ts
//
//   ① 응답에 없는 살아 있는 행만 표시 대상
//   ② 이미 표시된 행이 다시 나타나면 '해제' 대상
//   ③ 응답 0건 / 잘린 구간이 있으면 표시하지 않음
//   ④ 20% 초과로 사라지면 표시하지 않고 overLimit(관장 DM)
//   ⑤ 사업실적 재계산 월 = 이번 달·지난달 + 표시·해제가 일어난 달
//   ⑥ 대관 → DB 행 변환이 removed_at=null 을 실어 보내는지(다시 나타나면 해제)

import { readFileSync } from "node:fs";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  // lib/supabaseAdmin 이 import 시점에 환경변수를 읽으므로 먼저 채웁니다(접속은 안 함).
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const { planRemoval } = await import("../lib/rentalSync");
  const { rentalResultSyncMonths, kstCurrentAndPreviousMonth } = await import(
    "../lib/businessRentalSync"
  );
  const { toRentalUpsert } = await import("../lib/rental");

  const row = (no: number, date: string, removed: string | null = null) => ({
    reservation_no: no,
    reservation_date: date,
    removed_at: removed,
  });
  // 살아 있는 10건(1~10) + 이미 표시된 2건(11·12)
  const existing = [
    ...Array.from({ length: 10 }, (_, i) => row(i + 1, `2026-0${i < 5 ? 8 : 9}-15`)),
    row(11, "2026-07-01", "2026-11-01T00:00:00Z"),
    row(12, "2026-10-01", "2026-11-01T00:00:00Z"),
  ];

  // ①② 1·2 가 사라지고 11 이 다시 나타남
  const seen = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const p = planRemoval(existing, seen, { fetched: 9, incomplete: [] });
  chk(
    "사라진 살아 있는 행만 표시",
    p.toRemove.map((r) => r.reservation_no).join(",") === "1,2" && !p.skipped,
    `toRemove=${p.toRemove.map((r) => r.reservation_no)}`,
  );
  chk(
    "다시 나타난 표시 행은 해제 대상",
    p.restored.map((r) => r.reservation_no).join(",") === "11",
  );
  chk("이미 표시된 채 계속 없는 행(12)은 건드리지 않음", !p.toRemove.some((r) => r.reservation_no === 12));
  chk("2/10 = 20% 는 경계 안(표시함)", p.toRemove.length === 2 && !p.overLimit);

  // ③ 0건 / 잘린 구간
  const zero = planRemoval(existing, new Set(), { fetched: 0, incomplete: [] });
  chk("응답 0건이면 표시 안 함", zero.toRemove.length === 0 && zero.skipped === "응답 0건");
  const cut = planRemoval(existing, seen, { fetched: 9, incomplete: ["2026-08-15"] });
  chk("잘린 구간 있으면 표시 안 함", cut.toRemove.length === 0 && !!cut.skipped && !cut.overLimit);

  // ④ 3/10 = 30% → 경고
  const many = planRemoval(existing, new Set([4, 5, 6, 7, 8, 9, 10]), {
    fetched: 7,
    incomplete: [],
  });
  chk(
    "20% 초과면 표시 안 하고 경고",
    many.toRemove.length === 0 && many.overLimit && many.missing === 3 && many.active === 10,
    many.skipped ?? "",
  );

  // ⑤ 재계산 월
  const base = kstCurrentAndPreviousMonth().map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);
  const months = rentalResultSyncMonths(["2026-08", "2026-09", base[0]]).map(
    (m) => `${m.year}-${String(m.month).padStart(2, "0")}`,
  );
  chk(
    "이번 달·지난달 + 바뀐 달(중복 없이)",
    months.slice(0, 2).join() === base.join() &&
      months.includes("2026-08") &&
      months.includes("2026-09") &&
      new Set(months).size === months.length,
    months.join(", "),
  );
  chk("바뀐 달이 없으면 이번 달·지난달만", rentalResultSyncMonths().length === 2);

  // ⑥ upsert 행
  const up = toRentalUpsert(
    { reservation_no: "1", reservation_date: "2026-10-01", status: "Y" },
    new Date().toISOString(),
  );
  chk("upsert 행에 removed_at=null", up?.removed_at === null);

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
