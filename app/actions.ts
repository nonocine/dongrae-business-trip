"use server";

import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "@/lib/password";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  supabase,
  normalizeBusinessTrip,
  normalizeActivity,
  normalizeDrivingLog,
  settingsFromRows,
  toStringArray,
  EMPLOYEE_RANKS,
  ACTIVITY_KINDS,
  DEFAULT_DEPARTURE,
  DEFAULT_VEHICLE_CONFIRMER,
  isActivityKind,
  validatePasswordStrength,
  generateTempPassword,
  type Activity,
  type ActivityKind,
  type BusinessTrip,
  type Driver,
  type DrivingLog,
  type Employee,
  type EmployeeRank,
  type Settings,
  type TransportType,
} from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  GOOGLE_SESSION_COOKIE,
  parseGoogleSession,
  type GoogleSession,
} from "@/lib/googleAuth";

const ADMIN_COOKIE = "dongrae_admin";
const EMPLOYEE_COOKIE = "dongrae_employee";

const STORAGE_BUCKET_PHOTOS = "trip-photos";
const STORAGE_BUCKET_RECEIPTS = "trip-receipts";

const TRANSPORT_VALUES: TransportType[] = ["vehicle", "public", "walk"];

// =====================================================================
// Sessions (admin / employee)
// =====================================================================
export type Session =
  | { kind: "admin" }
  | { kind: "employee"; name: string };

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return store.get(ADMIN_COOKIE)?.value === expected;
}

export async function getSession(): Promise<Session | null> {
  if (await isAdmin()) return { kind: "admin" };
  const store = await cookies();
  const name = store.get(EMPLOYEE_COOKIE)?.value;
  if (name && name.length > 0) return { kind: "employee", name };
  // Google Workspace 세션 — 직원 비번 로그인과 동등하게 취급.
  //   이름은 매칭된 직원명 우선(없으면 구글 표시 이름).
  const g = parseGoogleSession(store.get(GOOGLE_SESSION_COOKIE)?.value);
  if (g) return { kind: "employee", name: g.driverName ?? g.name };
  return null;
}

// Google Workspace 세션 원본(이메일·프로필 매칭 정보 포함). 쿠키만 신뢰.
export async function getGoogleSession(): Promise<GoogleSession | null> {
  const store = await cookies();
  return parseGoogleSession(store.get(GOOGLE_SESSION_COOKIE)?.value);
}

// Google Workspace 로그인 통과 여부 — HR 접근 게이트(isAdmin 과 병렬).
export async function isGoogleAuth(): Promise<boolean> {
  return (await getGoogleSession()) !== null;
}

// 관장(최고관리자) 권한 — 구글 세션이 마스터이거나 rank==='관장' 이면 true.
//   * /admin 및 관리자 전용 기능의 단일 권한 기준.
//   * 구버전 공유비번(ADMIN_PASSWORD)은 더 이상 이 판정에 사용하지 않습니다.
export async function isManagerAdmin(): Promise<boolean> {
  const g = await getGoogleSession();
  return !!g && (g.isMaster || g.rank === "관장");
}

async function requireAdmin() {
  // 공유비번 검사 제거 — 구글 관장 권한만 통과, 아니면 홈으로.
  if (!(await isManagerAdmin())) {
    redirect("/");
  }
}

async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export async function adminLogin(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return {
      ok: false,
      message: "ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.",
    };
  }
  if (password !== expected) {
    return { ok: false, message: "비밀번호가 올바르지 않습니다." };
  }
  const store = await cookies();
  // 관리자 로그인 시 직원 세션은 정리
  store.delete(EMPLOYEE_COOKIE);
  store.set(ADMIN_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/admin");
}

