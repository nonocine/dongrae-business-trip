"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createSalaryYear,
  listGradeTable,
  listConfig,
  listEmployeeSalaryRows,
  saveGradeRow,
  deleteGradeRow,
  saveConfigRow,
  deleteConfigRow,
  saveEmployeeSalaryRows,
  type SalaryEmployee,
} from "@/app/hr/salary/actions";
import {
  CERT_LEVEL_OPTIONS,
  EMPTY_SALARY_EXTRA,
  formatKRW,
  sortGradeRows,
  gradeSortKey,
  validateMonthRanges,
  type SalaryGradeRow,
  type SalaryConfigRow,
  type EmployeeSalaryProfileRow,
  type SalaryExtra,
} from "@/lib/salary";
import {
  cardCls,
  tabBarCls,
  tabNavCls,
  tabItemCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

type SectionKey = "grade" | "config" | "employee";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function SalaryManager({
  initialYear,
  years,
  gradeTable,
  config,
  employees,
  salaryRows,
}: {
  initialYear: number;
  years: number[];
  gradeTable: SalaryGradeRow[];
  config: SalaryConfigRow[];
  employees: SalaryEmployee[];
  salaryRows: EmployeeSalaryProfileRow[];
}) {
  const [section, setSection] = useState<SectionKey>("grade");
  const [year, setYear] = useState<number>(initialYear);
  const [yearList, setYearList] = useState<number[]>(
    years.length > 0 ? years : [initialYear]
  );

  // 연도 종속 데이터 — 서버에서 새로 불러와 교체.
  const [grades, setGrades] = useState<SalaryGradeRow[]>(gradeTable);
  const [configs, setConfigs] = useState<SalaryConfigRow[]>(config);
  const [rows, setRows] = useState<EmployeeSalaryProfileRow[]>(salaryRows);
  const [loading, startLoad] = useTransition();

  function reload(targetYear: number) {
    startLoad(async () => {
      const [g, c, r] = await Promise.all([
        listGradeTable(targetYear),
        listConfig(targetYear),
        listEmployeeSalaryRows(targetYear),
      ]);
      setGrades(g);
      setConfigs(c);
      setRows(r);
    });
  }

  function onYearChange(y: number) {
    setYear(y);
    reload(y);
  }

  return (
    <div className="space-y-5">
      {/* 연도 선택 + 연도 추가 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-navy">기준 연도</label>
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="rounded-md border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          >
            {yearList.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          {loading && (
            <span className="text-xs text-ink-hint">불러오는 중…</span>
          )}
          <AddYearButton
            existingYears={yearList}
            latestYear={yearList[0] ?? year}
            onCreated={(newYear, next) => {
              setYearList(next);
              onYearChange(newYear);
            }}
          />
        </div>
      </section>

      {/* 섹션 탭 */}
      <div className={tabBarCls}>
        <nav className={tabNavCls}>
          {(
            [
              { key: "grade", label: "호봉표" },
              { key: "config", label: "급여 기준값" },
              { key: "employee", label: "직원별 급여 설정" },
            ] as { key: SectionKey; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSection(t.key)}
              className={tabItemCls(t.key === section)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {section === "grade" && (
        <GradeTableSection
          year={year}
          grades={grades}
          onRefresh={() => reload(year)}
        />
      )}
      {section === "config" && (
        <ConfigSection
          year={year}
          configs={configs}
          onRefresh={() => reload(year)}
        />
      )}
      {section === "employee" && (
        <EmployeeSalarySection
          year={year}
          grades={grades}
          employees={employees}
          rows={rows}
          onRefresh={() => reload(year)}
        />
      )}
    </div>
  );
}

// =====================================================================
// 연도 추가 버튼 — 빈 연도 또는 특정 연도 복사.
// =====================================================================
function AddYearButton({
  existingYears,
  latestYear,
  onCreated,
}: {
  existingYears: number[];
  latestYear: number;
  onCreated: (newYear: number, nextYears: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newYear, setNewYear] = useState<string>(String(latestYear + 1));
  const [copyFrom, setCopyFrom] = useState<string>(
    existingYears.length > 0 ? String(latestYear) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${btnSecondary} ml-auto`}
      >
        + 연도 추가
      </button>
    );
  }

  return (
    <div className="ml-auto flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-2">
      <div>
        <label className="block text-[11px] font-semibold text-navy">
          새 연도
        </label>
        <input
          type="number"
          value={newYear}
          onChange={(e) => setNewYear(e.target.value)}
          className={`${inCls} w-24`}
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-navy">
          복사 원본
        </label>
        <select
          value={copyFrom}
          onChange={(e) => setCopyFrom(e.target.value)}
          className={`${inCls} w-28`}
        >
          <option value="">빈 표로 시작</option>
          {existingYears.map((y) => (
            <option key={y} value={y}>
              {y}년 복사
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const y = Number(newYear);
            const res = await createSalaryYear(
              y,
              copyFrom ? Number(copyFrom) : null
            );
            if (res.ok) {
              const next = Array.from(new Set([...existingYears, y])).sort(
                (a, b) => b - a
              );
              setOpen(false);
              onCreated(y, next);
            } else {
              setError(res.message);
            }
          });
        }}
        className={btnPrimary}
      >
        {pending ? "생성 중…" : "생성"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className={btnSecondary}
      >
        취소
      </button>
      {error && <p className="w-full text-xs text-stamp">{error}</p>}
    </div>
  );
}

// =====================================================================
// 호봉표 섹션
// =====================================================================
function GradeTableSection({
  year,
  grades,
  onRefresh,
}: {
  year: number;
  grades: SalaryGradeRow[];
  onRefresh: () => void;
}) {
  const sorted = useMemo(() => sortGradeRows(grades), [grades]);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // 편집/추가 폼 값.
  const [form, setForm] = useState({ grade: "", step: "", base: "" });

  function beginAdd() {
    setEditId("new");
    setForm({ grade: "", step: "", base: "" });
    setMsg(null);
  }
  function beginEdit(r: SalaryGradeRow) {
    setEditId(r.id);
    setForm({ grade: r.grade, step: String(r.step), base: String(r.base_salary) });
    setMsg(null);
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveGradeRow({
        id: editId === "new" ? null : editId,
        year,
        grade: form.grade,
        step: Number(form.step),
        base_salary: Number(form.base),
      });
      if (res.ok) {
        setEditId(null);
        setMsg({ ok: true, text: "저장되었습니다." });
        onRefresh();
      } else {
        setMsg({ ok: false, text: res.message });
      }
    });
  }
  function remove(r: SalaryGradeRow) {
    if (!confirm(`${r.grade} ${r.step}호봉 행을 삭제할까요?`)) return;
    setMsg(null);
    start(async () => {
      const res = await deleteGradeRow(r.id);
      if (res.ok) {
        setMsg({ ok: true, text: "삭제되었습니다." });
        onRefresh();
      } else {
        setMsg({ ok: false, text: res.message });
      }
    });
  }

  return (
    <section className={cardCls}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{year}년 호봉표</h3>
        {editId !== "new" && (
          <button type="button" onClick={beginAdd} className={btnSecondary}>
            + 호봉 추가
          </button>
        )}
      </div>

      {msg && (
        <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={thCls}>급수</th>
              <th className={thCls}>호봉</th>
              <th className={`${thCls} text-right`}>기본급(월)</th>
              <th className={`${thCls} text-right`}>관리</th>
            </tr>
          </thead>
          <tbody>
            {editId === "new" && (
              <GradeEditRow
                form={form}
                setForm={setForm}
                onSave={save}
                onCancel={() => setEditId(null)}
                pending={pending}
              />
            )}
            {sorted.map((r) =>
              editId === r.id ? (
                <GradeEditRow
                  key={r.id}
                  form={form}
                  setForm={setForm}
                  onSave={save}
                  onCancel={() => setEditId(null)}
                  pending={pending}
                />
              ) : (
                <tr key={r.id} className="border-b border-line/60">
                  <td className={tdCls}>{r.grade}</td>
                  <td className={tdCls}>{r.step}호봉</td>
                  <td className={`${tdCls} text-right font-mono`}>
                    {formatKRW(r.base_salary)}
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => beginEdit(r)}
                        className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {sorted.length === 0 && editId !== "new" && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-ink-hint">
                  {year}년 호봉표가 비어 있습니다. “+ 호봉 추가”로 입력하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GradeEditRow({
  form,
  setForm,
  onSave,
  onCancel,
  pending,
}: {
  form: { grade: string; step: string; base: string };
  setForm: (f: { grade: string; step: string; base: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <tr className="border-b border-line bg-navy-soft/30">
      <td className="px-2 py-2">
        <input
          value={form.grade}
          onChange={(e) => setForm({ ...form, grade: e.target.value })}
          placeholder="6급"
          className={`${inCls} w-24`}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          value={form.step}
          onChange={(e) => setForm({ ...form, step: e.target.value })}
          placeholder="5"
          className={`${inCls} w-20`}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          value={form.base}
          onChange={(e) => setForm({ ...form, base: e.target.value })}
          placeholder="2064690"
          className={`${inCls} text-right font-mono`}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="rounded bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-strong disabled:opacity-60"
          >
            {pending ? "…" : "저장"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-line px-2.5 py-1 text-xs text-ink-muted hover:bg-surface"
          >
            취소
          </button>
        </div>
      </td>
    </tr>
  );
}

function ConfigEditRow({
  form,
  setForm,
  onSave,
  onCancel,
  pending,
}: {
  form: { key: string; label: string; value: string };
  setForm: (f: { key: string; label: string; value: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <tr className="border-b border-line bg-navy-soft/30">
      <td className="px-2 py-2">
        <input
          value={form.key}
          onChange={(e) => setForm({ ...form, key: e.target.value })}
          placeholder="meal_allowance"
          className={`${inCls} font-mono`}
        />
      </td>
      <td className="px-2 py-2">
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="급식비(월)"
          className={inCls}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
          className={`${inCls} text-right font-mono`}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="rounded bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-strong disabled:opacity-60"
          >
            {pending ? "…" : "저장"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-line px-2.5 py-1 text-xs text-ink-muted hover:bg-surface"
          >
            취소
          </button>
        </div>
      </td>
    </tr>
  );
}

// =====================================================================
// 급여 기준값 섹션
// =====================================================================
function ConfigSection({
  year,
  configs,
  onRefresh,
}: {
  year: number;
  configs: SalaryConfigRow[];
  onRefresh: () => void;
}) {
  const sorted = useMemo(
    () => [...configs].sort((a, b) => a.config_key.localeCompare(b.config_key)),
    [configs]
  );
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ key: "", label: "", value: "" });

  function beginAdd() {
    setEditId("new");
    setForm({ key: "", label: "", value: "" });
    setMsg(null);
  }
  function beginEdit(r: SalaryConfigRow) {
    setEditId(r.id);
    setForm({
      key: r.config_key,
      label: r.label ?? "",
      value: String(r.config_value),
    });
    setMsg(null);
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveConfigRow({
        id: editId === "new" ? null : editId,
        year,
        config_key: form.key,
        config_value: Number(form.value),
        label: form.label,
      });
      if (res.ok) {
        setEditId(null);
        setMsg({ ok: true, text: "저장되었습니다." });
        onRefresh();
      } else {
        setMsg({ ok: false, text: res.message });
      }
    });
  }
  function remove(r: SalaryConfigRow) {
    if (!confirm(`'${r.label || r.config_key}' 기준을 삭제할까요?`)) return;
    setMsg(null);
    start(async () => {
      const res = await deleteConfigRow(r.id);
      if (res.ok) {
        setMsg({ ok: true, text: "삭제되었습니다." });
        onRefresh();
      } else {
        setMsg({ ok: false, text: res.message });
      }
    });
  }

  const editRow = (key: string) => (
    <ConfigEditRow
      key={key}
      form={form}
      setForm={setForm}
      onSave={save}
      onCancel={() => setEditId(null)}
      pending={pending}
    />
  );

  return (
    <section className={cardCls}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{year}년 급여 기준값</h3>
        {editId !== "new" && (
          <button type="button" onClick={beginAdd} className={btnSecondary}>
            + 기준 추가
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-hint">
        수당 단가·요율 등 급여 계산에 쓰이는 기준값입니다. 수당 종류가 늘면 새
        기준(key)을 추가하세요. (요율은 소수로 입력 — 예: 4.5% → 0.045)
      </p>

      {msg && (
        <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={thCls}>key</th>
              <th className={thCls}>이름(라벨)</th>
              <th className={`${thCls} text-right`}>값</th>
              <th className={`${thCls} text-right`}>관리</th>
            </tr>
          </thead>
          <tbody>
            {editId === "new" && editRow("new")}
            {sorted.map((r) =>
              editId === r.id ? (
                editRow(r.id)
              ) : (
                <tr key={r.id} className="border-b border-line/60">
                  <td className={`${tdCls} font-mono text-xs`}>{r.config_key}</td>
                  <td className={tdCls}>{r.label ?? "-"}</td>
                  <td className={`${tdCls} text-right font-mono`}>
                    {formatKRW(r.config_value)}
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => beginEdit(r)}
                        className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {sorted.length === 0 && editId !== "new" && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-ink-hint">
                  {year}년 기준값이 없습니다. “+ 기준 추가”로 입력하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// =====================================================================
// 직원별 급여 설정 섹션
// =====================================================================
type EditRow = {
  key: string;
  grade: string;
  step: number | "";
  start_month: number;
  end_month: number;
  extra: SalaryExtra;
};

let _rowSeq = 0;
function newEditRow(): EditRow {
  _rowSeq += 1;
  return {
    key: `r${_rowSeq}`,
    grade: "",
    step: "",
    start_month: 1,
    end_month: 12,
    extra: { ...EMPTY_SALARY_EXTRA },
  };
}

function EmployeeSalarySection({
  year,
  grades,
  employees,
  rows,
  onRefresh,
}: {
  year: number;
  grades: SalaryGradeRow[];
  employees: SalaryEmployee[];
  rows: EmployeeSalaryProfileRow[];
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<string>("");

  // 직원별 기존 행 수(요약 배지).
  const countByDriver = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.driver_id, (m.get(r.driver_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const selectedEmp = employees.find((e) => e.driver_id === selected) ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
      {/* 직원 목록 */}
      <section className={`${cardCls} h-fit`}>
        <h3 className="mb-2 text-sm font-bold text-ink">직원 ({year}년)</h3>
        <ul className="space-y-1">
          {employees.map((e) => {
            const cnt = countByDriver.get(e.driver_id) ?? 0;
            const active = e.driver_id === selected;
            return (
              <li key={e.driver_id}>
                <button
                  type="button"
                  onClick={() => setSelected(e.driver_id)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                    active ? "bg-navy-soft ring-1 ring-navy" : "hover:bg-surface"
                  } ${e.employment_status === "resigned" ? "opacity-60" : ""}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-ink">{e.name}</span>
                    {e.rank && (
                      <span className="text-xs text-ink-hint">{e.rank}</span>
                    )}
                    {e.employment_status === "resigned" && (
                      <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        퇴사
                      </span>
                    )}
                  </span>
                  {cnt > 0 && (
                    <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success">
                      {cnt}구간
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {employees.length === 0 && (
            <li className="py-3 text-center text-xs text-ink-hint">
              직원이 없습니다.
            </li>
          )}
        </ul>
      </section>

      {/* 편집 패널 */}
      {selectedEmp ? (
        <EmployeeSalaryEditor
          key={`${selectedEmp.driver_id}-${year}`}
          year={year}
          grades={grades}
          employee={selectedEmp}
          existingRows={rows.filter((r) => r.driver_id === selectedEmp.driver_id)}
          onRefresh={onRefresh}
        />
      ) : (
        <section className={cardCls}>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <span aria-hidden className="text-4xl text-ink-hint">
              💰
            </span>
            <p className="text-sm text-ink-muted">
              왼쪽에서 직원을 선택하면 급여 설정을 입력할 수 있습니다.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function EmployeeSalaryEditor({
  year,
  grades,
  employee,
  existingRows,
  onRefresh,
}: {
  year: number;
  grades: SalaryGradeRow[];
  employee: SalaryEmployee;
  existingRows: EmployeeSalaryProfileRow[];
  onRefresh: () => void;
}) {
  const [editRows, setEditRows] = useState<EditRow[]>(() =>
    existingRows.length > 0
      ? existingRows
          .sort((a, b) => a.start_month - b.start_month)
          .map((r) => ({
            key: `e${r.id}`,
            grade: r.grade,
            step: r.step,
            start_month: r.start_month,
            end_month: r.end_month,
            extra: r.extra,
          }))
      : [newEditRow()]
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // 급수 목록(현재 연도 호봉표) + 급수→호봉 목록.
  const gradeNames = useMemo(() => {
    const set = new Set(grades.map((g) => g.grade));
    return Array.from(set).sort((a, b) => gradeSortKey(a) - gradeSortKey(b));
  }, [grades]);
  const stepsOf = (grade: string) =>
    grades
      .filter((g) => g.grade === grade)
      .map((g) => g.step)
      .sort((a, b) => a - b);
  const baseOf = (grade: string, step: number | "") => {
    if (step === "") return null;
    const hit = grades.find((g) => g.grade === grade && g.step === step);
    return hit ? hit.base_salary : null;
  };

  function patch(key: string, next: Partial<EditRow>) {
    setEditRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...next } : r))
    );
  }
  function patchExtra(key: string, next: Partial<SalaryExtra>) {
    setEditRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, extra: { ...r.extra, ...next } } : r
      )
    );
  }

  // 겹침 미리보기(클라이언트).
  const overlap = useMemo(() => {
    const check = validateMonthRanges(
      editRows.map((r) => ({
        start_month: r.start_month,
        end_month: r.end_month,
      }))
    );
    return check.ok ? null : check.message;
  }, [editRows]);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveEmployeeSalaryRows({
        driverId: employee.driver_id,
        year,
        rows: editRows.map((r) => ({
          grade: r.grade,
          step: Number(r.step),
          start_month: r.start_month,
          end_month: r.end_month,
          extra: r.extra,
        })),
      });
      if (res.ok) {
        setMsg({ ok: true, text: "저장되었습니다." });
        onRefresh();
      } else {
        setMsg({ ok: false, text: res.message });
      }
    });
  }

  return (
    <section className={cardCls}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">
          {employee.name}
          {employee.rank && (
            <span className="ml-1.5 text-xs font-normal text-ink-muted">
              {employee.rank}
            </span>
          )}
          <span className="ml-2 text-xs font-normal text-ink-hint">
            {year}년 급여 설정
          </span>
        </h3>
        <button
          type="button"
          onClick={() => setEditRows((prev) => [...prev, newEditRow()])}
          className={btnSecondary}
        >
          + 구간 추가
        </button>
      </div>

      {employee.employment_status === "resigned" && (
        <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          퇴사 직원입니다{employee.resignation_date
            ? ` (퇴사일 ${employee.resignation_date})`
            : ""}
          . 퇴사일까지의 급여 산정을 위해 설정을 유지·입력할 수 있습니다.
        </p>
      )}

      <p className="mb-3 text-xs text-ink-hint">
        연중 호봉이 바뀌면 “구간 추가”로 월 구간을 나눠 입력하세요. (예: 1~5월
        6급5호봉 / 6~12월 6급6호봉)
      </p>

      <div className="space-y-4">
        {editRows.map((r, idx) => {
          const base = baseOf(r.grade, r.step);
          return (
            <div
              key={r.key}
              className="rounded-lg border border-line bg-surface/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-navy">
                  구간 {idx + 1}
                </span>
                {editRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditRows((prev) => prev.filter((x) => x.key !== r.key))
                    }
                    className="text-xs text-stamp hover:underline"
                  >
                    구간 삭제
                  </button>
                )}
              </div>

              {/* 급수·호봉·월 구간 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    급수
                  </label>
                  <select
                    value={r.grade}
                    onChange={(e) =>
                      patch(r.key, { grade: e.target.value, step: "" })
                    }
                    className={inCls}
                  >
                    <option value="">선택</option>
                    {gradeNames.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    호봉
                  </label>
                  <select
                    value={r.step === "" ? "" : String(r.step)}
                    onChange={(e) =>
                      patch(r.key, {
                        step: e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                    disabled={!r.grade}
                    className={inCls}
                  >
                    <option value="">선택</option>
                    {stepsOf(r.grade).map((s) => (
                      <option key={s} value={s}>
                        {s}호봉
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    시작월
                  </label>
                  <select
                    value={r.start_month}
                    onChange={(e) =>
                      patch(r.key, { start_month: Number(e.target.value) })
                    }
                    className={inCls}
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m}월
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    종료월
                  </label>
                  <select
                    value={r.end_month}
                    onChange={(e) =>
                      patch(r.key, { end_month: Number(e.target.value) })
                    }
                    className={inCls}
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m}월
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="mt-1.5 text-[11px] text-ink-muted">
                기본급(참고):{" "}
                <span className="font-mono font-semibold text-ink-body">
                  {base == null ? "-" : `${formatKRW(base)}원`}
                </span>
              </p>

              {/* 개인 항목(extra) */}
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line/70 pt-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    가족수당(월)
                  </label>
                  <input
                    type="number"
                    value={r.extra.family_allowance || ""}
                    onChange={(e) =>
                      patchExtra(r.key, {
                        family_allowance: Number(e.target.value || 0),
                      })
                    }
                    placeholder="0"
                    className={`${inCls} text-right font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    자격수당 등급
                  </label>
                  <select
                    value={r.extra.cert_level}
                    onChange={(e) =>
                      patchExtra(r.key, {
                        cert_level: e.target.value as SalaryExtra["cert_level"],
                      })
                    }
                    className={inCls}
                  >
                    {CERT_LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    갑근세(월)
                  </label>
                  <input
                    type="number"
                    value={r.extra.income_tax || ""}
                    onChange={(e) =>
                      patchExtra(r.key, {
                        income_tax: Number(e.target.value || 0),
                      })
                    }
                    placeholder="0"
                    className={`${inCls} text-right font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-navy">
                    상조회비(개인 예외)
                  </label>
                  <input
                    type="number"
                    value={r.extra.sangjo ?? ""}
                    onChange={(e) =>
                      patchExtra(r.key, {
                        sangjo:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="기본값 사용"
                    className={`${inCls} text-right font-mono`}
                  />
                </div>
                <label className="flex items-center gap-1.5 pt-5 text-xs text-ink-body">
                  <input
                    type="checkbox"
                    checked={r.extra.mgmt_target}
                    onChange={(e) =>
                      patchExtra(r.key, { mgmt_target: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
                  />
                  관리업무수당 대상
                </label>
                <label className="flex items-center gap-1.5 pt-5 text-xs text-ink-body">
                  <input
                    type="checkbox"
                    checked={r.extra.overtime_target}
                    onChange={(e) =>
                      patchExtra(r.key, { overtime_target: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
                  />
                  시간외수당 대상
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {overlap && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          ⚠ {overlap}
        </p>
      )}
      {msg && (
        <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !!overlap}
          className={btnPrimary}
        >
          {pending ? "저장 중…" : "급여 설정 저장"}
        </button>
        {existingRows.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (!confirm("이 직원의 해당 연도 급여 설정을 모두 비울까요?"))
                return;
              setMsg(null);
              start(async () => {
                const res = await saveEmployeeSalaryRows({
                  driverId: employee.driver_id,
                  year,
                  rows: [],
                });
                if (res.ok) {
                  setEditRows([newEditRow()]);
                  setMsg({ ok: true, text: "설정을 비웠습니다." });
                  onRefresh();
                } else {
                  setMsg({ ok: false, text: res.message });
                }
              });
            }}
            className={btnDanger}
          >
            설정 초기화
          </button>
        )}
      </div>
    </section>
  );
}
