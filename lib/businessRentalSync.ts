// =====================================================================
// 홈페이지 대관 → 사업실적 자동 반입 (김혜지 팀장 요청 2026-10)
//
//   같은 대관 정보를 홈페이지·사업실적에 두 번 입력하던 것을 없앱니다.
//   rental_reservations(매일 새벽 대관 동기화 Cron 이 복제) 를 사업 연결
//   (business_program_rental_links) 에 따라 월 1행으로 집계해
//   business_results 에 채웁니다. 담당자가 고친 값은 덮지 않습니다.
//
//   ★ 행 처리 규칙 (가장 중요)
//     a. 자동 행 없음 + 같은 사업·연·월에 수기 행(source_type 없음) 있음
//        → 만들지 않음(skippedExistingManual). 7~9월 수기 실적과 중복 방지.
//     b. 자동 행 없음 + 그 달 예약 0건 → 만들지 않음(skippedEmpty).
//     c. 자동 행 없음 → 새로 생성(status='draft').
//     d. 자동 행 + 제출(submitted) → 숫자 그대로, snapshot 만 갱신.
//     e. 자동 행 + 수기 수정(manual_override) → 숫자 그대로, snapshot 만 갱신.
//     f. 자동 행 + 둘 다 아님 → 숫자·세부행 전체 갱신. 예약이 0건이 됐으면
//        (전부 취소) 행 삭제.
//
//   * 쓰기는 lib/businessResultsWrite 를 씁니다(화면 저장과 같은 경로).
//   * 실패는 throw 하지 않고 errors[] 에 사유를 담아 돌려줍니다.
//   * "use server" 아님 — Cron 라우트/서버 액션이 각자 인증 후 호출.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { RENTAL_TABLE } from "@/lib/rental";
import { kstTodayYmd } from "@/lib/trainings";
import {
  deleteBusinessResultRow,
  replaceResultDetailRows,
  writeBusinessResultRow,
  type ResultDetailInput,
} from "@/lib/businessResultsWrite";

export const RENTAL_SOURCE_TYPE = "rental";
export const RENTAL_AUTHOR_NAME = "자동(홈페이지 대관)";
export const RENTAL_LINK_TABLE = "business_program_rental_links";

export type RentalLink = {
  id: string;
  program_id: string;
  rental_program_name: string;
  rental_space_name: string | null;
  count_mode: "date" | "session";
  default_audience: "youth" | "other";
  start_month: string; // "YYYY-MM-01"
  is_active: boolean;
  created_by: string | null;
};

export type RentalSnapshot = {
  sessions: number;
  operating_days: number;
  participants: number;
  dates: string[];
  synced_at: string;
};

export type RentalSyncAction =
  | "created"
  | "updated"
  | "snapshotOnly"
  | "deleted"
  | "skippedExistingManual"
  | "skippedEmpty"
  | "skippedBeforeStart"
  | "error";

export type RentalSyncItem = {
  linkId: string;
  programName: string;
  month: string; // "YYYY-MM"
  action: RentalSyncAction;
  reason?: string;
  sessions: number;
  operating_days: number;
  participants: number;
  youth_uses: number;
  other_uses: number;
  // 세부행 실별인원 합계 — 본 행 실인원과 같아야 합니다(검증용).
  room_youth: number;
  room_other: number;
};

export type RentalResultSyncSummary = {
  year: number;
  month: number;
  dryRun: boolean;
  created: number;
  updated: number;
  snapshotOnly: number;
  deleted: number;
  skippedExistingManual: number;
  skippedEmpty: number;
  errors: string[];
  items: RentalSyncItem[];
};

const p2 = (n: number) => String(n).padStart(2, "0");

// 한국시간 기준 월 → 대관일(date) 범위 [start, end).
//   reservation_date 는 시각 없는 날짜라 문자열 비교로 충분합니다.
function monthRange(year: number, month: number) {
  const start = `${year}-${p2(month)}-01`;
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { start, end: `${next.y}-${p2(next.m)}-01` };
}

// 한국시간 오늘 기준 이번 달·지난달 — Cron 이 두 달을 돌립니다
//   (확정 후 취소된 예약을 지난달 실적에도 반영 — 업체 권고).
export function kstCurrentAndPreviousMonth(): { year: number; month: number }[] {
  const [y, m] = kstTodayYmd().split("-").map(Number);
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  return [{ year: y, month: m }, prev];
}

