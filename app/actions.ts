"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  supabase,
  type Driver,
  type DrivingLog,
} from "@/lib/supabase";

const SESSION_COOKIE = "dongrae_admin";
const DEFAULT_INITIAL_DISTANCE = 4341;

// =====================================================================
// Admin session
// =====================================================================
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return store.get(SESSION_COOKIE)?.value === expected;
}

async function requireAdmin() {
  if (!(await isAdmin())) {
    throw new Error("관리자 권한이 필요합니다.");
  }
}

export async function adminLogin(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, message: "ADMIN_PASSWORD 환경변수가 설정되지 않았습니다." };
  }
  if (password !== expected) {
    return { ok: false, message: "비밀번호가 올바르지 않습니다." };
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/admin");
}

export async function adminLogout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/");
}

// =====================================================================
// Settings (key/value) — initial cumulative distance
// =====================================================================
export async function getInitialDistance(): Promise<number> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "initial_distance")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const v = data?.value;
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INITIAL_DISTANCE;
}

export async function setInitialDistance(formData: FormData) {
  await requireAdmin();
  const raw = String(formData.get("initial_distance") ?? "");
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("올바른 숫자를 입력해주세요.");
  }
  const value = String(Math.round(n * 10) / 10);

  const { error } = await supabase
    .from("settings")
    .upsert({ key: "initial_distance", value, updated_at: new Date().toISOString() }, {
      onConflict: "key",
    });
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/admin");
}

// =====================================================================
// Cumulative distance helpers
//   현재 누적거리 = settings.initial_distance + Σ driving_logs.distance
// =====================================================================
export async function getLatestCumulative(): Promise<number> {
  const [initial, { data, error }] = await Promise.all([
    getInitialDistance(),
    supabase.from("driving_logs").select("distance"),
  ]);
  if (error) throw new Error(error.message);
  const sum = (data ?? []).reduce(
    (acc, r) => acc + (Number(r.distance) || 0),
    0
  );
  return Math.round((initial + sum) * 10) / 10;
}

