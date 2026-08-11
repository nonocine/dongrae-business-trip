"use server";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyPayload } from "@/lib/signedCookie";
import { hashPassword, isHashed } from "@/lib/password";
import {
  GOOGLE_SESSION_COOKIE,
  GOOGLE_SESSION_MAX_AGE,
  isAllowedGoogleEmail,
  isMasterEmail,
  serializeGoogleSession,
  type GoogleSession,
} from "@/lib/googleAuth";
import { getGoogleSession } from "@/app/actions";
import {
  PIN_MAX_ATTEMPTS,
  TRUSTED_DEVICE_COOKIE,
  isPinLocked,
  isValidPinFormat,
  remainingAttempts,
} from "@/lib/pin";

// =====================================================================
// PIN 간편입력 서버 액션 (SEC-3 2단계)
//   * 신원의 뿌리는 언제나 구글 로그인입니다. PIN 은 "이미 신뢰된 기기"에서의
//     재진입 수단일 뿐이며, 신뢰 기기 쿠키만으로는 절대 세션이 나가지 않습니다.
//   * 재진입 성공 시 세션은 구글 콜백과 똑같이 GoogleSession 7필드를 채워
//     dongrae_google_session 으로 발급합니다(8시간). dongrae_employee 경로는
//     쓰지 않습니다 — 그 경로는 getGoogleSession 이 null 이라 HR·급여·관리자
//     기능이 전부 막힙니다.
//   * 권한 필드(rank·isMaster·hasProfile·이름)는 쿠키에서 복사하지 않고
//     매번 DB 에서 다시 읽습니다. 강등·퇴사가 즉시 반영되도록 하기 위함입니다.
//   * app/actions.ts 를 import 하되 그 반대 방향은 만들지 않습니다(순환 참조 금지).
// =====================================================================

// 신뢰 기기 쿠키 payload — 구글 콜백이 서명해 심습니다.
//   email 을 함께 담는 이유: 재진입 시 isMaster 판정(email === MASTER_EMAIL)에
//   반드시 필요한데, drivers 테이블에는 이메일이 없습니다. 이 값은 HMAC 서명본
//   이라 위조가 불가능하고, 발급 시점에 구글이 검증한 값입니다.
export type TrustedDevice = {
  driverId: string;
  driverName: string | null;
  email: string;
};

export type PinStatus = {
  // PIN 을 설정할 수 있는 계정인지(직원 레코드 보유 = driverId 존재).
  eligible: boolean;
  isSet: boolean;
  locked: boolean;
  reason?: string;
};

export type PinActionResult = { ok: true } | { ok: false; message: string };

export type PinSignInResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "untrusted"
        | "format"
        | "not_set"
        | "locked"
        | "mismatch"
        | "inactive"
        | "error";
      message: string;
      remaining?: number;
    };

// 신뢰 기기 쿠키 읽기 — 서명 검증 통과 + 필수 필드가 온전할 때만 반환.
async function readTrustedDevice(): Promise<TrustedDevice | null> {
  const store = await cookies();
  const parsed = verifyPayload<Partial<TrustedDevice>>(
    store.get(TRUSTED_DEVICE_COOKIE)?.value
  );
  if (!parsed) return null;
  if (
    typeof parsed.driverId !== "string" ||
    parsed.driverId.length === 0 ||
    typeof parsed.email !== "string" ||
    // 도메인 재검증 — 구글 세션 파서와 같은 이중 안전장치.
    !isAllowedGoogleEmail(parsed.email)
  ) {
    return null;
  }
  return {
    driverId: parsed.driverId,
    driverName:
      typeof parsed.driverName === "string" ? parsed.driverName : null,
    email: parsed.email,
  };
}

// 이 기기가 신뢰 등록돼 있는지 — 랜딩에서 PIN 입력 노출 여부 판단용.
//   * 이름은 화면 인사말에만 씁니다. 이 값만으로 로그인되지는 않습니다.
export async function getTrustedDeviceHint(): Promise<{
  trusted: boolean;
  name: string | null;
}> {
  const td = await readTrustedDevice();
  return { trusted: !!td, name: td?.driverName ?? null };
}