export function rentalSourceKey(linkId: string, year: number, month: number) {
  return `${linkId}:${year}-${p2(month)}`;
}

// source_key → 연결 id·연·월. 형식이 다르면 null.
export function parseRentalSourceKey(
  key: string | null | undefined,
): { linkId: string; year: number; month: number } | null {
  const m = /^(.+):(\d{4})-(\d{2})$/.exec(key ?? "");
  if (!m) return null;
  return { linkId: m[1], year: Number(m[2]), month: Number(m[3]) };
}

type Reservation = {
  reservation_date: string;
  space_name: string | null;
  program_name: string | null;
  person_total: number | null;
};

// LIKE 패턴 특수문자 이스케이프 — 후보를 좁히는 용도이고 최종 일치는 JS 에서 봅니다.
function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function loadReservations(
  link: RentalLink,
  year: number,
  month: number,
): Promise<Reservation[]> {
  const name = link.rental_program_name.trim();
  const space = (link.rental_space_name ?? "").trim();
  const { start, end } = monthRange(year, month);
  const { data, error } = await supabaseAdmin
    .from(RENTAL_TABLE)
    .select("reservation_date,space_name,program_name,person_total")
    .eq("status", "Y")
    .gte("reservation_date", start)
    .lt("reservation_date", end)
    .ilike("program_name", `%${likeEscape(name)}%`)
    .order("reservation_date")
    .limit(5000);
  if (error) throw new Error(`대관 예약 조회 실패: ${error.message}`);
  return ((data ?? []) as Reservation[]).filter(
    (r) =>
      (r.program_name ?? "").trim() === name &&
      (!space || (r.space_name ?? "").trim() === space),
  );
}

type Aggregate = {
  sessions: number;
  operating_days: number;
  participants: number;
  dates: string[];
  details: ResultDetailInput[];
};

function aggregate(link: RentalLink, rows: Reservation[]): Aggregate {
  const sorted = [...rows].sort((a, b) =>
    a.reservation_date.localeCompare(b.reservation_date),
  );
  const youth = link.default_audience !== "other";
  const label = [link.rental_program_name.trim(), link.rental_space_name?.trim()]
    .filter(Boolean)
    .join(" · ");
  // 실별인원도 참가인원과 같은 값 — 김혜지 수기 실적과 같은 방식이고, 비워 두면
  //   청소년 이용 비율 집계가 자동 행에서만 어긋납니다(관장 결정 2026-10).
  const persons = (n: number) => ({
    participants_youth: youth ? n : 0,
    participants_other: youth ? 0 : n,
    room_youth: youth ? n : 0,
    room_other: youth ? 0 : n,
  });

  const byDate = new Map<string, number>();
  for (const r of sorted) {
    byDate.set(
      r.reservation_date,
      (byDate.get(r.reservation_date) ?? 0) + (Number(r.person_total) || 0),
    );
  }
  const dates = [...byDate.keys()];
  const participants = sorted.reduce(
    (sum, r) => sum + (Number(r.person_total) || 0),
    0,
  );

  const details: ResultDetailInput[] =
    link.count_mode === "session"
      ? sorted.map((r, i) => ({
          entry_type: "session",
          entry_date: null,
          session_no: i + 1,
          session_days: 1,
          content: `${r.reservation_date.slice(5).replace("-", "/")} ${label}`,
          ...persons(Number(r.person_total) || 0),
        }))
      : dates.map((d) => ({
          entry_type: "date",
          entry_date: d,
          session_no: null,
          session_days: null,
          content: label,
          ...persons(byDate.get(d) ?? 0),
        }));

  return {
    sessions: link.count_mode === "session" ? sorted.length : dates.length,
    operating_days: dates.length,
    participants,
    dates,
    details,
  };
}

// 숫자 칸 — participants = attendance = 실인원(youth_uses/other_uses).
//   기본 구분(청소년/기타)에 전부 넣습니다.
function numberFields(link: RentalLink, agg: Aggregate) {
  const youth = link.default_audience !== "other";
  const n = agg.participants;
  return {
    sessions: agg.sessions,
    operating_days: agg.operating_days,
    participants: n,
    participants_youth: youth ? n : 0,
    participants_other: youth ? 0 : n,
    attendance: n,
    attendance_youth: youth ? n : 0,
    attendance_other: youth ? 0 : n,
    youth_uses: youth ? n : 0,
    other_uses: youth ? 0 : n,
  };
}

