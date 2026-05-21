"use client";

import { EDUCATION_DEGREES, type EmployeeEducation } from "@/lib/supabase";
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
// 학력 동적 폼
// =====================================================================
const eduInputBase =
  "block w-full rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const eduLabelCls = "text-xs font-medium text-ink-muted";

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
  function update(idx: number, patch: Partial<EmployeeEducation>) {
    onChange(education.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function add() {
    onChange([...education, emptyEducation()]);
  }
  function remove(idx: number) {
    onChange(education.filter((_, i) => i !== idx));
  }

  const fieldCls = readOnly
    ? `${eduInputBase} cursor-not-allowed bg-surface text-ink-muted`
    : `${eduInputBase} bg-card`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          학력 사항을 입력하세요. 항목이 없어도 저장됩니다.
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={add}
            className="shrink-0 rounded-md border border-navy bg-card px-2.5 py-1 text-xs font-semibold text-navy hover:bg-navy-soft"
          >
            ＋ 학력 추가
          </button>
        )}
      </div>

      {education.length === 0 ? (
        <p className="rounded-md border border-dashed border-line bg-surface px-3 py-6 text-center text-xs text-ink-hint">
          등록된 학력이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {education.map((edu, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-line bg-hr-bg p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-navy">
                  학력 {idx + 1}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="rounded-md border border-stamp bg-card px-2 py-0.5 text-xs font-medium text-stamp hover:bg-stamp-soft"
                  >
                    🗑 삭제
                  </button>
                )}
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className={eduLabelCls}>학교명</label>
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
                  <label className={eduLabelCls}>전공 (선택)</label>
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
                  <label className={eduLabelCls}>구분</label>
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
                    <label className={eduLabelCls}>입학</label>
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
                    <label className={eduLabelCls}>졸업</label>
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
                  <label className={eduLabelCls}>비고 (선택)</label>
                  <input
                    type="text"
                    value={edu.note}
                    onChange={(e) => update(idx, { note: e.target.value })}
                    readOnly={readOnly}
                    placeholder="장학생 · 우수상 등"
                    className={`mt-0.5 ${fieldCls}`}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