// =====================================================================
// Driving logs
// =====================================================================
export async function createDrivingLog(formData: FormData) {
  const driven_at = String(formData.get("driven_at") ?? "");
  const driverName = String(formData.get("driver") ?? "").trim();
  const driverPassword = String(formData.get("driver_password") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const departure = String(formData.get("departure") ?? "").trim();
  const waypointRaw = String(formData.get("waypoint") ?? "").trim();
  const destination = String(formData.get("destination") ?? "").trim();
  const odometer = Number(formData.get("odometer") ?? NaN);
  const confirmed_by = String(formData.get("confirmed_by") ?? "").trim();

  if (
    !driven_at ||
    !driverName ||
    !driverPassword ||
    !purpose ||
    !departure ||
    !destination ||
    !confirmed_by ||
    !Number.isFinite(odometer) ||
    odometer < 0
  ) {
    throw new Error("필수 항목을 모두 올바르게 입력해주세요.");
  }

  // Re-validate driver credential server-side (client uses localStorage gate only).
  const { data: driverRow, error: driverErr } = await supabase
    .from("drivers")
    .select("id,name,password")
    .eq("name", driverName)
    .maybeSingle();
  if (driverErr) throw new Error(driverErr.message);
  if (!driverRow || driverRow.password !== driverPassword) {
    throw new Error("운전자 인증에 실패했습니다. 다시 로그인해주세요.");
  }

  const previous = await getLatestCumulative();
  const total_distance = Math.round(odometer * 10) / 10;
  const distance = Math.round((total_distance - previous) * 10) / 10;

  if (distance < 0) {
    throw new Error(
      `입력한 누적거리(${total_distance} km)가 직전 누적(${previous} km)보다 작습니다.`
    );
  }

  const { error } = await supabase.from("driving_logs").insert({
    driven_at,
    driver: driverName,
    purpose,
    departure,
    waypoint: waypointRaw || null,
    destination,
    distance,
    total_distance,
    confirmed_by,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/");
  redirect("/");
}

export async function deleteDrivingLog(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("삭제할 항목 ID가 없습니다.");

  const { error } = await supabase.from("driving_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
}

export async function listDrivingLogs(month?: string): Promise<DrivingLog[]> {
  let query = supabase
    .from("driving_logs")
    .select("*")
    .order("driven_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const endDate = new Date(Date.UTC(y, m, 1));
    const end = endDate.toISOString().slice(0, 10);
    query = query.gte("driven_at", start).lt("driven_at", end);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DrivingLog[];
}

// =====================================================================
// Admin stats
// =====================================================================
export type AdminStats = {
  recentDestinations: { destination: string; driven_at: string }[];
  topDestinations: { destination: string; count: number }[];
  topDrivers: { driver: string; count: number }[];
  thisMonthDistance: number;
  totalDistance: number;
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

  const [initial, logsRes] = await Promise.all([
    getInitialDistance(),
    supabase
      .from("driving_logs")
      .select("destination, driver, distance, driven_at, created_at")
      .order("driven_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (logsRes.error) throw new Error(logsRes.error.message);
  const rows = logsRes.data ?? [];

  const recentDestinations = rows.slice(0, 5).map((r) => ({
    destination: r.destination as string,
    driven_at: r.driven_at as string,
  }));

  const destCount = new Map<string, number>();
  for (const r of rows) {
    const d = r.destination as string;
    destCount.set(d, (destCount.get(d) ?? 0) + 1);
  }
  const topDestinations = [...destCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([destination, count]) => ({ destination, count }));

  const driverCount = new Map<string, number>();
  for (const r of rows) {
    const d = r.driver as string;
    driverCount.set(d, (driverCount.get(d) ?? 0) + 1);
  }
  const topDrivers = [...driverCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([driver, count]) => ({ driver, count }));

  const monthStart = todayMonthStartKR();
  let thisMonth = 0;
  let total = 0;
  for (const r of rows) {
    const dist = Number(r.distance) || 0;
    total += dist;
    if ((r.driven_at as string) >= monthStart) thisMonth += dist;
  }

  return {
    recentDestinations,
    topDestinations,
    topDrivers,
    thisMonthDistance: Math.round(thisMonth * 10) / 10,
    totalDistance: Math.round((initial + total) * 10) / 10,
  };
}

// =====================================================================
// Drivers
// =====================================================================
export async function loginDriver(
  formData: FormData
): Promise<{ ok: true; driver: { id: string; name: string } } | { ok: false; message: string }> {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || !password) {
    return { ok: false, message: "이름과 비밀번호를 입력해주세요." };
  }
  const { data, error } = await supabase
    .from("drivers")
    .select("id,name,password")
    .eq("name", name)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data || data.password !== password) {
    return { ok: false, message: "이름 또는 비밀번호가 올바르지 않습니다." };
  }
  return { ok: true, driver: { id: data.id, name: data.name } };
}

export async function listDrivers(): Promise<Driver[]> {
  await requireAdmin();
  const { data, error } = await supabase
    .from("drivers")
    .select("id,name,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Driver[];
}

export async function listDriverNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.name as string);
}

export async function addDriver(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || !password) {
    throw new Error("이름과 비밀번호를 모두 입력해주세요.");
  }
  const { error } = await supabase.from("drivers").insert({ name, password });
  if (error) {
    if (error.code === "23505") {
      throw new Error("이미 같은 이름의 운전자가 있습니다.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/admin");
}

export async function deleteDriver(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("운전자 ID가 없습니다.");
  const { error } = await supabase.from("drivers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function updateDriverPassword(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!id || !password) {
    throw new Error("운전자 ID와 새 비밀번호가 필요합니다.");
  }
  const { error } = await supabase
    .from("drivers")
    .update({ password })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