type ExistingRow = {
  id: string;
  status: string;
  manual_override: boolean;
};

export async function syncRentalToBusinessResults(opts: {
  year: number;
  month: number;
  dryRun?: boolean;
  ignoreStartMonth?: boolean;
  // 한 연결만(되돌리기 버튼의 그 행 재동기화).
  linkId?: string;
}): Promise<RentalResultSyncSummary> {
  const { year, month } = opts;
  const dryRun = Boolean(opts.dryRun);
  const ym = `${year}-${p2(month)}`;
  const summary: RentalResultSyncSummary = {
    year,
    month,
    dryRun,
    created: 0,
    updated: 0,
    snapshotOnly: 0,
    deleted: 0,
    skippedExistingManual: 0,
    skippedEmpty: 0,
    errors: [],
    items: [],
  };

  let linkQuery = supabaseAdmin
    .from(RENTAL_LINK_TABLE)
    .select("*")
    .eq("is_active", true);
  if (opts.linkId) linkQuery = linkQuery.eq("id", opts.linkId);
  const { data: linkData, error: linkError } = await linkQuery;
  if (linkError) {
    summary.errors.push(`대관 연결 조회 실패: ${linkError.message}`);
    return summary;
  }
  const links = (linkData ?? []) as RentalLink[];
  if (links.length === 0) return summary;

  // 사업 등록 정보(사업명·분야) — 새 행의 program_name·category 원본.
  const { data: programData, error: programError } = await supabaseAdmin
    .from("business_programs")
    .select("id,name,category_id")
    .in("id", [...new Set(links.map((l) => l.program_id))]);
  if (programError) {
    summary.errors.push(`사업 등록 정보 조회 실패: ${programError.message}`);
    return summary;
  }
  const programs = (programData ?? []) as {
    id: string;
    name: string;
    category_id: string;
  }[];
  const { data: categoryData, error: categoryError } = await supabaseAdmin
    .from("business_categories")
    .select("id,name")
    .in("id", [...new Set(programs.map((p) => p.category_id))]);
  if (categoryError) {
    summary.errors.push(`분야 조회 실패: ${categoryError.message}`);
    return summary;
  }
  const categoryName = new Map(
    ((categoryData ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  );
  const programById = new Map(programs.map((p) => [p.id, p]));

  for (const link of links) {
    const program = programById.get(link.program_id);
    const item: RentalSyncItem = {
      linkId: link.id,
      programName: program?.name ?? link.rental_program_name,
      month: ym,
      action: "error",
      sessions: 0,
      operating_days: 0,
      participants: 0,
      youth_uses: 0,
      other_uses: 0,
      room_youth: 0,
      room_other: 0,
    };
    summary.items.push(item);
    const fail = (reason: string) => {
      item.action = "error";
      item.reason = reason;
      summary.errors.push(`[${item.programName} ${ym}] ${reason}`);
    };

    try {
      if (!program) {
        fail("연결된 사업이 등록 목록에 없습니다.");
        continue;
      }
      if (!opts.ignoreStartMonth && `${ym}-01` < link.start_month.slice(0, 10)) {
        item.action = "skippedBeforeStart";
        continue;
      }

      const agg = aggregate(link, await loadReservations(link, year, month));
      item.sessions = agg.sessions;
      item.operating_days = agg.operating_days;
      item.participants = agg.participants;
      const nums = numberFields(link, agg);
      item.youth_uses = nums.youth_uses;
      item.other_uses = nums.other_uses;
      item.room_youth = agg.details.reduce((a, d) => a + d.room_youth, 0);
      item.room_other = agg.details.reduce((a, d) => a + d.room_other, 0);

      const now = new Date().toISOString();
      const snapshot: RentalSnapshot = {
        sessions: agg.sessions,
        operating_days: agg.operating_days,
        participants: agg.participants,
        dates: agg.dates,
        synced_at: now,
      };
      const sourceKey = rentalSourceKey(link.id, year, month);

      const { data: autoData, error: autoError } = await supabaseAdmin
        .from("business_results")
        .select("id,status,manual_override")
        .eq("source_type", RENTAL_SOURCE_TYPE)
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (autoError) throw new Error(autoError.message);
      const existing = autoData as ExistingRow | null;

      if (!existing) {
        // 규칙 a — 같은 사업·연·월의 수기 행이 있으면 만들지 않습니다.
        const { data: manual, error: manualError } = await supabaseAdmin
          .from("business_results")
          .select("id")
          .eq("program_id", link.program_id)
          .eq("report_year", year)
          .eq("report_month", month)
          .is("source_type", null)
          .limit(1);
        if (manualError) throw new Error(manualError.message);
        if ((manual ?? []).length > 0) {
          item.action = "skippedExistingManual";
          summary.skippedExistingManual += 1;
          continue;
        }
        // 규칙 b — 빈 행 금지.
        if (agg.dates.length === 0) {
          item.action = "skippedEmpty";
          summary.skippedEmpty += 1;
          continue;
        }
        // 규칙 c — 새로 생성.
        item.action = "created";
        summary.created += 1;
        if (dryRun) continue;
        const id = await writeBusinessResultRow(null, {
          report_year: year,
          report_month: month,
          category: categoryName.get(program.category_id) ?? "기타",
          program_id: program.id,
          program_name: program.name,
          manager_name: "",
          ...numberFields(link, agg),
          status: "draft",
          author_name: RENTAL_AUTHOR_NAME,
          updated_by: RENTAL_AUTHOR_NAME,
          source_type: RENTAL_SOURCE_TYPE,
          source_key: sourceKey,
          manual_override: false,
          source_snapshot: snapshot,
          source_synced_at: now,
        });
        if (!id) throw new Error("생성한 실적 행을 찾을 수 없습니다.");
        if (!(await replaceResultDetailRows(id, agg.details)))
          throw new Error("세부입력 테이블이 아직 적용되지 않았습니다.");
        continue;
      }

      // 규칙 d·e — 제출됐거나 사람이 고친 행은 숫자를 건드리지 않습니다.
      if (existing.status === "submitted" || existing.manual_override) {
        item.action = "snapshotOnly";
        summary.snapshotOnly += 1;
        if (dryRun) continue;
        await writeBusinessResultRow(existing.id, {
          source_snapshot: snapshot,
          source_synced_at: now,
        });
        continue;
      }

      // 규칙 f — 전부 취소돼 0건이 되면 행을 지웁니다.
      if (agg.dates.length === 0) {
        item.action = "deleted";
        summary.deleted += 1;
        if (dryRun) continue;
        await deleteBusinessResultRow(existing.id);
        continue;
      }

      item.action = "updated";
      summary.updated += 1;
      if (dryRun) continue;
      await writeBusinessResultRow(existing.id, {
        ...numberFields(link, agg),
        updated_by: RENTAL_AUTHOR_NAME,
        updated_at: now,
        source_snapshot: snapshot,
        source_synced_at: now,
      });
      if (!(await replaceResultDetailRows(existing.id, agg.details)))
        throw new Error("세부입력 테이블이 아직 적용되지 않았습니다.");
    } catch (e) {
      // 이미 올려 둔 카운트는 되돌립니다 — 실패한 건이 성공으로 집계되지 않게.
      if (item.action !== "error" && item.action !== "skippedBeforeStart") {
        const key = item.action as Exclude<
          RentalSyncAction,
          "error" | "skippedBeforeStart"
        >;
        summary[key] -= 1;
      }
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  return summary;
}

// 로그·토스트용 한 줄 요약.
export function formatRentalSyncSummary(s: RentalResultSyncSummary): string {
  return (
    `${s.year}-${p2(s.month)}${s.dryRun ? "(dryRun)" : ""} · ` +
    `생성 ${s.created} · 갱신 ${s.updated} · 값보존 ${s.snapshotOnly} · ` +
    `삭제 ${s.deleted} · 수기있음 ${s.skippedExistingManual} · ` +
    `예약없음 ${s.skippedEmpty}` +
    (s.errors.length > 0 ? ` · 오류 ${s.errors.join(" / ")}` : "")
  );
}
