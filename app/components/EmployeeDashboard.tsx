import Link from "next/link";
import { getMyProfile, getMyPhotoUrl } from "@/app/profile/hr/actions";
import { cardCls } from "@/lib/ui";

// "1984-02-24" → "1984년 2월 24일". 형식이 다르면 원본 그대로.
function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${Number(y)}년 ${Number(m)}월 ${Number(day)}일`;
}

// 정보 한 줄(라벨 + 값). 값이 없으면 흐리게 "-".
function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="w-16 shrink-0 text-xs font-semibold text-navy">
        {label}
      </span>
      <span
        className={`min-w-0 break-words text-sm ${
          value ? "text-ink-body" : "text-ink-hint"
        }`}
      >
        {value || "-"}
      </span>
    </div>
  );
}

// 직원 로그인 후 첫 화면(대시보드)의 프로필 위젯.
//   * 본인↔driver 매칭은 기존 getMyProfile()/getMyPhotoUrl() 패턴 재사용
//     (세션에서 도출, 폼값 신뢰 금지 — actions 내부에서 처리).
//   * employee_profiles 에 없는 정보(부서/팀)는 표시하지 않습니다.
export default async function EmployeeDashboard({
  kind,
  name,
}: {
  kind: "admin" | "employee";
  name: string | null;
}) {
  // 관리자(별도 비번 세션)는 인사기록카드 개념이 없음 — 인사말만 표시.
  if (kind === "admin") {
    return (
      <section className={cardCls}>
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
          관리자 님, 안녕하세요 👋
        </h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          상단 메뉴에서 업무를 시작하세요.
        </p>
      </section>
    );
  }

  // 본인 인사정보 + 증명사진(서명 URL)을 병렬 조회.
  const [my, photoUrl] = await Promise.all([getMyProfile(), getMyPhotoUrl()]);

  const driver = my?.driver ?? null;
  const profile = my?.profile ?? null;

  const displayName = driver?.name ?? name ?? "";
  const rank = driver?.rank ?? null;
  const email = profile?.email ?? null;
  const phone = profile?.phone ?? null;
  const joinDate = formatDate(profile?.join_date);

  // 핵심 인사정보가 모두 비어있으면 입력 안내를 강조.
  const profileEmpty =
    !profile ||
    (!profile.email &&
      !profile.phone &&
      !profile.join_date &&
      !profile.address);

  return (
    <div className="space-y-4">
      {/* 인사말 헤더 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {displayName} 님, 안녕하세요 👋
          </h2>
          {rank && (
            <span className="rounded-full bg-navy-soft px-2.5 py-0.5 text-xs font-bold text-navy">
              {rank}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-ink-muted">
          오늘도 좋은 하루 되세요. 내 정보를 확인하고 관리할 수 있습니다.
        </p>
      </section>

      {/* 본인 프로필 카드 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold tracking-wide text-navy">
          내 프로필
        </h3>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* 증명사진 (없으면 기본 아바타 + 안내) */}
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt={`${displayName} 증명사진`}
                className="h-28 w-24 rounded-lg border border-line object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-28 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-surface">
                <span aria-hidden className="text-4xl">
                  👤
                </span>
                <span className="text-[10px] font-medium text-ink-hint">
                  사진 없음
                </span>
              </div>
            )}
            {!photoUrl && (
              <Link
                href="/profile/hr"
                className="text-[11px] font-semibold text-brand-blue hover:underline"
              >
                사진 등록
              </Link>
            )}
          </div>

          {/* 인사정보 */}
          <div className="w-full min-w-0">
            <div className="divide-y divide-line/70">
              <InfoRow label="이름" value={displayName || null} />
              <InfoRow label="직급" value={rank} />
              <InfoRow label="이메일" value={email} />
              <InfoRow label="입사일" value={joinDate} />
              <InfoRow label="연락처" value={phone} />
            </div>
          </div>
        </div>

        {/* 인사정보 미입력 안내 */}
        {profileEmpty && (
          <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2.5 text-sm font-medium text-warning">
            아직 인사정보가 없습니다. 아래 버튼에서 인사정보를 입력해주세요.
          </p>
        )}

        {/* 인사정보 입력/수정 → 기존 /profile/hr */}
        <Link
          href="/profile/hr"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-strong sm:w-auto sm:self-start"
        >
          내 인사정보 입력/수정 →
        </Link>
      </section>
    </div>
  );
}
