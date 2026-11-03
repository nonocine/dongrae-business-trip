// 대관 연결 방식(contains · 공간 기준 '*') + 중복 예약 1곳 반영 — 라이브 검증(읽기 전용).
//   실행: node --import tsx scripts/test-rental-link-match.ts
//
//   ① contains — '밥 해달레'·'달달해' 가 10월 예약을 찾는지(DB LIKE 결과와 비교).
//   ② 공간 기준 — '*' + "온나 스낵존, 온나 노래방" 이 프로그램명 빈 room 예약을 찾는지.
//   ③ 같은 예약이 두 연결에 걸리면 먼저 만든 연결에만 반영 + 경고.
//   ④ 기존 exact 연결의 판정이 그대로인지(정확히 같은 이름만, contains 아님).
//
//   ⚠️ 아무것도 쓰지 않습니다. 연결은 메모리 안의 가짜 연결입니다.

import { readFileSync } from "node:fs";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const {
    loadReservations,
    assignReservations,
    reservationMatchesLink,
    rentalMatchKind,
  } = await import("../lib/businessRentalSync");
  type Link = Parameters<typeof loadReservations>[0];
  const base = (over: Partial<Link>): Link => ({
    id: "test",
    program_id: "p",
    rental_program_name: "",
    rental_space_name: null,
    match_mode: "exact",
    count_mode: "session",
    default_audience: "youth",
    start_month: "2026-01-01",
    is_active: true,
    created_by: null,
    created_at: "2026-11-03T00:00:00Z",
    ...over,
  });

  // ①
  for (const name of ["밥 해달레", "달달해"]) {
    const rows = await loadReservations(
      base({ rental_program_name: name, match_mode: "contains" }),
      2026,
      10,
    );
    chk(
      `contains '${name}' → 10월 예약 찾음`,
      rows.length > 0 && rows.every((r) => (r.program_name ?? "").includes(name)),
      rows.map((r) => r.program_name).join(" | "),
    );
  }
  const exactMiss = await loadReservations(
    base({ rental_program_name: "밥 해달레" }),
    2026,
    10,
  );
  chk("exact '밥 해달레' → 0건(부분 일치는 안 잡음)", exactMiss.length === 0);

  // ②
  const spaceLink = base({
    id: "space",
    rental_program_name: "*",
    rental_space_name: "온나 스낵존, 온나 노래방",
  });
  chk("'*' + 공간명 → space", rentalMatchKind(spaceLink) === "space");
  chk(
    "'*' + 공간명 없음 → 잘못된 연결(null)",
    rentalMatchKind(base({ rental_program_name: "*" })) === null,
  );
  chk(
    "빈 이름 + 공간명 → space",
    rentalMatchKind(base({ rental_program_name: "", rental_space_name: "A" })) ===
      "space",
  );
  const spaceRows = await loadReservations(spaceLink, 2026, 10);
  const bySpace = new Map<string, number>();
  for (const r of spaceRows)
    bySpace.set(r.space_name ?? "", (bySpace.get(r.space_name ?? "") ?? 0) + 1);
  // 2026-11-03 DB 직접 조회: 스낵존 449건 · 노래방 107건(프로그램명 빈 room, 확정).
  chk(
    "공간 기준 10월 — 온나 스낵존 449 · 온나 노래방 107",
    bySpace.get("온나 스낵존") === 449 && bySpace.get("온나 노래방") === 107,
    JSON.stringify(Object.fromEntries(bySpace)),
  );
  chk(
    "공간 기준 — 모두 room·프로그램명 빈 예약",
    spaceRows.every(
      (r) => r.reservation_type === "room" && !(r.program_name ?? "").trim(),
    ),
  );
  chk(
    "공간 기준 — 프로그램명 있는 room 예약은 제외",
    !reservationMatchesLink(spaceLink, {
      reservation_type: "room",
      space_name: "온나 스낵존",
      program_name: "어떤 프로그램",
    }),
  );
  chk(
    "공간 기준 — rental(시설 대관) 예약은 제외",
    !reservationMatchesLink(spaceLink, {
      reservation_type: "rental",
      space_name: "온나 스낵존",
      program_name: "",
    }),
  );

  // ③
  const early = base({ id: "a", created_at: "2026-10-01T00:00:00Z", rental_program_name: "A" });
  const late = base({ id: "b", created_at: "2026-11-01T00:00:00Z", rental_program_name: "B" });
  const r = (n: number) => ({
    reservation_no: n,
    reservation_date: "2026-10-05",
    program_name: "x",
    space_name: "y",
  });
  // 늦게 만든 연결을 먼저 넘겨도 먼저 만든 연결이 가져가야 합니다.
  const { rowsByLink, warnings } = assignReservations(
    [
      { link: late, rows: [r(1), r(2)] },
      { link: early, rows: [r(2), r(3)] },
    ],
    "2026-10",
  );
  chk(
    "겹친 예약 2 → 먼저 만든 연결 A 에만",
    rowsByLink.get("a")?.map((x) => x.reservation_no).join() === "2,3" &&
      rowsByLink.get("b")?.map((x) => x.reservation_no).join() === "1",
  );
  chk("겹침 경고 1건", warnings.length === 1, warnings.join(" / "));

  // ④
  const exact = base({ rental_program_name: "시설 대관" });
  chk(
    "exact — 같은 이름만",
    reservationMatchesLink(exact, { reservation_type: "rental", space_name: "x", program_name: " 시설 대관 " }) &&
      !reservationMatchesLink(exact, { reservation_type: "rental", space_name: "x", program_name: "시설 대관 2" }),
  );
  chk(
    "match_mode 없음(컬럼 추가 전) → exact",
    rentalMatchKind({ ...exact, match_mode: undefined }) === "exact",
  );

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
