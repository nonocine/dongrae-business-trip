"use client";

import { useState } from "react";
import {
  EDUCATION_DEGREES,
  FAMILY_RELATIONS,
  APPOINTMENT_TYPES,
  type EmployeeEducation,
  type EmployeeFamily,
  type EmployeeLicense,
  type EmployeeCareer,
  type EmployeeAward,
  type EmployeeTraining,
  type EmployeeAppointment,
} from "@/lib/supabase";
import { EMPLOYEE_DOC_SLOTS, type EmployeeDocItem } from "@/lib/employeeDocs";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

// 서버액션 결과(공통) — { ok } 판별 유니온.
type ActionResult = { ok: true } | { ok: false; message: string };

// =====================================================================
// 인사기록카드 탭 (편집 화면)
// =====================================================================
export type ProfileTabKey =
  | "basic"
  | "education"
  | "family"
  | "license"
  | "career"
  | "award"
  | "training"
  | "appointment"
  | "documents";

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: "basic", label: "기본정보" },
  { key: "education", label: "학력" },
  { key: "family", label: "가족" },
  { key: "license", label: "자격증" },
  { key: "career", label: "경력" },
  { key: "award", label: "수상" },
  { key: "training", label: "교육이수" },
  { key: "appointment", label: "인사발령" },
  { key: "documents", label: "첨부서류" },
];

