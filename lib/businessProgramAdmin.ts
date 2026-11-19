// 사업실적 [프로그램 관리] — 서버 전용 조회·쓰기 도우미.
//   권한 검사는 부르는 서버 액션이 합니다(관리자 = 관장·master, isManagerAdmin).
//   새 칸(manager_driver_id·aliases·note·updated_at)과 '프로그램 아님' 테이블은
//   supabase/migrations/business_program_admin.sql 적용 전에도 화면이 열리도록
//   없으면 빈 값으로 읽고, 쓰기만 막습니다.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  appendAlias,
  hasSameNameKey,
  monthRangeLabel,
  programNameKey,
} from "@/lib/businessProgramNames";
import { RENTAL_LINK_TABLE, type RentalLink } from "@/lib/businessRentalSync";

export const EXCLUSION_TABLE = "business_program_name_exclusions";

export type AdminProgram = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  manager_driver_id: string | null;
  aliases: string[];
  note: string;
  updated_at: string | null;
};

export type UnregisteredGroup = {
  key: string;
  // 실제 입력된 이름들(많은 순) — 연결은 이 이름들 전부에 걸립니다.
  variants: { name: string; count: number }[];
  count: number;
  range: string; // "2026년 1~5월"
  // 이름(공백·따옴표 무시)이나 다른 이름이 같은 등록 프로그램 — 연결 추천.
  suggestedProgramId: string | null;
};

export type ProgramAdminData = {
  configured: boolean; // 레지스트리 테이블
  extended: boolean; // 새 칸 적용 여부
  exclusionsConfigured: boolean;
  year: number;
  categories: { id: string; name: string; sort_order: number; is_active: boolean }[];
  programs: AdminProgram[];
  drivers: { id: string; name: string; is_active: boolean }[];
  yearCounts: Record<string, number>;
  groups: UnregisteredGroup[];
  excluded: { key: string; name: string; count: number }[];
  rentalLinks: RentalLink[];
};

type PgError = { code?: string; message?: string } | null;
function tableMissing(e: PgError) {
  return e?.code === "42P01" || !!e?.message?.includes("schema cache");
}
function columnMissing(e: PgError) {
  return (
    e?.code === "42703" ||
    (!!e?.message?.includes("column") && !!e?.message?.includes("does not exist"))
  );
}

const BASE_COLS = "id,category_id,name,sort_order,is_active";
const EXT_COLS = `${BASE_COLS},manager_driver_id,aliases,note,updated_at`;

export async function loadAdminPrograms(): Promise<{
  configured: boolean;
  extended: boolean;
  programs: AdminProgram[];
}> {
  let extended = true;
  let res: { data: unknown; error: PgError } = await supabaseAdmin
    .from("business_programs")
    .select(EXT_COLS)
    .order("sort_order")
    .order("name");
  if (columnMissing(res.error)) {
    extended = false;
    res = await supabaseAdmin
      .from("business_programs")
      .select(BASE_COLS)
      .order("sort_order")
      .order("name");
  }
  if (tableMissing(res.error))
    return { configured: false, extended: false, programs: [] };
  if (res.error) throw new Error(res.error.message);
  const programs = ((res.data ?? []) as unknown as Record<string, unknown>[]).map(
    (r) => ({
      id: String(r.id),
      category_id: String(r.category_id),
      name: String(r.name ?? ""),
      sort_order: Number(r.sort_order ?? 0),
      is_active: r.is_active !== false,
      manager_driver_id: (r.manager_driver_id as string | null) ?? null,
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
      note: String(r.note ?? ""),
      updated_at: (r.updated_at as string | null) ?? null,
    }),
  );
  return { configured: true, extended, programs };
}

async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError }>,
): Promise<{ rows: T[]; error: PgError }> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) return { rows, error };
    const list = (data ?? []) as T[];
    rows.push(...list);
    if (list.length < PAGE) break;
  }
  return { rows, error: null };
}