// 현재 로그인 사용자의 driverId — PIN 설정/해제의 대상.
async function currentDriverId(): Promise<string | null> {
  const g = await getGoogleSession();
  return g?.driverId ?? null;
}

// PIN 설정 상태 — /profile/pin 화면 표시용.
export async function getPinStatus(): Promise<PinStatus> {
  const driverId = await currentDriverId();
  if (!driverId) {
    return {
      eligible: false,
      isSet: false,
      locked: false,
      reason:
        "이 계정은 직원 레코드와 연결되어 있지 않아 PIN 을 사용할 수 없습니다.",
    };
  }
  const { data, error } = await supabaseAdmin
    .from("drivers")
    .select("pin_hash, pin_locked_until")
    .eq("id", driverId)
    .maybeSingle();
  if (error || !data) {
    return { eligible: false, isSet: false, locked: false, reason: "직원 정보를 찾을 수 없습니다." };
  }
  const row = data as { pin_hash?: unknown; pin_locked_until?: unknown };
  return {
    eligible: true,
    isSet: typeof row.pin_hash === "string" && row.pin_hash.length > 0,
    locked: isPinLocked(row.pin_locked_until as string | null, Date.now()),
  };
}

// PIN 설정/변경 — 로그인 상태에서만. 기존 PIN 이 있어도 덮어씁니다.
export async function setPin(pin: string): Promise<PinActionResult> {
  try {
    const driverId = await currentDriverId();
    if (!driverId) {
      return {
        ok: false,
        message:
          "이 계정은 직원 레코드와 연결되어 있지 않아 PIN 을 사용할 수 없습니다.",
      };
    }
    if (!isValidPinFormat(pin)) {
      return { ok: false, message: "PIN 은 숫자 6자리여야 합니다." };
    }
    // SEC-1 과 동일한 bcrypt(cost 10). 평문 저장 경로는 만들지 않습니다.
    const pin_hash = await hashPassword(pin);
    const { error } = await supabaseAdmin
      .from("drivers")
      .update({
        pin_hash,
        pin_set_at: new Date().toISOString(),
        pin_failed_count: 0,
        pin_locked_until: null,
      })
      .eq("id", driverId);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "PIN 설정 중 오류가 발생했습니다.",
    };
  }
}

// PIN 해제 — 로그인 상태에서만.
export async function clearPin(): Promise<PinActionResult> {
  try {
    const driverId = await currentDriverId();
    if (!driverId) {
      return { ok: false, message: "로그인이 필요합니다." };
    }
    const { error } = await supabaseAdmin
      .from("drivers")
      .update({
        pin_hash: null,
        pin_set_at: null,
        pin_failed_count: 0,
        pin_locked_until: null,
      })
      .eq("id", driverId);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "PIN 해제 중 오류가 발생했습니다.",
    };
  }
}