export async function loginEmployee(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  if (!name) {
    return { ok: false as const, message: "직원을 선택해주세요." };
  }
  // 직급별 비번 정책이 달라(일반 4자리 / 관장·부장 강력) 길이만 확인.
  // 실제 일치 여부는 아래 DB 조회에서 검증합니다.
  if (!password) {
    return { ok: false as const, message: "비밀번호를 입력해주세요." };
  }
  // select("*") — must_change_password 컬럼이 아직 없어도 안전합니다.
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("name", name)
    .maybeSingle();
  if (error) return { ok: false as const, message: error.message };
  if (!data) {
    return { ok: false as const, message: "등록되지 않은 직원입니다." };
  }
  if (data.is_active === false) {
    return {
      ok: false as const,
      message: "퇴사 처리된 계정입니다. 관리자에게 문의해주세요.",
    };
  }
  if (!data.password) {
    return {
      ok: false as const,
      message: "비밀번호가 등록되지 않은 직원입니다. 관리자에게 문의해주세요.",
    };
  }
  // SEC-1: 해시 검증. 기존 평문 저장값은 폴백 비교 후 그 자리에서 해시로 올립니다.
  const verified = await verifyPassword(password, data.password as string);
  if (!verified.ok) {
    return { ok: false as const, message: "비밀번호가 올바르지 않습니다." };
  }
  if (verified.needsUpgrade) {
    // 무통증 마이그레이션 — 실패해도 로그인은 진행합니다(다음 로그인 때 재시도).
    try {
      const upgraded = await hashPassword(password);
      const { error: upErr } = await supabase
        .from("drivers")
        .update({ password: upgraded })
        .eq("id", data.id as string);
      if (upErr) console.warn("[auth] 비밀번호 해시 전환 실패:", upErr.message);
    } catch (e) {
      console.warn(
        "[auth] 비밀번호 해시 전환 실패:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  store.set(EMPLOYEE_COOKIE, data.name as string, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  // 임시 비밀번호(must_change_password=true)면 비번 변경 페이지로 강제 이동.
  const mustChange =
    (data as { must_change_password?: unknown }).must_change_password === true;
  redirect(mustChange ? "/profile/password" : "/");
}

export async function logoutCurrent() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  store.delete(EMPLOYEE_COOKIE);
  store.delete(GOOGLE_SESSION_COOKIE);
  redirect("/");
}

// =====================================================================
// Storage helpers
// =====================================================================
async function uploadFiles(
  bucket: string,
  files: File[]
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    if (!file || file.size === 0) continue;
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const safeExt = ext.replace(/[^a-z0-9]/g, "") || "bin";
    const key = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(key, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
    if (error) throw new Error(`파일 업로드 실패: ${error.message}`);
    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    urls.push(data.publicUrl);
  }
  return urls;
}

// =====================================================================
// Business trips
// =====================================================================
export async function createBusinessTrip(formData: FormData) {
  const session = await requireSession();

  const trip_date = String(formData.get("trip_date") ?? "");
  const destination = String(formData.get("destination") ?? "").trim();
  // 직원 세션은 traveler를 본인 이름으로 강제 (폼 변조 방지)
  const traveler =
    session.kind === "employee"
      ? session.name
      : String(formData.get("traveler") ?? "").trim();
  const companionRaw = formData.getAll("companion");
  const companion = companionRaw
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  const purpose = String(formData.get("purpose") ?? "").trim();
  const transport_type = String(formData.get("transport_type") ?? "");
  const transport_cost_raw = String(formData.get("transport_cost") ?? "").trim();
  const meeting_content = String(formData.get("meeting_content") ?? "").trim();
  const main_agenda = String(formData.get("main_agenda") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();

  if (!trip_date || !destination || !traveler || !purpose) {
    throw new Error("필수 항목(일자/출장지/출장자/목적)을 입력해주세요.");
  }
  if (!TRANSPORT_VALUES.includes(transport_type as TransportType)) {
    throw new Error("이동수단을 선택해주세요.");
  }

  let transport_cost: number | null = null;
  if (transport_type === "public" && transport_cost_raw) {
    const n = Number(transport_cost_raw);
    if (Number.isFinite(n) && n >= 0) transport_cost = Math.round(n);
  }

  const photoFiles = formData
    .getAll("photos")
    .filter((v): v is File => v instanceof File);
  if (photoFiles.length > 5) {
    throw new Error("인증샷은 최대 5장까지 업로드할 수 있습니다.");
  }
  const receiptFiles = formData
    .getAll("receipts")
    .filter((v): v is File => v instanceof File);

  const [photos, receipts] = await Promise.all([
    uploadFiles(STORAGE_BUCKET_PHOTOS, photoFiles),
    transport_type === "public"
      ? uploadFiles(STORAGE_BUCKET_RECEIPTS, receiptFiles)
      : Promise.resolve([] as string[]),
  ]);

  const { data, error } = await supabase
    .from("business_trips")
    .insert({
      trip_date,
      destination,
      traveler,
      companion,
      purpose,
      transport_type,
      transport_cost,
      meeting_content,
      main_agenda,
      result,
      photos,
      receipts,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/");
  redirect(`/trips/${data.id}`);
}

function extractStorageKey(publicUrl: string, bucket: string): string | null {
  const marker = `/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx < 0) return null;
  const tail = publicUrl.slice(idx + marker.length);
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

export async function deleteBusinessTrip(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("삭제할 항목 ID가 없습니다.");

  // 1) photos / receipts 키 수집 → Storage에서 함께 삭제
  const { data: row, error: fetchErr } = await supabase
    .from("business_trips")
    .select("photos, receipts")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);

  if (row) {
    const photoKeys = toStringArray(row.photos)
      .map((u) => extractStorageKey(u, STORAGE_BUCKET_PHOTOS))
      .filter((k): k is string => !!k);
    const receiptKeys = toStringArray(row.receipts)
      .map((u) => extractStorageKey(u, STORAGE_BUCKET_RECEIPTS))
      .filter((k): k is string => !!k);

    if (photoKeys.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET_PHOTOS).remove(photoKeys);
    }
    if (receiptKeys.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET_RECEIPTS).remove(receiptKeys);
    }
  }

  // 2) DB 행 삭제
  const { error } = await supabase.from("business_trips").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/admin");
}

export async function listBusinessTrips(
  month?: string
): Promise<BusinessTrip[]> {
  const session = await getSession();
  if (!session) return [];

  let query = supabase
    .from("business_trips")
    .select("*")
    .order("trip_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (session.kind === "employee") {
    query = query.eq("traveler", session.name);
  }

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const endDate = new Date(Date.UTC(y, m, 1));
    const end = endDate.toISOString().slice(0, 10);
    query = query.gte("trip_date", start).lt("trip_date", end);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    normalizeBusinessTrip(row as Record<string, unknown>)
  );
}

export async function getBusinessTrip(id: string): Promise<BusinessTrip | null> {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("business_trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const trip = normalizeBusinessTrip(data as Record<string, unknown>);
  if (session.kind === "employee" && trip.traveler !== session.name) {
    return null; // 본인 출장이 아니면 권한 없음으로 취급
  }
  return trip;
}

// =====================================================================
// Admin stats
// =====================================================================
export type AdminStats = {
  total: number;
  thisMonth: number;
  thisMonthCost: number;
  uniqueTravelers: number;
  byTraveler: { name: string; count: number }[];
  byTransport: { type: TransportType; count: number }[];
  recent: {
    id: string;
    destination: string;
    trip_date: string;
    traveler: string;
    transport_type: TransportType;
  }[];
};

function todayMonthStartKR(): string {
  const now = new Date();
  const tz = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = tz.getUTCFullYear();
  const m = String(tz.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function getAdminStats(): Promise<AdminStats> {
  await requireAdmin();

  const { data, error } = await supabase
    .from("business_trips")
    .select(
      "id, trip_date, destination, traveler, transport_type, transport_cost, created_at"
    )
    .order("trip_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const monthStart = todayMonthStartKR();
  let thisMonth = 0;
  let thisMonthCost = 0;
  const travelerCount = new Map<string, number>();
  const transportCount = new Map<TransportType, number>();
  const uniqueTravelers = new Set<string>();
  for (const r of rows) {
    const isThisMonth = (r.trip_date as string) >= monthStart;
    if (isThisMonth) {
      thisMonth += 1;
      if (r.transport_type === "public" && r.transport_cost != null) {
        thisMonthCost += Number(r.transport_cost) || 0;
      }
    }
    const t = r.traveler as string;
    travelerCount.set(t, (travelerCount.get(t) ?? 0) + 1);
    uniqueTravelers.add(t);
    const tt = r.transport_type as TransportType;
    transportCount.set(tt, (transportCount.get(tt) ?? 0) + 1);
  }

  const byTraveler = [...travelerCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const byTransport = TRANSPORT_VALUES.map((type) => ({
    type,
    count: transportCount.get(type) ?? 0,
  }));

  const recent = rows.slice(0, 5).map((r) => ({
    id: r.id as string,
    destination: r.destination as string,
    trip_date: r.trip_date as string,
    traveler: r.traveler as string,
    transport_type: r.transport_type as TransportType,
  }));

  return {
    total: rows.length,
    thisMonth,
    thisMonthCost,
    uniqueTravelers: uniqueTravelers.size,
    byTraveler,
    byTransport,
    recent,
  };
}

// =====================================================================
// Drivers (직원 목록 — 차량 어플과 공유)
// =====================================================================
// SEC-1: password 는 조회하되 값 자체는 밖으로 내보내지 않고 has_password
//   (설정 여부)로만 환원합니다. 예전에는 Driver.password 에 실제 값이 담겨
//   관리자 화면(클라이언트 컴포넌트)까지 전달됐습니다 — 화면에는 "****" 로
//   가려져 있었지만 값은 페이지 페이로드에 그대로 실려 나갔습니다.
const DRIVER_COLUMNS = "id,name,rank,password,is_active,created_at";

export async function listDrivers(opts?: {
  includeInactive?: boolean;
}): Promise<Driver[]> {
  let query = supabase
    .from("drivers")
    .select(DRIVER_COLUMNS)
    .order("created_at", { ascending: true });
  if (!opts?.includeInactive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String((row as { id: unknown }).id ?? ""),
    name: String((row as { name: unknown }).name ?? ""),
    rank: ((row as { rank: unknown }).rank as EmployeeRank | null) ?? null,
    has_password:
      String((row as { password: unknown }).password ?? "").length > 0,
    is_active: (row as { is_active: unknown }).is_active !== false,
    created_at: String((row as { created_at: unknown }).created_at ?? ""),
  }));
}

// 호환성을 위한 기존 이름 (활성 직원만 반환)
export async function listEmployees(): Promise<Employee[]> {
  return listDrivers({ includeInactive: true });
}

export async function listDriverNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => e.name as string);
}

// 호환성: 기존 코드가 listEmployeeNames 를 import 합니다.
export async function listEmployeeNames(): Promise<string[]> {
  return listDriverNames();
}

function validateRank(raw: string): EmployeeRank | null {
  if (!raw) return null;
  if ((EMPLOYEE_RANKS as readonly string[]).includes(raw)) {
    return raw as EmployeeRank;
  }
  return null;
}

export async function addDriver(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const rankRaw = String(formData.get("rank") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!name) throw new Error("직원 이름을 입력해주세요.");
  const rank = validateRank(rankRaw);
  if (!rank) throw new Error("직급을 선택해주세요.");
  if (!/^\d{4}$/.test(password)) {
    throw new Error("4자리 숫자 비밀번호를 입력해주세요.");
  }

  // SEC-1: 평문이 아닌 bcrypt 해시로 저장합니다.
  const passwordHash = await hashPassword(password);

  // 동일 이름의 비활성 직원이 있다면 복귀 처리
  const { data: existing } = await supabase
    .from("drivers")
    .select("id, is_active")
    .eq("name", name)
    .maybeSingle();
  if (existing && existing.is_active === false) {
    const { error: upErr } = await supabase
      .from("drivers")
      .update({ rank, password: passwordHash, is_active: true })
      .eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    revalidatePath("/admin");
    revalidatePath("/new");
    revalidatePath("/");
    return;
  }

  const { error } = await supabase
    .from("drivers")
    .insert({ name, rank, password: passwordHash, is_active: true });
  if (error) {
    if (error.code === "23505") {
      throw new Error("이미 같은 이름의 직원이 있습니다.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/admin");
  revalidatePath("/new");
  revalidatePath("/");
}

// 호환성: 기존 호출자가 addEmployee 를 사용
export async function addEmployee(formData: FormData) {
  return addDriver(formData);
}

export async function updateDriver(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const rankRaw = String(formData.get("rank") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!id) throw new Error("직원 ID가 없습니다.");
  const rank = validateRank(rankRaw);
  if (!rank) throw new Error("직급을 선택해주세요.");

  const update: { rank: EmployeeRank; password?: string } = { rank };
  if (password.length > 0) {
    if (!/^\d{4}$/.test(password)) {
      throw new Error("비밀번호는 4자리 숫자여야 합니다.");
    }
    // SEC-1: 해시로 저장.
    update.password = await hashPassword(password);
  }

  const { error } = await supabase.from("drivers").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function updateEmployee(formData: FormData) {
  return updateDriver(formData);
}

// 소프트 삭제: is_active = false
export async function deleteDriver(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("직원 ID가 없습니다.");
  const { error } = await supabase
    .from("drivers")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/new");
  revalidatePath("/");
}

export async function deleteEmployee(formData: FormData) {
  return deleteDriver(formData);
}

// 복귀: is_active = true
export async function restoreDriver(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("직원 ID가 없습니다.");
  const { error } = await supabase
    .from("drivers")
    .update({ is_active: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/new");
  revalidatePath("/");
}

// =====================================================================
// 비밀번호 관리
//   * drivers.password 는 평문. must_change_password / password_changed_at
//     컬럼은 아직 DB에 없을 수 있어, 갱신 실패 시 password 만 갱신합니다.
// =====================================================================

// 임시 비밀번호 사용자(must_change_password=true)는 비번을 바꾸기 전까지
// 다른 페이지 진입을 차단합니다. 비번 변경 페이지 자체에서는 호출하지 마세요.
export async function enforcePasswordChange(): Promise<void> {
  const session = await getSession();
  if (!session || session.kind !== "employee") return;
  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("name", session.name)
      .maybeSingle();
    if (error || !data) return;
    if (
      (data as { must_change_password?: unknown }).must_change_password === true
    ) {
      redirect("/profile/password");
    }
  } catch (e) {
    // redirect()는 NEXT_REDIRECT 에러를 throw 하므로 그대로 다시 던집니다.
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
    // 그 외(컬럼 없음 등)는 차단하지 않고 통과시킵니다.
  }
}

// 본인 비밀번호 변경 (직원 세션 전용).
export async function changePassword(formData: FormData) {
  const session = await requireSession();
  if (session.kind !== "employee") {
    throw new Error(
      "관리자 비밀번호는 환경변수(ADMIN_PASSWORD)로 관리됩니다."
    );
  }

  const currentPassword = String(formData.get("current_password") ?? "").trim();
  const newPassword = String(formData.get("new_password") ?? "").trim();
  const confirmPassword = String(formData.get("confirm_password") ?? "").trim();

  if (!currentPassword || !newPassword) {
    throw new Error("현재 비밀번호와 새 비밀번호를 모두 입력해주세요.");
  }
  if (newPassword !== confirmPassword) {
    throw new Error("새 비밀번호 확인이 일치하지 않습니다.");
  }

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("name", session.name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("직원 정보를 찾을 수 없습니다.");

  // SEC-1: 현재 비번도 해시 검증(레거시 평문은 폴백). 어차피 아래에서 새
  // 비번을 해시로 덮어쓰므로 여기서는 별도 업그레이드를 하지 않습니다.
  const current = await verifyPassword(
    currentPassword,
    (data as { password?: unknown }).password as string,
  );
  if (!current.ok) {
    throw new Error("현재 비밀번호가 올바르지 않습니다.");
  }

  const rank =
    ((data as { rank?: unknown }).rank as EmployeeRank | null) ?? null;
  const check = validatePasswordStrength(newPassword, rank);
  if (!check.ok) {
    throw new Error(check.error ?? "비밀번호 정책을 만족하지 않습니다.");
  }
  if (newPassword === currentPassword) {
    throw new Error("새 비밀번호가 기존 비밀번호와 동일합니다.");
  }

  const id = (data as { id: unknown }).id;
  const newHash = await hashPassword(newPassword); // SEC-1
  // 새 컬럼이 있으면 함께 갱신, 없으면(에러) password 만 갱신.
  const { error: upErr } = await supabase
    .from("drivers")
    .update({
      password: newHash,
      password_changed_at: new Date().toISOString(),
      must_change_password: false,
    })
    .eq("id", id);
  if (upErr) {
    const { error: fbErr } = await supabase
      .from("drivers")
      .update({ password: newHash })
      .eq("id", id);
    if (fbErr) throw new Error(fbErr.message);
  }

  revalidatePath("/");
  redirect("/");
}

// 관리자가 직원 비밀번호를 임시 비번으로 재설정 (ADMIN 전용).
export async function resetEmployeePassword(
  formData: FormData
): Promise<
  | { ok: true; name: string; tempPassword: string }
  | { ok: false; message: string }
> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, message: "직원 ID가 없습니다." };

    const { data: row, error: fetchErr } = await supabase
      .from("drivers")
      .select("name")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) return { ok: false, message: fetchErr.message };
    if (!row) return { ok: false, message: "직원을 찾을 수 없습니다." };

    // 원문은 관리자에게 1회 전달하기 위해서만 메모리에 두고, DB 에는 해시만
    // 저장합니다(SEC-1). 이 값은 로그로 남기지 않습니다.
    const tempPassword = generateTempPassword();
    const tempHash = await hashPassword(tempPassword);

    // 새 컬럼이 있으면 함께 갱신, 없으면(에러) password 만 갱신.
    const { error: upErr } = await supabase
      .from("drivers")
      .update({
        password: tempHash,
        must_change_password: true,
        password_changed_at: null,
      })
      .eq("id", id);
    if (upErr) {
      const { error: fbErr } = await supabase
        .from("drivers")
        .update({ password: tempHash })
        .eq("id", id);
      if (fbErr) return { ok: false, message: fbErr.message };
    }

    revalidatePath("/admin");
    return {
      ok: true,
      name: String((row as { name: unknown }).name ?? ""),
      tempPassword,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "비밀번호 재설정 중 오류가 발생했습니다.",
    };
  }
}

// =====================================================================
// Settings (차량 정보 / 누적거리 — 차량 어플과 공유)
//   * settings 테이블은 (key, value) Key-Value 구조입니다.
//   * value 는 항상 text. 숫자 키는 읽을 때 Number, 쓸 때 String 변환.
// =====================================================================
export async function getSettings(): Promise<Settings | null> {
  const { data, error } = await supabase
    .from("settings")
    .select("key, value");
  if (error) {
    // 테이블이 없거나 권한 부족 — 무시하고 null 반환
    return null;
  }
  if (!data || data.length === 0) return null;
  return settingsFromRows(
    data as Array<{ key?: unknown; value?: unknown }>
  );
}

// 단일 키 조회 (raw text)
async function getSettingValue(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  const v = (data as { value: unknown }).value;
  return v == null ? null : String(v);
}

// 단일 키 저장 (없으면 insert, 있으면 update)
async function setSettingValue(key: string, value: string): Promise<void> {
  const { data: existing } = await supabase
    .from("settings")
    .select("id")
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("settings")
      .update({ value })
      .eq("key", key);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("settings")
      .insert({ key, value });
    if (error) throw new Error(error.message);
  }
}

// =====================================================================
// Driving logs (차량 운행 일지 — 차량 어플과 공유)
// =====================================================================
export async function getLatestDrivingLog(): Promise<DrivingLog | null> {
  const { data, error } = await supabase
    .from("driving_logs")
    .select("*")
    .order("driven_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return normalizeDrivingLog(data as Record<string, unknown>);
}

export async function getDrivingLog(id: string): Promise<DrivingLog | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from("driving_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return normalizeDrivingLog(data as Record<string, unknown>);
}

// =====================================================================
// Activities (외근 / 출장 / 국내연수 / 해외연수 / 교육)
// =====================================================================
function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function createActivity(formData: FormData) {
  const session = await requireSession();

  const kindRaw = String(formData.get("kind") ?? "");
  if (!isActivityKind(kindRaw)) throw new Error("올바르지 않은 활동 유형입니다.");
  const kind = kindRaw;

  const author =
    session.kind === "employee"
      ? session.name
      : String(formData.get("author") ?? "").trim();
  if (!author) throw new Error("작성자를 확인해주세요.");

  const companion = formData
    .getAll("companion")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);

  const purpose = String(formData.get("purpose") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();

  const start_date = strOrNull(formData.get("start_date"));
  const end_date = strOrNull(formData.get("end_date"));
  const location = strOrNull(formData.get("location"));
  const organization = strOrNull(formData.get("organization"));
  const city = strOrNull(formData.get("city"));
  const country = strOrNull(formData.get("country"));

  const transport_type = strOrNull(formData.get("transport_type"));
  const transport_cost = numOrNull(formData.get("transport_cost"));
  const accommodation =
    String(formData.get("accommodation") ?? "") === "on" ? true : null;
  const accommodation_cost = numOrNull(formData.get("accommodation_cost"));
  const training_cost = numOrNull(formData.get("training_cost"));

  const course_name = strOrNull(formData.get("course_name"));
  const visa_info = strOrNull(formData.get("visa_info"));
  const education_type = strOrNull(formData.get("education_type"));
  const instructor = strOrNull(formData.get("instructor"));
  const education_hours = numOrNull(formData.get("education_hours"));
  const attendees_count = numOrNull(formData.get("attendees_count"));

  if (!start_date) throw new Error("날짜를 입력해주세요.");
  if (!purpose) throw new Error("목적을 입력해주세요.");

  // ---------------------------------------------------------------
  // 차량 사용 시 driving_logs 자동 저장 (외근/출장 + 기관차량)
  // ---------------------------------------------------------------
  const usesVehicleLog =
    (kind === "outside_work" || kind === "business_trip") &&
    transport_type === "vehicle";

  let drivingLogId: string | null = null;
  let prevTotalMileage: number | null = null;

  if (usesVehicleLog) {
    // 출발지/도착지/확인자는 고정값. 출장지(location)는 위 활동 폼에서 입력한 값을 사용.
    const visitLocation = location;
    if (!visitLocation) {
      throw new Error("차량 사용 시 출장지를 입력해주세요.");
    }
    const totalDistance = numOrNull(formData.get("driving_total_distance"));

    if (totalDistance == null) {
      throw new Error("차량 사용 시 누적거리를 입력해주세요.");
    }

    // 직전 누적거리 조회 (settings.initial_mileage 키)
    const prevRaw = await getSettingValue("initial_mileage");
    prevTotalMileage = prevRaw != null ? Number(prevRaw) : 0;
    if (!Number.isFinite(prevTotalMileage)) prevTotalMileage = 0;
    if (totalDistance < prevTotalMileage) {
      throw new Error(
        `누적거리는 직전 운행(${prevTotalMileage.toLocaleString("ko-KR")}km)보다 작을 수 없습니다.`
      );
    }
    const distance = Math.max(0, totalDistance - prevTotalMileage);

    const drivingPurpose = [visitLocation, purpose].filter(Boolean).join(" ").trim();

    const { data: dlog, error: dlogErr } = await supabase
      .from("driving_logs")
      .insert({
        driven_at: start_date,
        driver: author,
        purpose: drivingPurpose || purpose,
        departure: DEFAULT_DEPARTURE,
        waypoint: visitLocation,
        destination: DEFAULT_DEPARTURE,
        distance,
        total_distance: totalDistance,
        confirmed_by: DEFAULT_VEHICLE_CONFIRMER,
      })
      .select("id")
      .single();
    if (dlogErr) {
      throw new Error(`차량 운행 기록 저장 실패: ${dlogErr.message}`);
    }
    drivingLogId = dlog.id as string;

    // settings.initial_mileage 동기화 (차량 어플과 양방향 누적거리 공유)
    try {
      await setSettingValue("initial_mileage", String(totalDistance));
    } catch (e) {
      await supabase.from("driving_logs").delete().eq("id", drivingLogId);
      const msg = e instanceof Error ? e.message : "알 수 없는 오류";
      throw new Error(`차량 누적거리 동기화 실패: ${msg}`);
    }
  }

  async function rollbackVehicle() {
    if (drivingLogId) {
      await supabase.from("driving_logs").delete().eq("id", drivingLogId);
    }
    if (prevTotalMileage != null) {
      try {
        await setSettingValue("initial_mileage", String(prevTotalMileage));
      } catch {
        // 롤백 실패는 무시 (이미 에러 throw 중)
      }
    }
  }

  const photoFiles = formData
    .getAll("photos")
    .filter((v): v is File => v instanceof File);
  const receiptFiles = formData
    .getAll("receipts")
    .filter((v): v is File => v instanceof File);
  const certificateFiles = formData
    .getAll("certificate")
    .filter((v): v is File => v instanceof File);
  if (photoFiles.length > 5) {
    throw new Error("인증샷은 최대 5장까지 업로드할 수 있습니다.");
  }

  let photos: string[] = [];
  let receipts: string[] = [];
  let certificate: string[] = [];
  try {
    [photos, receipts, certificate] = await Promise.all([
      uploadFiles(STORAGE_BUCKET_PHOTOS, photoFiles),
      uploadFiles(STORAGE_BUCKET_RECEIPTS, receiptFiles),
      uploadFiles(STORAGE_BUCKET_RECEIPTS, certificateFiles),
    ]);
  } catch (e) {
    await rollbackVehicle();
    throw e;
  }

  const { data, error } = await supabaseAdmin
    .from("activities")
    .insert({
      // DB column is `activity_type`
      activity_type: kind,
      author,
      companion,
      purpose,
      content,
      result,
      photos,
      receipts,
      certificate,
      start_date,
      end_date,
      location,
      organization,
      city,
      country,
      transport_type,
      transport_cost,
      accommodation,
      accommodation_cost,
      training_cost,
      course_name,
      visa_info,
      education_type,
      instructor,
      education_hours,
      attendees_count,
      driving_log_id: drivingLogId,
    })
    .select("id")
    .single();
  if (error) {
    // 트랜잭션 처리: 활동 저장 실패 시 운행 기록 + 누적거리 롤백
    await rollbackVehicle();
    throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  redirect(`/activities/${data.id}`);
}

export async function listActivities(opts?: {
  month?: string;
  kind?: ActivityKind | "";
  author?: string;
}): Promise<Activity[]> {
  const session = await getSession();
  if (!session) return [];

  let query = supabaseAdmin
    .from("activities")
    .select("*")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (session.kind === "employee") {
    query = query.eq("author", session.name);
  } else if (opts?.author) {
    query = query.eq("author", opts.author);
  }

  if (opts?.kind) {
    query = query.eq("activity_type", opts.kind);
  }

  if (opts?.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const [y, m] = opts.month.split("-").map(Number);
    const start = `${opts.month}-01`;
    const endDate = new Date(Date.UTC(y, m, 1));
    const end = endDate.toISOString().slice(0, 10);
    query = query.gte("start_date", start).lt("start_date", end);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    normalizeActivity(row as Record<string, unknown>)
  );
}

export async function getActivity(id: string): Promise<Activity | null> {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabaseAdmin
    .from("activities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const a = normalizeActivity(data as Record<string, unknown>);
  if (session.kind === "employee" && a.author !== session.name) return null;
  return a;
}

export async function deleteActivity(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("삭제할 항목 ID가 없습니다.");

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("activities")
    .select("author, photos, receipts, certificate, driving_log_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!row) throw new Error("삭제할 활동을 찾을 수 없습니다.");

  // 권한: 관리자 또는 본인 활동
  if (session.kind !== "admin" && (row as { author: string }).author !== session.name) {
    throw new Error("본인 활동만 삭제할 수 있습니다.");
  }

  const photoKeys = toStringArray(row.photos)
    .map((u) => extractStorageKey(u, STORAGE_BUCKET_PHOTOS))
    .filter((k): k is string => !!k);
  const receiptKeys = [
    ...toStringArray(row.receipts),
    ...toStringArray(row.certificate),
  ]
    .map((u) => extractStorageKey(u, STORAGE_BUCKET_RECEIPTS))
    .filter((k): k is string => !!k);

  if (photoKeys.length > 0) {
    await supabase.storage.from(STORAGE_BUCKET_PHOTOS).remove(photoKeys);
  }
  if (receiptKeys.length > 0) {
    await supabase.storage.from(STORAGE_BUCKET_RECEIPTS).remove(receiptKeys);
  }

  const { error } = await supabaseAdmin.from("activities").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // 연결된 운행 기록 동시 삭제 (소유자만; 운행자가 본인일 때)
  const drivingLogId = (row as { driving_log_id: string | null })
    .driving_log_id;
  if (drivingLogId) {
    if (session.kind === "admin") {
      await supabase.from("driving_logs").delete().eq("id", drivingLogId);
    } else {
      await supabase
        .from("driving_logs")
        .delete()
        .eq("id", drivingLogId)
        .eq("driver", session.name);
    }
  }

  revalidatePath("/");
  revalidatePath("/admin");
}

// =====================================================================
// Admin stats v2 (activities)
// =====================================================================
export type ActivityAdminStats = {
  total: number;
  thisMonth: number;
  thisMonthCost: number;
  uniqueAuthors: number;
  byKind: { kind: ActivityKind; count: number }[];
  byAuthor: { name: string; count: number }[];
  recent: {
    id: string;
    kind: ActivityKind;
    location: string | null;
    start_date: string | null;
    author: string;
  }[];
};

export async function getActivityAdminStats(): Promise<ActivityAdminStats> {
  await requireAdmin();

  const { data, error } = await supabaseAdmin
    .from("activities")
    .select(
      "id, activity_type, start_date, location, author, transport_cost, accommodation_cost, training_cost, created_at"
    )
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const monthStart = todayMonthStartKR();
  let thisMonth = 0;
  let thisMonthCost = 0;
  const kindCount = new Map<ActivityKind, number>();
  const authorCount = new Map<string, number>();
  const uniqueAuthors = new Set<string>();
  for (const r of rows) {
    const sd = (r.start_date as string | null) ?? "";
    const isThisMonth = sd && sd >= monthStart;
    if (isThisMonth) {
      thisMonth += 1;
      thisMonthCost +=
        (Number(r.transport_cost) || 0) +
        (Number(r.accommodation_cost) || 0) +
        (Number(r.training_cost) || 0);
    }
    const k = r.activity_type as ActivityKind;
    if (k) kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
    const t = r.author as string;
    if (t) {
      authorCount.set(t, (authorCount.get(t) ?? 0) + 1);
      uniqueAuthors.add(t);
    }
  }

  const byKind = ACTIVITY_KINDS.map((kind) => ({
    kind,
    count: kindCount.get(kind) ?? 0,
  }));

  const byAuthor = [...authorCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const recent = rows.slice(0, 5).map((r) => ({
    id: r.id as string,
    kind: r.activity_type as ActivityKind,
    location: (r.location as string | null) ?? null,
    start_date: (r.start_date as string | null) ?? null,
    author: r.author as string,
  }));

  return {
    total: rows.length,
    thisMonth,
    thisMonthCost,
    uniqueAuthors: uniqueAuthors.size,
    byKind,
    byAuthor,
    recent,
  };
}
