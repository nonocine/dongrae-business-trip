"use client";

import {
  EDUCATION_DEGREES,
  FAMILY_RELATIONS,
  type EmployeeEducation,
  type EmployeeFamily,
  type EmployeeLicense,
  type EmployeeCareer,
} from "@/lib/supabase";
import { tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

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
  | "appointment";

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: "basic", label: "기본정보" },
  { key: "education", label: "학력" },
  { key: "family", label: "가족" },
  { key: "license", label: "자격증" },
  { key: "career", label: "경력" },
  { key: "award", label: "수상" },
  { key: "training", label: "교육이수" },
  { key: "appointment", label: "인사발령" },
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