export async function loadProgramAdminData(year: number): Promise<ProgramAdminData> {
  const [{ configured, extended, programs }, categoryRes, driverRes] =
    await Promise.all([
      loadAdminPrograms(),
      supabaseAdmin
        .from("business_categories")
        .select("id,name,sort_order,is_active")
        .order("sort_order")
        .order("name"),
      supabaseAdmin
        .from("drivers")
        .select("id,name,is_active")
        .order("name"),
    ]);
  const empty: ProgramAdminData = {
    configured: false,
    extended: false,
    exclusionsConfigured: false,
    year,
    categories: [],
    programs: [],
    drivers: [],
    yearCounts: {},
    groups: [],
    excluded: [],
    rentalLinks: [],
  };
  if (!configured || tableMissing(categoryRes.error)) return empty;
  if (categoryRes.error) throw new Error(categoryRes.error.message);
  if (driverRes.error) throw new Error(driverRes.error.message);

  const [yearRows, unregRows, exclusionRes, linkRes] = await Promise.all([
    pagedSelect<{ program_id: string }>((a, b) =>
      supabaseAdmin
        .from("business_results")
        .select("program_id")
        .eq("report_year", year)
        .not("program_id", "is", null)
        .order("id")
        .range(a, b),
    ),
    pagedSelect<{ program_name: string; report_year: number; report_month: number }>(
      (a, b) =>
        supabaseAdmin
          .from("business_results")
          .select("program_name,report_year,report_month")
          .is("program_id", null)
          .order("id")
          .range(a, b),
    ),
    supabaseAdmin.from(EXCLUSION_TABLE).select("name_key,sample_name"),
    supabaseAdmin
      .from(RENTAL_LINK_TABLE)
      .select("*")
      .order("created_at"),
  ]);
  if (yearRows.error) throw new Error(yearRows.error.message ?? "");
  if (unregRows.error) throw new Error(unregRows.error.message ?? "");
  const exclusionsConfigured = !tableMissing(exclusionRes.error);
  if (exclusionRes.error && exclusionsConfigured)
    throw new Error(exclusionRes.error.message);
  if (linkRes.error && !tableMissing(linkRes.error))
    throw new Error(linkRes.error.message);

  const yearCounts: Record<string, number> = {};
  for (const r of yearRows.rows)
    yearCounts[r.program_id] = (yearCounts[r.program_id] ?? 0) + 1;

  const excludedKeys = new Map<string, string>();
  for (const r of (exclusionRes.data ?? []) as {
    name_key: string;
    sample_name: string;
  }[])
    excludedKeys.set(r.name_key, r.sample_name);

  // 이름(+다른 이름) 키 → 등록 프로그램. 사용 중인 프로그램을 먼저 고릅니다.
  const programByKey = new Map<string, string>();
  for (const p of [...programs].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active),
  ))
    for (const n of [p.name, ...p.aliases]) {
      const k = programNameKey(n);
      if (k && !programByKey.has(k)) programByKey.set(k, p.id);
    }

  type Acc = {
    names: Map<string, number>;
    count: number;
    min: number;
    max: number;
  };
  const acc = new Map<string, Acc>();
  for (const r of unregRows.rows) {
    const name = String(r.program_name ?? "").trim();
    const key = programNameKey(name);
    if (!key) continue;
    const ym = Number(r.report_year) * 100 + Number(r.report_month);
    const a = acc.get(key) ?? { names: new Map(), count: 0, min: ym, max: ym };
    a.names.set(r.program_name, (a.names.get(r.program_name) ?? 0) + 1);
    a.count += 1;
    a.min = Math.min(a.min, ym);
    a.max = Math.max(a.max, ym);
    acc.set(key, a);
  }
  const ymOf = (v: number) => ({ year: Math.floor(v / 100), month: v % 100 });
  const groups: UnregisteredGroup[] = [];
  const excluded: ProgramAdminData["excluded"] = [];
  for (const [key, a] of acc) {
    const variants = [...a.names.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, "ko"));
    if (excludedKeys.has(key)) {
      excluded.push({ key, name: variants[0].name, count: a.count });
      continue;
    }
    groups.push({
      key,
      variants,
      count: a.count,
      range: monthRangeLabel(ymOf(a.min), ymOf(a.max)),
      suggestedProgramId: programByKey.get(key) ?? null,
    });
  }
  groups.sort(
    (x, y) =>
      y.count - x.count || x.variants[0].name.localeCompare(y.variants[0].name, "ko"),
  );
  excluded.sort((x, y) => y.count - x.count);

  return {
    configured: true,
    extended,
    exclusionsConfigured,
    year,
    categories: (categoryRes.data ?? []) as ProgramAdminData["categories"],
    programs,
    drivers: (driverRes.data ?? []) as ProgramAdminData["drivers"],
    yearCounts,
    groups,
    excluded,
    rentalLinks: (linkRes.data ?? []) as RentalLink[],
  };
}

// 같은 분야 안 이름 중복 검사(공백·따옴표 무시). exceptId 는 수정 중인 자기 자신.
export async function assertUniqueProgramName(
  categoryId: string,
  name: string,
  exceptId?: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("business_programs")
    .select("id,name")
    .eq("category_id", categoryId);
  if (error) throw new Error(error.message);
  const others = ((data ?? []) as { id: string; name: string }[]).filter(
    (p) => p.id !== exceptId,
  );
  if (hasSameNameKey(others.map((p) => p.name), name))
    return "같은 분야에 같은 이름(공백·따옴표 차이 무시)의 프로그램이 이미 있습니다.";
  return null;
}

