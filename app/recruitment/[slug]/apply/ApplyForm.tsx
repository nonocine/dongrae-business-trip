"use client";

import { useEffect, useState, useTransition } from "react";
import {
  EducationTab,
  LicenseTab,
  CareerTab,
  AwardTab,
  TrainingTab,
} from "@/app/hr/ProfileFormParts";
import {
  normalizeEducationList,
  normalizeLicenseList,
  normalizeCareerList,
  normalizeAwardList,
  normalizeTrainingList,
  type EmployeeEducation,
  type EmployeeLicense,
  type EmployeeCareer,
  type EmployeeAward,
  type EmployeeTraining,
} from "@/lib/supabase";
import {
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";
import {
  saveApplicationDraft,
  submitApplication,
  uploadApplicantPhoto,
  deleteApplicantPhoto,
  uploadApplicantDocument,
  deleteApplicantDocument,
  signApplicantStoragePath,
  type ApplyPosting,
  type RecruitmentApplicant,
  type RecruitmentApplication,
  type RequiredDoc,
} from "./actions";

// 양식 톤 — 인사기록카드와 같은 굵은 테두리 + #FAFAFA 배경.
// 채용 지원 폼은 센터 로고의 파란색 계열로 강조합니다.
const formCardCls =
  "rounded-xl border-2 border-brand-blue bg-hr-bg p-4 shadow-sm sm:p-6 lg:p-8";
const baseInputCls =
  "mt-1 block w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";
const labelCls = "block text-xs font-bold text-brand-blue sm:text-sm";

// 채용 지원 폼 전용 버튼 / 탭 — 로고 파랑 사용.
const applyBtnPrimary =
  "inline-flex h-[40px] items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-blue-strong disabled:opacity-60";

// 탭 — 알약형 배너. 기본은 회색, 활성은 로고 파랑 배경 + 흰색 텍스트 + 약간 크게.
function applyTabItemCls(active: boolean): string {
  const base =
    "whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 ease-out";
  return active
    ? `${base} bg-brand-blue text-white shadow-md scale-[1.06]`
    : `${base} bg-surface text-ink-muted hover:bg-brand-blue-soft hover:text-brand-blue`;
}

type ApplyTabKey =
  | "basic"
  | "education"
  | "license"
  | "career"
  | "award"
  | "training"
  | "statement"
  | "documents"
  | "agree";

const APPLY_TABS: { key: ApplyTabKey; label: string }[] = [
  { key: "basic", label: "기본정보" },
  { key: "education", label: "학력" },
  { key: "license", label: "자격" },
  { key: "career", label: "경력" },
  { key: "award", label: "수상" },
  { key: "training", label: "교육이수" },
  { key: "statement", label: "자기소개서" },
  { key: "documents", label: "첨부서류" },
  { key: "agree", label: "동의·제출" },
];

const TAB_ORDER: ApplyTabKey[] = APPLY_TABS.map((t) => t.key);

const STATEMENT_MAX = 500;

// 글자 수 카운트 — 단순 character length(코드포인트 차이 무시).
function len(s: string): number {
  return s.length;
}

export default function ApplyForm({
  posting,
  initialApplicant,
  initialApplication,
  kakaoNickname,
}: {
  posting: ApplyPosting;
  initialApplicant: RecruitmentApplicant | null;
  initialApplication: RecruitmentApplication | null;
  kakaoNickname: string;
}) {
  // 이미 제출 완료된 지원서면 폼 자체를 비활성화하고 안내만 노출.
  const alreadySubmitted =
    !!initialApplication && initialApplication.status !== "draft";

  const [tab, setTab] = useState<ApplyTabKey>("basic");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // 식별자 — 첫 임시저장 이후 확보됨.
  const [applicantId, setApplicantId] = useState<string | null>(
    initialApplicant?.id ?? null
  );
  const [applicantNumber, setApplicantNumber] = useState<string>(
    initialApplicant?.applicant_number ?? ""
  );

  // 기본정보 — 신규 지원자는 카카오 닉네임을 이름 기본값으로 사용.
  const [email, setEmail] = useState(initialApplicant?.email ?? "");
  const [name, setName] = useState(
    initialApplicant?.name ?? kakaoNickname ?? ""
  );
  const [birthDate, setBirthDate] = useState(initialApplicant?.birth_date ?? "");
  const [gender, setGender] = useState<"M" | "F" | "">(
    initialApplicant?.gender ?? ""
  );
  const [address, setAddress] = useState(initialApplicant?.address ?? "");
  const [phone, setPhone] = useState(initialApplicant?.phone ?? "");

  // jsonb 배열
  const [education, setEducation] = useState<EmployeeEducation[]>(() =>
    normalizeEducationList(initialApplicant?.education ?? [])
  );
  const [licenses, setLicenses] = useState<EmployeeLicense[]>(() =>
    normalizeLicenseList(initialApplicant?.licenses ?? [])
  );
  const [careers, setCareers] = useState<EmployeeCareer[]>(() =>
    normalizeCareerList(initialApplicant?.career ?? [])
  );
  const [awards, setAwards] = useState<EmployeeAward[]>(() =>
    normalizeAwardList(initialApplicant?.awards ?? [])
  );
  const [trainings, setTrainings] = useState<EmployeeTraining[]>(() =>
    normalizeTrainingList(initialApplicant?.trainings ?? [])
  );

  // 자기소개서
  const [motivation, setMotivation] = useState(
    initialApplicant?.motivation ?? ""
  );
  const [selfDev, setSelfDev] = useState(
    initialApplicant?.self_development ?? ""
  );
  const [careerSummary, setCareerSummary] = useState(
    initialApplicant?.career_summary ?? ""
  );
  const [philosophy, setPhilosophy] = useState(
    initialApplicant?.philosophy ?? ""
  );

  // 동의
  const [agreedPrivacy, setAgreedPrivacy] = useState(
    initialApplicant?.agreed_privacy === true
  );
  const [agreedCriminal, setAgreedCriminal] = useState(
    initialApplicant?.agreed_criminal_check === true
  );
  const [agreedTruth, setAgreedTruth] = useState(
    initialApplicant?.agreed_truth === true
  );

  // 사진 (Private 버킷 → 1시간 임시 URL)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, photoTransition] = useTransition();

  // 첨부서류 path 상태 — key: storagePath
  const [docPaths, setDocPaths] = useState<Record<string, string>>(
    () => ({ ...(initialApplicant?.documents ?? {}) })
  );
  const [docError, setDocError] = useState<string | null>(null);
  const [docBusyKey, setDocBusyKey] = useState<string | null>(null);

  // 사진 임시 URL 발급 — applicant 로드 시 1회. 실패해도 페이지는 살아남게 catch.
  //   path 가 없으면 그냥 종료 — photoUrl 초기값이 이미 null 이므로 동기 setState
  //   (연쇄 렌더 유발)는 불필요합니다.
  useEffect(() => {
    let alive = true;
    const path = initialApplicant?.photo_url ?? null;
    if (!path) return;
    signApplicantStoragePath(path)
      .then((url) => {
        if (alive) setPhotoUrl(url);
      })
      .catch(() => {
        if (alive) setPhotoUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [initialApplicant?.photo_url]);

  // 폼 → FormData 변환 — 모든 저장/제출 경로에서 공통.
  function buildFormData(): FormData {
    const fd = new FormData();
    if (applicantId) fd.set("applicant_id", applicantId);
    fd.set("email", email);
    fd.set("name", name);
    fd.set("birth_date", birthDate);
    if (gender) fd.set("gender", gender);
    fd.set("address", address);
    fd.set("phone", phone);
    fd.set("education", JSON.stringify(education));
    fd.set("licenses", JSON.stringify(licenses));
    fd.set("career", JSON.stringify(careers));
    fd.set("awards", JSON.stringify(awards));
    fd.set("trainings", JSON.stringify(trainings));
    fd.set("motivation", motivation);
    fd.set("self_development", selfDev);
    fd.set("career_summary", careerSummary);
    fd.set("philosophy", philosophy);
    if (agreedPrivacy) fd.set("agreed_privacy", "on");
    if (agreedCriminal) fd.set("agreed_criminal_check", "on");
    if (agreedTruth) fd.set("agreed_truth", "on");
    return fd;
  }

  function handleSaveDraft() {
    if (alreadySubmitted) return;
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const res = await saveApplicationDraft(posting.slug, buildFormData());
        if (res.ok) {
          setApplicantId(res.applicantId);
          if (res.applicantNumber) setApplicantNumber(res.applicantNumber);
          setOk("임시저장되었습니다.");
        } else {
          setError(res.message);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? `저장 실패: ${e.message}`
            : "임시저장 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  function handleSubmit() {
    if (alreadySubmitted) return;
    if (!agreedPrivacy || !agreedCriminal || !agreedTruth) {
      setError("모든 동의 항목에 체크해주세요.");
      return;
    }
    if (!confirm("제출 후에는 수정할 수 없습니다. 제출하시겠습니까?")) return;
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const res = await submitApplication(posting.slug, buildFormData());
        if (res.ok) {
          setApplicantId(res.applicantId);
          if (res.applicantNumber) setApplicantNumber(res.applicantNumber);
          // 페이지를 새로 불러와 제출 완료 상태로 전환.
          if (typeof window !== "undefined") window.location.reload();
        } else {
          setError(res.message);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? `제출 실패: ${e.message}`
            : "제출 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  // 사진 / 첨부 파일 크기는 8~16MB 가능 — Server Action 본문 한도(20MB)는
  // next.config.ts 에서 설정. 그래도 네트워크 끊김 등으로 throw 가 올라올 수 있어
  // 모든 호출을 try/catch 로 감쌉니다.
  function handlePhotoUpload(file: File) {
    if (!applicantId) {
      setPhotoError("먼저 기본정보를 입력하고 임시저장을 눌러주세요.");
      return;
    }
    // 클라이언트 단 사전 검증 — Server Action 한도(20MB) 안쪽 + 비즈니스 한도(8MB).
    if (file.size > 8 * 1024 * 1024) {
      setPhotoError("사진 용량은 8MB 이하여야 합니다.");
      return;
    }
    setPhotoError(null);
    photoTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("slug", posting.slug);
        fd.set("applicant_id", applicantId);
        fd.set("photo", file);
        const res = await uploadApplicantPhoto(fd);
        if (res.ok) setPhotoUrl(res.photoUrl);
        else setPhotoError(res.message);
      } catch (e) {
        setPhotoError(
          e instanceof Error
            ? `업로드 실패: ${e.message}`
            : "사진 업로드 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  function handlePhotoDelete() {
    if (!applicantId) return;
    if (!confirm("증명사진을 삭제할까요?")) return;
    setPhotoError(null);
    photoTransition(async () => {
      try {
        const res = await deleteApplicantPhoto(posting.slug, applicantId);
        if (res.ok) setPhotoUrl(null);
        else setPhotoError(res.message);
      } catch (e) {
        setPhotoError(
          e instanceof Error
            ? `삭제 실패: ${e.message}`
            : "사진 삭제 중 오류가 발생했습니다."
        );
      }
    });
  }

  function handleDocUpload(docKey: string, file: File) {
    if (!applicantId) {
      setDocError("먼저 기본정보를 입력하고 임시저장을 눌러주세요.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      setDocError("파일 용량은 16MB 이하여야 합니다.");
      return;
    }
    setDocError(null);
    setDocBusyKey(docKey);
    const fd = new FormData();
    fd.set("slug", posting.slug);
    fd.set("applicant_id", applicantId);
    fd.set("doc_key", docKey);
    fd.set("file", file);
    uploadApplicantDocument(fd)
      .then((res) => {
        if (res.ok) {
          // 표시는 "업로드됨" 으로만 하므로 sentinel 값(빈 문자열 아님)만 저장.
          // 실제 경로는 서버가 documents jsonb 에 보관하고 있고, 제출 시 검증됩니다.
          setDocPaths((prev) => ({ ...prev, [docKey]: "uploaded" }));
        } else {
          setDocError(res.message);
        }
      })
      .catch((e: unknown) => {
        setDocError(
          e instanceof Error
            ? `업로드 실패: ${e.message}`
            : "파일 업로드 중 알 수 없는 오류가 발생했습니다."
        );
      })
      .finally(() => setDocBusyKey(null));
  }

  function handleDocDelete(docKey: string) {
    if (!applicantId) return;
    if (!confirm("첨부 파일을 삭제할까요?")) return;
    setDocError(null);
    setDocBusyKey(docKey);
    deleteApplicantDocument(posting.slug, applicantId, docKey)
      .then((res) => {
        if (res.ok) {
          setDocPaths((prev) => {
            const next = { ...prev };
            delete next[docKey];
            return next;
          });
        } else {
          setDocError(res.message);
        }
      })
      .catch((e: unknown) => {
        setDocError(
          e instanceof Error
            ? `삭제 실패: ${e.message}`
            : "파일 삭제 중 오류가 발생했습니다."
        );
      })
      .finally(() => setDocBusyKey(null));
  }

  function goNextTab() {
    const idx = TAB_ORDER.indexOf(tab);
    if (idx >= 0 && idx < TAB_ORDER.length - 1) setTab(TAB_ORDER[idx + 1]);
  }

  function goPrevTab() {
    const idx = TAB_ORDER.indexOf(tab);
    if (idx > 0) setTab(TAB_ORDER[idx - 1]);
  }

  const readOnly = alreadySubmitted;

  // 첨부서류 — 필수 항목 누락 체크(제출 탭 표시용)
  const missingRequiredDocs = posting.required_documents.filter(
    (d) => d.required && !docPaths[d.key]
  );

  return (
    <div className="space-y-4">
      {alreadySubmitted && (
        <div className={noticeSuccess}>
          이미 접수 완료된 지원서입니다. 수정할 수 없습니다.
          {applicantNumber && (
            <span className="ml-2 font-mono">({applicantNumber})</span>
          )}
        </div>
      )}

      <section className={formCardCls}>
        {/* 양식 배너 */}
        <div className="flex items-end justify-between border-b-2 border-brand-blue pb-3">
          <h3 className="text-base font-bold tracking-[0.35em] text-brand-blue sm:text-lg lg:text-xl">
            채용지원서
          </h3>
          <span className="shrink-0 pb-0.5 text-xs text-ink-muted">
            {applicantNumber ? (
              <span className="font-mono">접수번호 {applicantNumber}</span>
            ) : (
              "신규 작성"
            )}
          </span>
        </div>

        {/* 공고 제목 + 상태 */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-ink sm:text-base">
            {posting.title}
          </h4>
          <span className={alreadySubmitted ? badgeSuccess : badgeNeutral}>
            {alreadySubmitted ? "접수 완료" : "작성 중"}
          </span>
        </div>

        {/* 진행바 — 9개 탭 중 현재 위치, 로고 그린(가장 밝은 톤)으로 표시 */}
        <ProgressBar current={TAB_ORDER.indexOf(tab)} total={TAB_ORDER.length} />

        {/* 탭 네비 — 알약형 배너. 활성 탭은 로고 파랑 + 약간 확대 */}
        <div className="mt-4 overflow-x-auto pb-1">
          <nav className="flex min-w-max items-center gap-2 py-1">
            {APPLY_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={applyTabItemCls(t.key === tab)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-4 space-y-3">
          {/* 1) 기본정보 */}
          <div className={tab === "basic" ? "" : "hidden"}>
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
              {!readOnly && (
                <div className="flex flex-col items-start gap-1.5">
                  <label
                    className={`cursor-pointer rounded-lg border border-brand-blue bg-card px-3 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft ${
                      photoBusy || !applicantId
                        ? "pointer-events-none opacity-60"
                        : ""
                    }`}
                  >
                    {photoBusy ? "처리 중…" : "사진 변경"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={photoBusy || !applicantId}
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
                      disabled={photoBusy}
                      className="rounded-lg border border-stamp bg-card px-3 py-1.5 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
                    >
                      삭제
                    </button>
                  )}
                  <p className="text-[11px] text-ink-hint">
                    JPG · PNG · WEBP, 8MB 이하
                  </p>
                  {!applicantId && (
                    <p className="text-[11px] text-ink-hint">
                      ※ 임시저장 이후 업로드 가능
                    </p>
                  )}
                  {photoError && (
                    <p className="text-xs text-stamp">{photoError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-2">
                <label className={labelCls}>이메일 *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={readOnly}
                  placeholder="name@example.com"
                  className={baseInputCls}
                />
                <p className="mt-1 text-[11px] text-ink-hint">
                  본인 식별과 결과 통보에 사용됩니다.
                </p>
              </div>
              <div className="lg:col-span-2">
                <label className={labelCls}>연락처 *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  readOnly={readOnly}
                  placeholder="010-0000-0000"
                  className={baseInputCls}
                />
              </div>
              <div className="lg:col-span-2">
                <label className={labelCls}>이름 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={readOnly}
                  placeholder="홍길동"
                  className={baseInputCls}
                />
              </div>
              <div>
                <label className={labelCls}>생년월일 *</label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  readOnly={readOnly}
                  className={baseInputCls}
                />
              </div>
              <div>
                <label className={labelCls}>성별</label>
                <select
                  value={gender}
                  onChange={(e) =>
                    setGender(e.target.value as "M" | "F" | "")
                  }
                  disabled={readOnly}
                  className={baseInputCls}
                >
                  <option value="">선택</option>
                  <option value="M">남자</option>
                  <option value="F">여자</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label className={labelCls}>주소</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  readOnly={readOnly}
                  placeholder="부산광역시 동래구 …"
                  className={baseInputCls}
                />
              </div>
            </div>
          </div>

          {/* 2) 학력 */}
          <div className={tab === "education" ? "" : "hidden"}>
            <EducationTab
              education={education}
              onChange={setEducation}
              readOnly={readOnly}
            />
          </div>

          {/* 3) 자격사항 */}
          <div className={tab === "license" ? "" : "hidden"}>
            <LicenseTab
              licenses={licenses}
              onChange={setLicenses}
              readOnly={readOnly}
            />
          </div>

          {/* 4) 경력사항 */}
          <div className={tab === "career" ? "" : "hidden"}>
            <CareerTab
              careers={careers}
              onChange={setCareers}
              readOnly={readOnly}
            />
          </div>

          {/* 5) 수상경력 */}
          <div className={tab === "award" ? "" : "hidden"}>
            <AwardTab
              awards={awards}
              onChange={setAwards}
              readOnly={readOnly}
            />
          </div>

          {/* 6) 교육이수 */}
          <div className={tab === "training" ? "" : "hidden"}>
            <TrainingTab
              trainings={trainings}
              onChange={setTrainings}
              readOnly={readOnly}
            />
          </div>

          {/* 7) 자기소개서 */}
          <div className={tab === "statement" ? "" : "hidden"}>
            <p className="mb-2 text-xs text-ink-muted">
              각 항목은 500자 이내로 작성해주세요.
            </p>
            <StatementField
              label="지원 동기 및 입사 후 포부"
              value={motivation}
              onChange={setMotivation}
              readOnly={readOnly}
            />
            <StatementField
              label="자기개발 계획"
              value={selfDev}
              onChange={setSelfDev}
              readOnly={readOnly}
            />
            <StatementField
              label="직무관련 경력 및 활동 결과"
              value={careerSummary}
              onChange={setCareerSummary}
              readOnly={readOnly}
            />
            <StatementField
              label="청소년관 · 직업관 · 삶의 철학"
              value={philosophy}
              onChange={setPhilosophy}
              readOnly={readOnly}
            />
          </div>

          {/* 8) 첨부서류 */}
          <div className={tab === "documents" ? "" : "hidden"}>
            <p className="text-xs text-ink-muted">
              PDF, JPG, PNG, WEBP — 파일당 16MB 이하.
            </p>
            {!applicantId && !readOnly && (
              <p className={`${noticeWarning} mt-2`}>
                먼저 기본정보를 입력하고 “임시저장”을 눌러주세요. 임시저장
                이후에 서류를 업로드할 수 있습니다.
              </p>
            )}
            <ul className="mt-3 space-y-2">
              {posting.required_documents.map((d) => (
                <DocumentRow
                  key={d.key}
                  doc={d}
                  uploaded={!!docPaths[d.key]}
                  busy={docBusyKey === d.key}
                  disabled={!applicantId || readOnly}
                  onPick={(file) => handleDocUpload(d.key, file)}
                  onDelete={() => handleDocDelete(d.key)}
                />
              ))}
            </ul>
            {docError && <p className={`${noticeError} mt-2`}>{docError}</p>}
          </div>

          {/* 9) 동의 및 제출 */}
          <div className={tab === "agree" ? "" : "hidden"}>
            <ul className="space-y-2">
              <AgreeRow
                checked={agreedPrivacy}
                onChange={setAgreedPrivacy}
                readOnly={readOnly}
                label="개인정보 수집·이용 동의"
                desc="제출하신 지원서의 개인정보는 채용 절차 진행 및 합격자 통보 목적으로만 이용되며, 관계법령에 따라 보관 후 안전하게 파기됩니다."
              />
              <AgreeRow
                checked={agreedCriminal}
                onChange={setAgreedCriminal}
                readOnly={readOnly}
                label="범죄경력 조회 동의"
                desc="청소년 보호법 등 관계법령에 따라 최종 합격 시 범죄경력 조회가 진행될 수 있으며, 이에 동의합니다."
              />
              <AgreeRow
                checked={agreedTruth}
                onChange={setAgreedTruth}
                readOnly={readOnly}
                label="허위 기재 시 합격 취소 동의"
                desc="지원서에 기재된 사항이 사실과 다를 경우 합격이 취소될 수 있음에 동의합니다."
              />
            </ul>

            {missingRequiredDocs.length > 0 && (
              <p className={`${noticeWarning} mt-3`}>
                필수 첨부서류가 누락되었습니다 —{" "}
                {missingRequiredDocs.map((d) => d.label).join(", ")}
              </p>
            )}

            {!readOnly && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  pending ||
                  !agreedPrivacy ||
                  !agreedCriminal ||
                  !agreedTruth ||
                  missingRequiredDocs.length > 0
                }
                className={`${applyBtnPrimary} mt-4 w-full sm:w-auto sm:px-10`}
              >
                {pending ? "제출 중…" : "최종 제출"}
              </button>
            )}
          </div>

          {error && <p className={noticeError}>{error}</p>}
          {ok && <p className={noticeSuccess}>{ok}</p>}

          {/* 탭 네비게이션 + 임시저장 — 동의 탭에서는 제출 버튼이 별도. */}
          {!readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={goPrevTab}
                  disabled={TAB_ORDER.indexOf(tab) === 0}
                  className={btnSecondary}
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={goNextTab}
                  disabled={TAB_ORDER.indexOf(tab) === TAB_ORDER.length - 1}
                  className={btnSecondary}
                >
                  다음
                </button>
              </div>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={pending}
                className={applyBtnPrimary}
              >
                {pending ? "저장 중…" : "임시저장"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// =====================================================================
// 자기소개서 한 문항
// =====================================================================
function StatementField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
}) {
  const count = len(value);
  const over = count > STATEMENT_MAX;
  return (
    <div className="mb-4">
      <div className="flex items-end justify-between">
        <label className={labelCls}>{label}</label>
        <span
          className={`text-[11px] ${
            over ? "text-stamp" : "text-ink-hint"
          }`}
        >
          {count} / {STATEMENT_MAX}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={6}
        maxLength={STATEMENT_MAX}
        className={`${baseInputCls} resize-y`}
      />
    </div>
  );
}

// =====================================================================
// 첨부서류 한 줄
// =====================================================================
function DocumentRow({
  doc,
  uploaded,
  busy,
  disabled,
  onPick,
  onDelete,
}: {
  doc: RequiredDoc;
  uploaded: boolean;
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-ink">{doc.label}</span>
            {doc.required ? (
              <span className="rounded-full bg-stamp-soft px-1.5 py-0.5 text-[10px] font-semibold text-stamp">
                필수
              </span>
            ) : (
              <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                선택
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-ink-hint">
            {uploaded ? "업로드됨" : "파일을 선택해주세요"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label
            className={`cursor-pointer rounded-lg border border-brand-blue bg-card px-3 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft ${
              disabled || busy ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {busy ? "업로드 중…" : uploaded ? "교체" : "업로드"}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onPick(f);
              }}
            />
          </label>
          {uploaded && (
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled || busy}
              className="rounded-lg border border-stamp bg-card px-2.5 py-1.5 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
            >
              삭제
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// =====================================================================
// 진행바 — 로고 색상 중 가장 선명한 그린으로 채웁니다.
// =====================================================================
function ProgressBar({ current, total }: { current: number; total: number }) {
  const safeTotal = total > 0 ? total : 1;
  const pct = Math.max(0, Math.min(100, ((current + 1) / safeTotal) * 100));
  return (
    <div className="mt-3">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-brand-green shadow-[0_0_8px_rgba(95,173,67,0.5)] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-muted">
        <span>
          단계 {current + 1} / {safeTotal}
        </span>
        <span className="font-semibold text-brand-green">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}

// =====================================================================
// 동의 한 줄
// =====================================================================
function AgreeRow({
  checked,
  onChange,
  readOnly,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  readOnly: boolean;
  label: string;
  desc: string;
}) {
  return (
    <li className="rounded-lg border border-line bg-card p-3 shadow-sm">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={readOnly}
          className="mt-0.5 h-4 w-4 rounded border-line text-brand-blue focus:ring-brand-blue"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{desc}</p>
        </div>
      </label>
    </li>
  );
}
