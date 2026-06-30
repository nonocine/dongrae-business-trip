"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  saveMyProfile,
  uploadMyProfilePhoto,
  deleteMyProfilePhoto,
  getMyPhotoUrl,
  getMyStampUrl,
  uploadMyStamp,
  deleteMyStamp,
  uploadMyDocument,
  deleteMyDocument,
  getMyDocumentUrl,
  getMyEmployeeRoles,
} from "@/app/profile/hr/actions";
import SignaturePad from "@/app/components/SignaturePad";
import {
  parseResidentNumber,
  normalizeEducationList,
  normalizeFamilyList,
  normalizeLicenseList,
  normalizeCareerList,
  normalizeAwardList,
  normalizeTrainingList,
  normalizeAppointmentList,
  type EmployeeProfile,
  type EmployeeEducation,
  type EmployeeFamily,
  type EmployeeLicense,
  type EmployeeCareer,
  type EmployeeAward,
  type EmployeeTraining,
  type EmployeeAppointment,
} from "@/lib/supabase";
import {
  ProfileTabs,
  EducationTab,
  FamilyTab,
  LicenseTab,
  CareerTab,
  AwardTab,
  TrainingTab,
  AppointmentTab,
  EmployeeDocumentsSection,
  EmployeeRolesSection,
  type ProfileTabKey,
} from "@/app/hr/ProfileFormParts";
import {
  btnPrimary,
  badgeSuccess,
  badgeWarning,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// 인사기록카드 양식 — 네이비 굵은 테두리 + #FAFAFA 배경
const formCardCls =
  "rounded-xl border-2 border-hr-border bg-hr-bg p-4 shadow-sm sm:p-5";
const baseInputCls =
  "mt-1 block w-full rounded-md border border-line px-3 py-2 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const labelCls = "block text-xs font-bold text-navy";

// "1984-02-24" → "1984년 2월 24일"
function formatBirthDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${Number(y)}년 ${Number(m)}월 ${Number(day)}일`;
}

// 작성일 표기 — updated_at 우선, 없으면 created_at, 프로필 없으면 "신규"
function formatDocDate(profile: EmployeeProfile | null): string {
  if (!profile) return "신규";
  const d = profile.updated_at ?? profile.created_at;
  if (!d) return "—";
  return d.slice(0, 10).replaceAll("-", ".");
}

export default function MyEmployeeProfileForm({
  driverId,
  driverName,
  profile,
}: {
  driverId: string;
  driverName: string;
  profile: EmployeeProfile | null;
}) {
  const locked = profile?.is_locked === true;

  const [tab, setTab] = useState<ProfileTabKey>("basic");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 주민번호는 제어 입력 — 입력 즉시 생년월일·성별을 재계산합니다.
  const [rrn, setRrn] = useState(profile?.resident_number ?? "");
  const parsed = useMemo(() => parseResidentNumber(rrn), [rrn]);
  const rrnFilled = rrn.trim().length > 0;

  // 재직 중 여부 — 첫 로드 시 leave_date 없으면 재직 중.
  const [employed, setEmployed] = useState(!profile?.leave_date);
  const [education, setEducation] = useState<EmployeeEducation[]>(() =>
    normalizeEducationList(profile?.education ?? [])
  );
  const [family, setFamily] = useState<EmployeeFamily[]>(() =>
    normalizeFamilyList(profile?.family ?? [])
  );
  const [licenses, setLicenses] = useState<EmployeeLicense[]>(() =>
    normalizeLicenseList(profile?.licenses ?? [])
  );
  const [careers, setCareers] = useState<EmployeeCareer[]>(() =>
    normalizeCareerList(profile?.career ?? [])
  );
  const [awards, setAwards] = useState<EmployeeAward[]>(() =>
    normalizeAwardList(profile?.awards ?? [])
  );
  const [trainings, setTrainings] = useState<EmployeeTraining[]>(() =>
    normalizeTrainingList(profile?.trainings ?? [])
  );
  const [appointments, setAppointments] = useState<EmployeeAppointment[]>(
    () => normalizeAppointmentList(profile?.appointments ?? [])
  );

  // 증명사진 — 마운트 시 1시간 임시 URL 조회
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoUploading, photoTransition] = useTransition();

  // 도장(사인) — 면접 심사표 (인) 자리에 자동 삽입될 손도장.
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [stampError, setStampError] = useState<string | null>(null);
  const [stampPending, stampTransition] = useTransition();
  const [stampModal, setStampModal] = useState(false);
  const [stampDraw, setStampDraw] = useState<string | null>(null);

  // 담당 직무(읽기전용) — 마운트 시 로드. null=로딩중.
  const [roles, setRoles] = useState<string[] | null>(null);

  const fieldCls = locked
    ? `${baseInputCls} cursor-not-allowed bg-surface text-ink-muted`
    : `${baseInputCls} bg-card`;
  const leaveCls =
    locked || employed
      ? `${baseInputCls} cursor-not-allowed bg-surface text-ink-muted`
      : `${baseInputCls} bg-card`;

  useEffect(() => {
    let alive = true;
    getMyPhotoUrl().then((url) => {
      if (alive) setPhotoUrl(url);
    });
    getMyStampUrl().then((url) => {
      if (alive) setStampUrl(url);
    });
    getMyEmployeeRoles().then((r) => {
      if (alive) setRoles(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  function handleStampSave() {
    if (!stampDraw) {
      setStampError("도장(사인)을 먼저 그려주세요.");
      return;
    }
    setStampError(null);
    stampTransition(async () => {
      const fd = new FormData();
      fd.set("stamp_data_url", stampDraw);
      const res = await uploadMyStamp(fd);
      if (res.ok) {
        setStampUrl(res.stampUrl);
        setStampModal(false);
        setStampDraw(null);
      } else {
        setStampError(res.message);
      }
    });
  }

  function handleStampDelete() {
    if (!confirm("등록된 도장(사인)을 삭제할까요?")) return;
    setStampError(null);
    stampTransition(async () => {
      const res = await deleteMyStamp();
      if (res.ok) setStampUrl(null);
      else setStampError(res.message);
    });
  }

  function handlePhotoUpload(file: File) {
    setPhotoError(null);
    photoTransition(async () => {
      const fd = new FormData();
      fd.set("photo", file);
      const res = await uploadMyProfilePhoto(fd);
      if (res.ok) setPhotoUrl(res.photoUrl);
      else setPhotoError(res.message);
    });
  }

  function handlePhotoDelete() {
    if (!confirm("증명사진을 삭제할까요?")) return;
    setPhotoError(null);
    photoTransition(async () => {
      const res = await deleteMyProfilePhoto();
      if (res.ok) setPhotoUrl(null);
      else setPhotoError(res.message);
    });
  }

  // 첨부서류 — 본인(self) 서버액션을 콜백으로 주입(driver_id 는 세션에서 도출).
  const onDocUpload = (docKey: string, file: File) => {
    const fd = new FormData();
    fd.set("doc_key", docKey);
    fd.set("file", file);
    return uploadMyDocument(fd);
  };
  const onDocDelete = (docKey: string) => deleteMyDocument(docKey);
  const onDocOpen = (docKey: string) => getMyDocumentUrl(docKey);

  return (
    <div className="space-y-5">
      {locked && (
        <div className="rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          🔒 관장님이 확정한 인사기록카드입니다. 수정하려면 관장님께
          요청하세요.
        </div>
      )}

      <section className={formCardCls}>
        {/* 양식 배너 */}
        <div className="flex items-end justify-between border-b-2 border-hr-border pb-3">
          <h3 className="text-base font-bold tracking-[0.35em] text-navy sm:text-lg">
            인사기록카드
          </h3>
          <span className="shrink-0 pb-0.5 text-xs text-ink-muted">
            작성일 {formatDocDate(profile)}
          </span>
        </div>

        {/* 직원명 + 상태 */}
        <div className="mt-3 flex items-center justify-between">
          <h4 className="text-sm font-bold text-ink">{driverName}</h4>
          <span
            className={
              locked ? badgeWarning : profile ? badgeSuccess : badgeNeutral
            }
          >
            {locked ? "🔒 잠김" : profile ? "입력됨" : "미입력"}
          </span>
        </div>

        <div className="mt-3">
          <ProfileTabs current={tab} onChange={setTab} />
        </div>

        <form
          action={(formData) => {
            setError(null);
            setOk(null);
            startTransition(async () => {
              try {
                await saveMyProfile(formData);
                setOk("저장되었습니다.");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "저장 중 오류가 발생했습니다."
                );
              }
            });
          }}
          className="mt-4 space-y-3"
        >
          <input type="hidden" name="driver_id" value={driverId} />
          <input
            type="hidden"
            name="education"
            value={JSON.stringify(education)}
          />
          <input type="hidden" name="family" value={JSON.stringify(family)} />
          <input
            type="hidden"
            name="licenses"
            value={JSON.stringify(licenses)}
          />
          <input type="hidden" name="career" value={JSON.stringify(careers)} />
          <input type="hidden" name="awards" value={JSON.stringify(awards)} />
          <input
            type="hidden"
            name="trainings"
            value={JSON.stringify(trainings)}
          />
          <input
            type="hidden"
            name="appointments"
            value={JSON.stringify(appointments)}
          />

          {/* 기본정보 탭 */}
          <div className={tab === "basic" ? "" : "hidden"}>
            {/* 증명사진 */}
            <div className="mb-4 flex items-start gap-4">
              <div className="h-32 w-24 shrink-0 overflow-hidden rounded-md border border-line bg-card">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrl}
                    alt="증명사진"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl text-ink-hint">
                    👤
                  </div>
                )}
              </div>
              {!locked && (
                <div className="flex flex-col items-start gap-1.5">
                  <label
                    className={`cursor-pointer rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft ${
                      photoUploading ? "pointer-events-none opacity-60" : ""
                    }`}
                  >
                    {photoUploading ? "처리 중…" : "사진 변경"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={photoUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) handlePhotoUpload(f);
                      }}
                    />
                  </label>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={handlePhotoDelete}
                      disabled={photoUploading}
                      className="rounded-lg border border-stamp bg-card px-3 py-1.5 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
                    >
                      삭제
                    </button>
                  )}
                  <p className="text-[11px] text-ink-hint">
                    JPG · PNG · WEBP, 8MB 이하
                  </p>
                  {photoError && (
                    <p className="text-xs text-stamp">{photoError}</p>
                  )}
                </div>
              )}
            </div>

            {/* 도장(사인) — 면접 심사표 (인) 자리에 자동 삽입 */}
            <div className="mb-4 flex items-start gap-4 rounded-lg border border-line bg-card p-3">
              <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white">
                {stampUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={stampUrl}
                    alt="내 도장"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-ink-hint">도장 없음</span>
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <p className="text-xs font-bold text-navy">도장(사인)</p>
                <p className="text-[11px] text-ink-hint">
                  면접 심사표의 “(인)” 자리에 자동으로 들어갑니다.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStampDraw(null);
                      setStampError(null);
                      setStampModal(true);
                    }}
                    disabled={stampPending}
                    className="rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft disabled:opacity-60"
                  >
                    {stampUrl ? "다시 그리기" : "사인(도장) 넣기"}
                  </button>
                  {stampUrl && (
                    <button
                      type="button"
                      onClick={handleStampDelete}
                      disabled={stampPending}
                      className="rounded-lg border border-stamp bg-card px-3 py-1.5 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
                    >
                      삭제
                    </button>
                  )}
                </div>
                {stampError && (
                  <p className="text-xs text-stamp">{stampError}</p>
                )}
              </div>
            </div>

            {stampModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                onClick={() => !stampPending && setStampModal(false)}
              >
                <div
                  className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-base font-bold text-ink">
                    도장(사인) 그리기
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    마우스나 손가락으로 도장 대신 사용할 사인을 그려주세요.
                  </p>
                  <SignaturePad value={stampDraw} onChange={setStampDraw} />
                  {stampError && (
                    <p className={`mt-2 ${noticeError}`}>{stampError}</p>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setStampModal(false)}
                      disabled={stampPending}
                      className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface disabled:opacity-60"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleStampSave}
                      disabled={stampPending || !stampDraw}
                      className={`${btnPrimary} disabled:opacity-60`}
                    >
                      {stampPending ? "저장 중…" : "저장"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>한자명</label>
                <input
                  name="name_chinese"
                  type="text"
                  defaultValue={profile?.name_chinese ?? ""}
                  placeholder="洪吉童"
                  readOnly={locked}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className={labelCls}>주민등록번호</label>
                <input
                  name="resident_number"
                  type="text"
                  value={rrn}
                  onChange={(e) => setRrn(e.target.value)}
                  placeholder="000000-0000000"
                  readOnly={locked}
                  className={`${fieldCls} font-mono`}
                />
                {rrnFilled &&
                  (parsed ? (
                    <p className="mt-1 text-xs text-success">
                      → 생년월일:{" "}
                      {parsed.birthDate
                        ? formatBirthDate(parsed.birthDate)
                        : "-"}{" "}
                      / 성별: {parsed.gender ?? "-"}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-stamp">
                      → 형식이 올바르지 않습니다
                    </p>
                  ))}
                <p className="mt-1 text-[11px] text-ink-hint">
                  생년월일·성별은 주민등록번호에서 자동 계산됩니다. 외국인 등은
                  비워두세요.
                </p>
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>주소</label>
                <input
                  name="address"
                  type="text"
                  defaultValue={profile?.address ?? ""}
                  placeholder="부산광역시 동래구 …"
                  readOnly={locked}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className={labelCls}>이메일</label>
                <input
                  name="email"
                  type="email"
                  defaultValue={profile?.email ?? ""}
                  placeholder="name@example.com"
                  readOnly={locked}
                  className={fieldCls}
                />
              </div>
              <div>
                <label className={labelCls}>전화번호</label>
                <input
                  name="phone"
                  type="tel"
                  defaultValue={profile?.phone ?? ""}
                  placeholder="010-0000-0000"
                  readOnly={locked}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className={labelCls}>입사일</label>
                <input
                  name="join_date"
                  type="date"
                  defaultValue={profile?.join_date ?? ""}
                  readOnly={locked}
                  className={fieldCls}
                />
              </div>
              <div>
                <label className={labelCls}>퇴사일</label>
                <label className="mt-1 flex items-center gap-1.5 text-sm text-ink-body">
                  <input
                    type="checkbox"
                    name="employed"
                    checked={employed}
                    onChange={(e) => setEmployed(e.target.checked)}
                    disabled={locked}
                    className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
                  />
                  재직 중
                </label>
                <input
                  name="leave_date"
                  type="date"
                  defaultValue={profile?.leave_date ?? ""}
                  disabled={employed || locked}
                  className={leaveCls}
                />
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>병역 (선택)</label>
                <input
                  name="military_service"
                  type="text"
                  defaultValue={profile?.military_service ?? ""}
                  placeholder="예: 육군 병장 만기전역 / 해당없음"
                  readOnly={locked}
                  className={fieldCls}
                />
              </div>
            </div>

            {/* 담당 직무 — 본인은 열람만(변경은 관장·부장) */}
            {roles !== null && (
              <EmployeeRolesSection initialRoles={roles} readOnly />
            )}
          </div>

          {/* 학력 탭 */}
          <div className={tab === "education" ? "" : "hidden"}>
            <EducationTab
              education={education}
              onChange={setEducation}
              readOnly={locked}
            />
          </div>

          {/* 가족 탭 */}
          <div className={tab === "family" ? "" : "hidden"}>
            <FamilyTab family={family} onChange={setFamily} readOnly={locked} />
          </div>

          {/* 자격증 탭 */}
          <div className={tab === "license" ? "" : "hidden"}>
            <LicenseTab
              licenses={licenses}
              onChange={setLicenses}
              readOnly={locked}
            />
          </div>

          {/* 경력 탭 */}
          <div className={tab === "career" ? "" : "hidden"}>
            <CareerTab
              careers={careers}
              onChange={setCareers}
              readOnly={locked}
            />
          </div>

          {/* 수상 탭 */}
          <div className={tab === "award" ? "" : "hidden"}>
            <AwardTab awards={awards} onChange={setAwards} readOnly={locked} />
          </div>

          {/* 교육이수 탭 */}
          <div className={tab === "training" ? "" : "hidden"}>
            <TrainingTab
              trainings={trainings}
              onChange={setTrainings}
              readOnly={locked}
            />
          </div>

          {/* 인사발령 탭 */}
          <div className={tab === "appointment" ? "" : "hidden"}>
            <AppointmentTab
              appointments={appointments}
              onChange={setAppointments}
              readOnly={locked}
            />
          </div>

          {/* 첨부서류 탭 */}
          <div className={tab === "documents" ? "" : "hidden"}>
            <EmployeeDocumentsSection
              initialDocuments={profile?.documents ?? {}}
              readOnly={locked}
              onUpload={onDocUpload}
              onDelete={onDocDelete}
              onOpen={onDocOpen}
            />
          </div>

          {error && <p className={noticeError}>{error}</p>}
          {ok && <p className={noticeSuccess}>{ok}</p>}

          {!locked && (
            <button
              type="submit"
              disabled={pending}
              className={`${btnPrimary} w-full sm:w-auto sm:px-6`}
            >
              {pending ? "저장 중…" : "저장"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