// PIN 재진입 — 신뢰 기기 + PIN 둘 다 통과해야 세션을 발급합니다.
export async function verifyPinAndSignIn(
  pin: string
): Promise<PinSignInResult> {
  try {
    // ① 신뢰 기기 확인. 실패하면 어떤 경우에도 세션을 발급하지 않습니다.
    const device = await readTrustedDevice();
    if (!device) {
      return {
        ok: false,
        reason: "untrusted",
        message: "이 기기는 등록되어 있지 않습니다. 구글 로그인으로 진행해주세요.",
      };
    }

    // ② 형식 검증 — DB 조회 전에 걸러 무의미한 실패 카운트를 막습니다.
    if (!isValidPinFormat(pin)) {
      return { ok: false, reason: "format", message: "PIN 은 숫자 6자리여야 합니다." };
    }

    // ③ 직원 레코드 재조회 — 권한 필드는 전부 여기서 다시 읽습니다.
    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select("id, name, rank, is_active, pin_hash, pin_failed_count, pin_locked_until")
      .eq("id", device.driverId)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, reason: "error", message: "직원 정보를 찾을 수 없습니다." };
    }
    const row = data as {
      id: string;
      name: string | null;
      rank: string | null;
      is_active: boolean | null;
      pin_hash: string | null;
      pin_failed_count: number | null;
      pin_locked_until: string | null;
    };

    // 퇴사 처리된 계정 차단. 구글 로그인은 Workspace 계정이 정지되면 자연히
    //   막히지만, 신뢰 기기 쿠키는 30일간 살아있으므로 여기서 직접 확인합니다.
    if (row.is_active === false) {
      return {
        ok: false,
        reason: "inactive",
        message: "비활성 처리된 계정입니다. 관리자에게 문의해주세요.",
      };
    }

    // ④ PIN 미설정 / 잠금 확인
    if (!row.pin_hash || !isHashed(row.pin_hash)) {
      return {
        ok: false,
        reason: "not_set",
        message: "이 계정에는 PIN 이 설정되어 있지 않습니다. 구글 로그인으로 진행해주세요.",
      };
    }
    if (isPinLocked(row.pin_locked_until, Date.now())) {
      return {
        ok: false,
        reason: "locked",
        message: `PIN 이 ${PIN_MAX_ATTEMPTS}회 틀려 잠겼습니다. 구글 로그인으로 진행하면 해제됩니다.`,
      };
    }

    // ⑤ PIN 대조 — 평문 폴백 없이 bcrypt.compare 만 사용합니다.
    let matched = false;
    try {
      matched = await bcrypt.compare(pin, row.pin_hash);
    } catch {
      matched = false;
    }

    if (!matched) {
      const failed = (row.pin_failed_count ?? 0) + 1;
      const locked = failed >= PIN_MAX_ATTEMPTS;
      await supabaseAdmin
        .from("drivers")
        .update({
          pin_failed_count: failed,
          // 잠금은 기한 없이 설정 — 구글 재로그인으로만 해제됩니다.
          //   (먼 미래 시각으로 두어 isPinLocked 가 항상 참이 되게 함)
          pin_locked_until: locked
            ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString()
            : null,
        })
        .eq("id", row.id);
      if (locked) {
        return {
          ok: false,
          reason: "locked",
          message: `PIN 을 ${PIN_MAX_ATTEMPTS}회 틀려 잠겼습니다. 구글 로그인으로 진행하면 해제됩니다.`,
          remaining: 0,
        };
      }
      const remaining = remainingAttempts(failed);
      return {
        ok: false,
        reason: "mismatch",
        message: `PIN 이 올바르지 않습니다. ${remaining}회 남았습니다.`,
        remaining,
      };
    }

    // ⑥ 성공 — 카운터 리셋 후 세션 재구성.
    await supabaseAdmin
      .from("drivers")
      .update({ pin_failed_count: 0, pin_locked_until: null })
      .eq("id", row.id);

    // 권한 필드는 방금 읽은 DB 값 + 신뢰 기기 쿠키의 email 로만 구성합니다.
    //   이전 세션 쿠키의 값을 복사하지 않으므로 강등이 즉시 반영됩니다.
    const isMaster = isMasterEmail(device.email);
    const driverName = row.name ?? device.driverName;
    const session: GoogleSession = {
      email: device.email,
      name: driverName ?? device.email,
      driverId: row.id,
      driverName,
      // 구글 콜백과 동일 규칙 — 마스터는 rank 와 무관하게 관장.
      rank: isMaster ? "관장" : row.rank,
      hasProfile: true,
      isMaster,
    };

    const store = await cookies();
    store.set(GOOGLE_SESSION_COOKIE, serializeGoogleSession(session), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // 구글 로그인과 동일한 8시간.
      maxAge: GOOGLE_SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : "PIN 확인 중 오류가 발생했습니다.",
    };
  }
}