export function ProfileTabs({
  current,
  onChange,
}: {
  current: ProfileTabKey;
  onChange: (t: ProfileTabKey) => void;
}) {
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {PROFILE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={tabItemCls(t.key === current)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// 아직 구현되지 않은 탭의 안내 카드
export function PlaceholderTab({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface py-16 text-center">
      <div aria-hidden className="text-4xl text-ink-hint">
        🗂
      </div>
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      <p className="text-xs text-ink-hint">다음 단계에서 제공될 예정입니다.</p>
    </div>
  );
}

// =====================================================================
// 동적 폼 공통 스타일/부품
// =====================================================================
const subInputBase =
  "block w-full rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const subLabelCls = "text-xs font-medium text-ink-muted";

function fieldClsOf(readOnly: boolean): string {
  return readOnly
    ? `${subInputBase} cursor-not-allowed bg-surface text-ink-muted`
    : `${subInputBase} bg-card`;
}

// 동적 폼 카드 한 칸 (추가 버튼 / 빈 상태 / 항목 카드 머리)
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md border border-navy bg-card px-2.5 py-1 text-xs font-semibold text-navy hover:bg-navy-soft"
    >
      ＋ {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-stamp bg-card px-2 py-0.5 text-xs font-medium text-stamp hover:bg-stamp-soft"
    >
      🗑 삭제
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-line bg-surface px-3 py-6 text-center text-xs text-ink-hint">
      {text}
    </p>
  );
}

// 항목 카드 래퍼
function ItemCard({
  index,
  label,
  readOnly,
  onRemove,
  children,
}: {
  index: number;
  label: string;
  readOnly: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-line bg-hr-bg p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-navy">
          {label} {index + 1}
        </span>
        {!readOnly && <RemoveButton onClick={onRemove} />}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {children}
      </div>
    </li>
  );
}

// =====================================================================
// 학력
// =====================================================================
function emptyEducation(): EmployeeEducation {
  return {
    school: "",
    major: "",
    degree: "졸업",
    enter_date: "",
    graduate_date: "",
    note: "",
  };
}

export function EducationTab({
  education,
  onChange,
  readOnly,
}: {
  education: EmployeeEducation[];
  onChange: (next: EmployeeEducation[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeEducation>) {
    onChange(education.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          학력 사항을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="학력 추가"
            onClick={() => onChange([...education, emptyEducation()])}
          />
        )}
      </div>

      {education.length === 0 ? (
        <EmptyHint text="등록된 학력이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {education.map((edu, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="학력"
              readOnly={readOnly}
              onRemove={() => onChange(education.filter((_, i) => i !== idx))}
            >
              <div>
                <label className={subLabelCls}>학교명</label>
                <input
                  type="text"
                  value={edu.school}
                  onChange={(e) => update(idx, { school: e.target.value })}
                  readOnly={readOnly}
                  placeholder="○○대학교"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>전공 (선택)</label>
                <input
                  type="text"
                  value={edu.major}
                  onChange={(e) => update(idx, { major: e.target.value })}
                  readOnly={readOnly}
                  placeholder="○○학과"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>구분</label>
                <select
                  value={edu.degree}
                  onChange={(e) =>
                    update(idx, {
                      degree: e.target.value as EmployeeEducation["degree"],
                    })
                  }
                  disabled={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                >
                  {EDUCATION_DEGREES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={subLabelCls}>입학</label>
                  <input
                    type="month"
                    value={edu.enter_date}
                    onChange={(e) =>
                      update(idx, { enter_date: e.target.value })
                    }
                    readOnly={readOnly}
                    className={`mt-0.5 ${fieldCls}`}
                  />
                </div>
                <div>
                  <label className={subLabelCls}>졸업</label>
                  <input
                    type="month"
                    value={edu.graduate_date}
                    onChange={(e) =>
                      update(idx, { graduate_date: e.target.value })
                    }
                    readOnly={readOnly}
                    className={`mt-0.5 ${fieldCls}`}
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>비고 (선택)</label>
                <input
                  type="text"
                  value={edu.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  placeholder="장학생 · 우수상 등"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 가족
// =====================================================================
function emptyFamily(): EmployeeFamily {
  return {
    relation: "자녀",
    name: "",
    birth_date: "",
    occupation: "",
    cohabit: false,
    note: "",
  };
}

export function FamilyTab({
  family,
  onChange,
  readOnly,
}: {
  family: EmployeeFamily[];
  onChange: (next: EmployeeFamily[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeFamily>) {
    onChange(family.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          가족 사항을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="가족 추가"
            onClick={() => onChange([...family, emptyFamily()])}
          />
        )}
      </div>

      {family.length === 0 ? (
        <EmptyHint text="등록된 가족이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {family.map((fam, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="가족"
              readOnly={readOnly}
              onRemove={() => onChange(family.filter((_, i) => i !== idx))}
            >
              <div>
                <label className={subLabelCls}>관계</label>
                <select
                  value={fam.relation}
                  onChange={(e) =>
                    update(idx, {
                      relation: e.target.value as EmployeeFamily["relation"],
                    })
                  }
                  disabled={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                >
                  {FAMILY_RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={subLabelCls}>이름</label>
                <input
                  type="text"
                  value={fam.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  readOnly={readOnly}
                  placeholder="홍길동"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>생년월일</label>
                <input
                  type="date"
                  value={fam.birth_date}
                  onChange={(e) => update(idx, { birth_date: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>직업 (선택)</label>
                <input
                  type="text"
                  value={fam.occupation}
                  onChange={(e) => update(idx, { occupation: e.target.value })}
                  readOnly={readOnly}
                  placeholder="회사원 · 학생 등"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-1.5 text-sm text-ink-body">
                  <input
                    type="checkbox"
                    checked={fam.cohabit}
                    onChange={(e) => update(idx, { cohabit: e.target.checked })}
                    disabled={readOnly}
                    className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
                  />
                  동거 중
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>비고 (선택)</label>
                <input
                  type="text"
                  value={fam.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 자격증
// =====================================================================
function emptyLicense(): EmployeeLicense {
  return {
    name: "",
    issuer: "",
    acquired_date: "",
    registration_number: "",
    note: "",
  };
}

export function LicenseTab({
  licenses,
  onChange,
  readOnly,
}: {
  licenses: EmployeeLicense[];
  onChange: (next: EmployeeLicense[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeLicense>) {
    onChange(licenses.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          자격증·면허를 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="자격증 추가"
            onClick={() => onChange([...licenses, emptyLicense()])}
          />
        )}
      </div>

      {licenses.length === 0 ? (
        <EmptyHint text="등록된 자격증이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {licenses.map((lic, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="자격증"
              readOnly={readOnly}
              onRemove={() => onChange(licenses.filter((_, i) => i !== idx))}
            >
              <div>
                <label className={subLabelCls}>자격증명</label>
                <input
                  type="text"
                  value={lic.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  readOnly={readOnly}
                  placeholder="청소년지도사 2급"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>발급기관</label>
                <input
                  type="text"
                  value={lic.issuer}
                  onChange={(e) => update(idx, { issuer: e.target.value })}
                  readOnly={readOnly}
                  placeholder="여성가족부"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>취득일</label>
                <input
                  type="date"
                  value={lic.acquired_date}
                  onChange={(e) =>
                    update(idx, { acquired_date: e.target.value })
                  }
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>등록번호 (선택)</label>
                <input
                  type="text"
                  value={lic.registration_number}
                  onChange={(e) =>
                    update(idx, { registration_number: e.target.value })
                  }
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>비고 (선택)</label>
                <input
                  type="text"
                  value={lic.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 경력
// =====================================================================
function emptyCareer(): EmployeeCareer {
  return {
    company: "",
    department: "",
    start_date: "",
    end_date: "",
    current: false,
    duties: "",
    note: "",
  };
}

export function CareerTab({
  careers,
  onChange,
  readOnly,
}: {
  careers: EmployeeCareer[];
  onChange: (next: EmployeeCareer[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeCareer>) {
    onChange(careers.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          경력 사항을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="경력 추가"
            onClick={() => onChange([...careers, emptyCareer()])}
          />
        )}
      </div>

      {careers.length === 0 ? (
        <EmptyHint text="등록된 경력이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {careers.map((car, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="경력"
              readOnly={readOnly}
              onRemove={() => onChange(careers.filter((_, i) => i !== idx))}
            >
              <div>
                <label className={subLabelCls}>회사명</label>
                <input
                  type="text"
                  value={car.company}
                  onChange={(e) => update(idx, { company: e.target.value })}
                  readOnly={readOnly}
                  placeholder="○○회사"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>부서 / 직위</label>
                <input
                  type="text"
                  value={car.department}
                  onChange={(e) => update(idx, { department: e.target.value })}
                  readOnly={readOnly}
                  placeholder="기획팀 / 대리"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>시작일</label>
                <input
                  type="date"
                  value={car.start_date}
                  onChange={(e) => update(idx, { start_date: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>종료일</label>
                <label className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-body">
                  <input
                    type="checkbox"
                    checked={car.current}
                    onChange={(e) =>
                      update(
                        idx,
                        e.target.checked
                          ? { current: true, end_date: "" }
                          : { current: false }
                      )
                    }
                    disabled={readOnly}
                    className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
                  />
                  현재 재직
                </label>
                <input
                  type="date"
                  value={car.end_date}
                  onChange={(e) => update(idx, { end_date: e.target.value })}
                  readOnly={readOnly}
                  disabled={car.current}
                  className={
                    car.current ? fieldClsOf(true) : `${fieldCls}`
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>담당업무</label>
                <textarea
                  value={car.duties}
                  onChange={(e) => update(idx, { duties: e.target.value })}
                  readOnly={readOnly}
                  rows={3}
                  className={`mt-0.5 resize-y ${fieldCls}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>비고 (선택)</label>
                <input
                  type="text"
                  value={car.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 수상
// =====================================================================
function emptyAward(): EmployeeAward {
  return { name: "", issuer: "", date: "", reason: "", note: "" };
}

export function AwardTab({
  awards,
  onChange,
  readOnly,
}: {
  awards: EmployeeAward[];
  onChange: (next: EmployeeAward[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeAward>) {
    onChange(awards.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          수상 내역을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="수상 추가"
            onClick={() => onChange([...awards, emptyAward()])}
          />
        )}
      </div>

      {awards.length === 0 ? (
        <EmptyHint text="등록된 수상 내역이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {awards.map((awd, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="수상"
              readOnly={readOnly}
              onRemove={() => onChange(awards.filter((_, i) => i !== idx))}
            >
              <div>
                <label className={subLabelCls}>상명</label>
                <input
                  type="text"
                  value={awd.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  readOnly={readOnly}
                  placeholder="○○상"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>시상기관</label>
                <input
                  type="text"
                  value={awd.issuer}
                  onChange={(e) => update(idx, { issuer: e.target.value })}
                  readOnly={readOnly}
                  placeholder="여성가족부"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>수상일</label>
                <input
                  type="date"
                  value={awd.date}
                  onChange={(e) => update(idx, { date: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>비고 (선택)</label>
                <input
                  type="text"
                  value={awd.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>수상 이유 (선택)</label>
                <textarea
                  value={awd.reason}
                  onChange={(e) => update(idx, { reason: e.target.value })}
                  readOnly={readOnly}
                  rows={2}
                  className={`mt-0.5 resize-y ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 교육이수
// =====================================================================
function emptyTraining(): EmployeeTraining {
  return {
    name: "",
    institution: "",
    start_date: "",
    end_date: "",
    hours: "",
    note: "",
  };
}

export function TrainingTab({
  trainings,
  onChange,
  readOnly,
}: {
  trainings: EmployeeTraining[];
  onChange: (next: EmployeeTraining[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeTraining>) {
    onChange(trainings.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          교육이수 내역을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="교육 추가"
            onClick={() => onChange([...trainings, emptyTraining()])}
          />
        )}
      </div>

      {trainings.length === 0 ? (
        <EmptyHint text="등록된 교육이수 내역이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {trainings.map((trn, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="교육"
              readOnly={readOnly}
              onRemove={() => onChange(trainings.filter((_, i) => i !== idx))}
            >
              <div>
                <label className={subLabelCls}>교육명</label>
                <input
                  type="text"
                  value={trn.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  readOnly={readOnly}
                  placeholder="○○ 직무교육"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>기관</label>
                <input
                  type="text"
                  value={trn.institution}
                  onChange={(e) =>
                    update(idx, { institution: e.target.value })
                  }
                  readOnly={readOnly}
                  placeholder="한국청소년활동진흥원"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>시작일</label>
                <input
                  type="date"
                  value={trn.start_date}
                  onChange={(e) => update(idx, { start_date: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>종료일</label>
                <input
                  type="date"
                  value={trn.end_date}
                  onChange={(e) => update(idx, { end_date: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>이수 시간</label>
                <input
                  type="text"
                  value={trn.hours}
                  onChange={(e) => update(idx, { hours: e.target.value })}
                  readOnly={readOnly}
                  placeholder="예: 16시간"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>비고 (선택)</label>
                <input
                  type="text"
                  value={trn.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 인사발령
// =====================================================================
function emptyAppointment(): EmployeeAppointment {
  return {
    type: "입사",
    title: "",
    department: "",
    effective_date: "",
    note: "",
  };
}

export function AppointmentTab({
  appointments,
  onChange,
  readOnly,
}: {
  appointments: EmployeeAppointment[];
  onChange: (next: EmployeeAppointment[]) => void;
  readOnly: boolean;
}) {
  const fieldCls = fieldClsOf(readOnly);
  function update(idx: number, patch: Partial<EmployeeAppointment>) {
    onChange(appointments.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          인사발령 내역을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <AddButton
            label="발령 추가"
            onClick={() => onChange([...appointments, emptyAppointment()])}
          />
        )}
      </div>

      {appointments.length === 0 ? (
        <EmptyHint text="등록된 인사발령 내역이 없습니다." />
      ) : (
        <ul className="space-y-3">
          {appointments.map((apt, idx) => (
            <ItemCard
              key={idx}
              index={idx}
              label="발령"
              readOnly={readOnly}
              onRemove={() =>
                onChange(appointments.filter((_, i) => i !== idx))
              }
            >
              <div>
                <label className={subLabelCls}>발령 유형</label>
                <select
                  value={apt.type}
                  onChange={(e) =>
                    update(idx, {
                      type: e.target.value as EmployeeAppointment["type"],
                    })
                  }
                  disabled={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                >
                  {APPOINTMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={subLabelCls}>직위 / 직책</label>
                <input
                  type="text"
                  value={apt.title}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  readOnly={readOnly}
                  placeholder="팀장"
                  className={`mt-0.5 font-semibold ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>부서</label>
                <input
                  type="text"
                  value={apt.department}
                  onChange={(e) => update(idx, { department: e.target.value })}
                  readOnly={readOnly}
                  placeholder="활동지원팀"
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div>
                <label className={subLabelCls}>발령일</label>
                <input
                  type="date"
                  value={apt.effective_date}
                  onChange={(e) =>
                    update(idx, { effective_date: e.target.value })
                  }
                  readOnly={readOnly}
                  className={`mt-0.5 ${fieldCls}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={subLabelCls}>비고 (선택)</label>
                <textarea
                  value={apt.note}
                  onChange={(e) => update(idx, { note: e.target.value })}
                  readOnly={readOnly}
                  rows={2}
                  className={`mt-0.5 resize-y ${fieldCls}`}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// 첨부서류 탭 — 직원 인사기록 첨부서류 10종(EMPLOYEE_DOC_SLOTS).
//   * HR 직원관리 폼과 직원 본인 마이페이지가 공유합니다.
//   * 업로드/삭제/열람 동작은 콜백으로 주입 — HR/본인 각자의 서버액션을 연결.
//   * 파일은 즉시 업로드(폼 저장과 무관). path 는 서버가 documents jsonb 에 보관.
// =====================================================================
export function EmployeeDocumentsSection({
  initialDocuments,
  readOnly,
  onUpload,
  onDelete,
  onOpen,
}: {
  initialDocuments: Record<string, string>;
  readOnly: boolean;
  onUpload: (docKey: string, file: File) => Promise<ActionResult>;
  onDelete: (docKey: string) => Promise<ActionResult>;
  onOpen: (docKey: string) => Promise<string | null>;
}) {
  const [uploaded, setUploaded] = useState<Set<string>>(
    () => new Set(Object.keys(initialDocuments))
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleUpload(docKey: string, file: File) {
    if (file.size > 16 * 1024 * 1024) {
      setError("파일 용량은 16MB 이하여야 합니다.");
      return;
    }
    setError(null);
    setBusyKey(docKey);
    onUpload(docKey, file)
      .then((res) => {
        if (res.ok) {
          setUploaded((prev) => new Set(prev).add(docKey));
        } else {
          setError(res.message);
        }
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? `업로드 실패: ${e.message}`
            : "업로드 중 오류가 발생했습니다."
        )
      )
      .finally(() => setBusyKey(null));
  }

  function handleDelete(docKey: string) {
    if (!confirm("첨부 파일을 삭제할까요?")) return;
    setError(null);
    setBusyKey(docKey);
    onDelete(docKey)
      .then((res) => {
        if (res.ok) {
          setUploaded((prev) => {
            const next = new Set(prev);
            next.delete(docKey);
            return next;
          });
        } else {
          setError(res.message);
        }
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? `삭제 실패: ${e.message}`
            : "삭제 중 오류가 발생했습니다."
        )
      )
      .finally(() => setBusyKey(null));
  }

  function handleOpen(docKey: string) {
    setError(null);
    setBusyKey(docKey);
    onOpen(docKey)
      .then((url) => {
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        else setError("열람 URL을 발급하지 못했습니다.");
      })
      .catch(() => setError("열람 중 오류가 발생했습니다."))
      .finally(() => setBusyKey(null));
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        PDF · JPG · PNG · WEBP, 파일당 16MB 이하. 여러 장이면 1개 파일로 합쳐
        첨부하세요.
      </p>
      <ul className="space-y-2">
        {EMPLOYEE_DOC_SLOTS.map((doc) => (
          <EmployeeDocRow
            key={doc.key}
            doc={doc}
            uploaded={uploaded.has(doc.key)}
            busy={busyKey === doc.key}
            readOnly={readOnly}
            onPick={(file) => handleUpload(doc.key, file)}
            onOpen={() => handleOpen(doc.key)}
            onDelete={() => handleDelete(doc.key)}
          />
        ))}
      </ul>
      {error && <p className="text-xs text-stamp">{error}</p>}
    </div>
  );
}

function EmployeeDocRow({
  doc,
  uploaded,
  busy,
  readOnly,
  onPick,
  onOpen,
  onDelete,
}: {
  doc: EmployeeDocItem;
  uploaded: boolean;
  busy: boolean;
  readOnly: boolean;
  onPick: (file: File) => void;
  onOpen: () => void;
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
          {uploaded && (
            <button
              type="button"
              onClick={onOpen}
              disabled={busy}
              className="rounded-lg border border-brand-blue bg-card px-2.5 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft disabled:opacity-60"
            >
              열기 ↗
            </button>
          )}
          {!readOnly && (
            <label
              className={`cursor-pointer rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {busy ? "처리 중…" : uploaded ? "교체" : "업로드"}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onPick(f);
                }}
              />
            </label>
          )}
          {!readOnly && uploaded && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
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