// 프로그램 수정 — 이름이 바뀌면 예전 이름을 aliases 에 자동으로 더합니다.
//   과거 실적(business_results.program_name)은 건드리지 않습니다(당시 이름 보존).
export async function updateProgramRow(
  id: string,
  patch: {
    name?: string;
    category_id?: string;
    sort_order?: number;
    is_active?: boolean;
    manager_driver_id?: string | null;
    aliases?: string[];
    note?: string;
  },
): Promise<string | null> {
  const { extended, programs } = await loadAdminPrograms();
  const current = programs.find((p) => p.id === id);
  if (!current) return "프로그램을 찾을 수 없습니다. 화면을 새로 고쳐주세요.";

  const row: Record<string, unknown> = {};
  const nextCategory = patch.category_id ?? current.category_id;
  if (patch.name !== undefined || patch.category_id !== undefined) {
    const nm = (patch.name ?? current.name).trim();
    if (!nm) return "프로그램 이름을 입력하세요.";
    const dup = await assertUniqueProgramName(nextCategory, nm, id);
    if (dup) return dup;
    row.name = nm;
    row.category_id = nextCategory;
  }
  if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;

  const wantsExtended =
    patch.manager_driver_id !== undefined ||
    patch.aliases !== undefined ||
    patch.note !== undefined;
  if (wantsExtended && !extended)
    return "담당자·다른 이름·메모 칸이 아직 DB에 없습니다(business_program_admin.sql 적용 필요).";
  if (extended) {
    let aliases = (patch.aliases ?? current.aliases)
      .map((a) => a.trim())
      .filter(Boolean);
    if (typeof row.name === "string" && row.name !== current.name)
      aliases = appendAlias(aliases, current.name, row.name);
    // 지금 이름과 같은 다른 이름·중복은 뺍니다.
    const nowName = (row.name as string | undefined) ?? current.name;
    aliases = [...new Set(aliases)].filter(
      (a) => programNameKey(a) !== programNameKey(nowName),
    );
    row.aliases = aliases;
    if (patch.manager_driver_id !== undefined)
      row.manager_driver_id = patch.manager_driver_id || null;
    if (patch.note !== undefined) row.note = patch.note.trim();
    row.updated_at = new Date().toISOString();
  }
  if (Object.keys(row).length === 0) return null;
  const { error } = await supabaseAdmin
    .from("business_programs")
    .update(row)
    .eq("id", id);
  if (error) {
    if (error.code === "23505")
      return "같은 분야에 같은 이름의 프로그램이 이미 있습니다.";
    throw new Error(error.message);
  }
  return null;
}

export async function insertProgramRow(input: {
  category_id: string;
  name: string;
  manager_driver_id?: string | null;
  aliases?: string[];
  note?: string;
}): Promise<{ id: string } | { error: string }> {
  const nm = input.name.trim();
  if (!input.category_id) return { error: "분야를 선택하세요." };
  if (!nm) return { error: "프로그램 이름을 입력하세요." };
  const dup = await assertUniqueProgramName(input.category_id, nm);
  if (dup) return { error: dup };
  const { extended } = await loadAdminPrograms();
  const { data: rows } = await supabaseAdmin
    .from("business_programs")
    .select("sort_order")
    .eq("category_id", input.category_id);
  const max = (rows ?? []).reduce(
    (m, r) => Math.max(m, Number((r as { sort_order: unknown }).sort_order)),
    0,
  );
  const row: Record<string, unknown> = {
    category_id: input.category_id,
    name: nm,
    sort_order: max + 1,
  };
  if (extended) {
    row.manager_driver_id = input.manager_driver_id || null;
    row.aliases = [...new Set((input.aliases ?? []).map((a) => a.trim()))]
      .filter(Boolean)
      .filter((a) => programNameKey(a) !== programNameKey(nm));
    row.note = (input.note ?? "").trim();
  }
  const { data, error } = await supabaseAdmin
    .from("business_programs")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505")
      return { error: "같은 분야에 같은 이름의 프로그램이 이미 있습니다." };
    throw new Error(error.message);
  }
  return { id: String((data as { id: string }).id) };
}

// 직접 입력 실적 연결 — program_id 만 채웁니다(숫자·당시 이름·분야 글자는 그대로).
//   이미 연결된 행(program_id 있음)은 건드리지 않습니다.
export async function linkUnregisteredRows(
  names: string[],
  programId: string,
): Promise<number> {
  const list = [...new Set(names)].filter((n) => n.length > 0);
  if (list.length === 0) return 0;
  const { data, error } = await supabaseAdmin
    .from("business_results")
    .update({ program_id: programId })
    .is("program_id", null)
    .in("program_name", list)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
