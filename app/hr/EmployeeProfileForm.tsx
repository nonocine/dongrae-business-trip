"use client";

import { useMemo, useState, useTransition } from "react";
import { saveEmployeeProfile, deleteEmployeeProfile } from "@/app/hr/actions";
import {
  parseResidentNumber,
  normalizeEducationList,
  type Driver,
  type EmployeeProfile,
  type EmployeeEducation,
} from "@/lib/supabase";
import {
  ProfileTabs,
  EducationTab,
  PlaceholderTab,
  type ProfileTabKey,
} from "@/app/hr/ProfileFormParts";

const cardCls =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
const baseInputCls =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelCls = "block text-xs font-medium text-slate-600";

// "1984-02-24" → "1984년 2월 24일"
function formatBirthDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${Number(y)}년 ${Number(m)}월 ${Number(day)}일`;
}

export default function EmployeeProfileForm({
  driver,
  profile,
  onDeleted,
}: {
  driver: Driver;
  profile: EmployeeProfile | null;
  onDeleted: () => void;
}) {
  const locked = profile?.is_locked === true;

  const [tab, setTab] = useState<ProfileTabKey>("basic");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, deleteTransition] = useTransition();

  // 주민번호는 제어 입력 — 입력 즉시 생년월일·성별을 재계산합니다.
  const [rrn, setRrn] = useState(profile?.resident_number ?? "");
  const parsed = useMemo(() => parseResidentNumber(rrn), [rrn]);
  const rrnFilled = rrn.trim().length > 0;

  // 재직 중 여부 — 첫 로드 시 leave_date 없으면 재직 중.
  const [employed, setEmployed] = useState(!profile?.leave_date);
  const [education, setEducation] = useState<EmployeeEducation[]>(() =>
    normalizeEducationList(profile?.education ?? [])
  );

  const fieldCls = locked
    ? `${baseInputCls} cursor-not-allowed bg-slate-100 text-slate-500`
    : `${baseInputCls} bg-white`;
  const leaveCls =
    locked || employed
      ? `${baseInputCls} cursor-not-allowed bg-slate-100 text-slate-500`
      : `${baseInputCls} bg-white`;

  return (
    <div className="space-y-4">
      {locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🔒 잠긴 인사기록카드입니다. 수정하려면 먼저 잠금을 해제해야 합니다.
          (잠금 해제 기능은 다음 단계에서 제공됩니다.)
        </div>
      )}

      <section className={`${cardCls} ${locked ? "bg-slate-50" : ""}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            {driver.name}
            {driver.rank && (
              <span className="ml-1 text-xs font-normal text-slate-400">
                ({driver.rank})
              </span>
            )}{" "}
            인사기록카드
          </h3>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              locked
                ? "bg-amber-100 text-amber-700"
                : profile
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
            }`}
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
                await saveEmployeeProfile(formData);
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
          <input type="hidden" name="driver_id" value={driver.id} />
          <input
            type="hidden"
            name="education"
            value={JSON.stringify(education)}
          />

          {/* 기본정보 탭 */}
          <div className={tab === "basic" ? "" : "hidden"}>
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
                    <p className="mt-1 text-xs text-emerald-600">
                      → 생년월일:{" "}
                      {parsed.birthDate
                        ? formatBirthDate(parsed.birthDate)
                        : "-"}{" "}
                      / 성별: {parsed.gender ?? "-"}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-red-600">
                      → 형식이 올바르지 않습니다
                    </p>
                  ))}
                <p className="mt-1 text-[11px] text-slate-400">
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
                <label className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="employed"
                    checked={employed}
                    onChange={(e) => setEmployed(e.target.checked)}
                    disabled={locked}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
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
          </div>

          {/* 학력 탭 */}
          <div className={tab === "education" ? "" : "hidden"}>
            <EducationTab
              education={education}
              onChange={setEducation}
              readOnly={locked}
            />
          </div>

          {/* 미구현 탭 */}
          <div className={tab === "family" ? "" : "hidden"}>
            <PlaceholderTab title="가족 사항" />
          </div>
          <div className={tab === "license" ? "" : "hidden"}>
            <PlaceholderTab title="자격증" />
          </div>
          <div className={tab === "career" ? "" : "hidden"}>
            <PlaceholderTab title="경력" />
          </div>
          <div className={tab === "award" ? "" : "hidden"}>
            <PlaceholderTab title="수상" />
          </div>
          <div className={tab === "training" ? "" : "hidden"}>
            <PlaceholderTab title="교육이수" />
          </div>
          <div className={tab === "appointment" ? "" : "hidden"}>
            <PlaceholderTab title="인사발령" />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {ok && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {ok}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {!locked && (
              <button
                type="submit"
                disabled={pending}
                className="h-[38px] w-full rounded-md bg-blue-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-60 sm:w-auto sm:px-6"
              >
                {pending ? "저장 중…" : "저장"}
              </button>
            )}

            {profile && (
              <button
                type="button"
                disabled={deletePending || locked}
                onClick={() => {
                  if (locked) return;
                  if (
                    !confirm(
                      `${driver.name}님의 인사기록카드를 삭제할까요?\n복구할 수 없습니다.`
                    )
                  )
                    return;
                  setError(null);
                  setOk(null);
                  deleteTransition(async () => {
                    try {
                      await deleteEmployeeProfile(driver.id);
                      onDeleted();
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "삭제 중 오류가 발생했습니다."
                      );
                    }
                  });
                }}
                className="h-[38px] w-full rounded-md border border-red-500 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 sm:w-auto sm:px-6"
              >
                {deletePending ? "삭제 중…" : "삭제"}
              </button>
            )}
          </div>

          {locked && profile && (
            <p className="text-xs text-slate-500">
              🔒 잠금 상태에서는 삭제할 수 없습니다.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
