"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  restoreStudent,
  saveStudent,
  setStudentLeft,
} from "@/app/(app)/bangka/members/actions";
import {
  BK_CLASS_CODES,
  bkClassLabel,
  type BkStudentInput,
  type BkStudentRow,
} from "@/lib/bangka";
import {
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  panelToneCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 학생 목록 — 반(이음반/지음반)·재원/퇴소 필터, 추가·수정·퇴소.
//   삭제는 없습니다(관장 지시) — 퇴소(status='left', left_on)로만 내립니다.
//   필터는 주소(?class=&status=)에 담아 새로고침·공유해도 유지됩니다.
// =====================================================================

const EMPTY: BkStudentInput = {
  name: "",
  school: "",
  grade: "",
  school_class: "",
  class_code: "ieum",
  enrolled_on: "",
  memo: "",
};

export default function StudentsManager({
  students,
  classFilter,
  statusFilter,
  todayYmd,
}: {
  students: BkStudentRow[];
  classFilter: string;
  statusFilter: string;
  todayYmd: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<BkStudentInput | null>(null);
  const [leaving, setLeaving] = useState<BkStudentRow | null>(null);

  function setFilter(key: "class" | "status", value: string) {
    const sp = new URLSearchParams();
    const c = key === "class" ? value : classFilter;
    const s = key === "status" ? value : statusFilter;
    if (c !== "all") sp.set("class", c);
    if (s !== "active") sp.set("status", s);
    const qs = sp.toString();
    router.push(`/bangka/members${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} flex flex-wrap items-end gap-3`}>
        <label className="min-w-[8rem]">
          <span className={labelCls}>반</span>
          <select
            value={classFilter}
            onChange={(e) => setFilter("class", e.target.value)}
            className={inputCls}
          >
            <option value="all">전체</option>
            {BK_CLASS_CODES.map((c) => (
              <option key={c} value={c}>
                {bkClassLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[8rem]">
          <span className={labelCls}>상태</span>
          <select
            value={statusFilter}
            onChange={(e) => setFilter("status", e.target.value)}
            className={inputCls}
          >
            <option value="active">재원</option>
            <option value="left">퇴소</option>
            <option value="all">전체</option>
          </select>
        </label>
        <p className="text-xs text-ink-muted">{students.length}명</p>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY })}
          className={`ml-auto ${btnPrimary}`}
        >
          학생 추가
        </button>
      </div>

      {editing && (
        <StudentForm
          initial={editing}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {leaving && (
        <LeaveDialog
          student={leaving}
          todayYmd={todayYmd}
          onClose={(changed) => {
            setLeaving(null);
            if (changed) router.refresh();
          }}
        />
      )}

      <div className={`${panelToneCls("green")} overflow-x-auto`}>
        {students.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">해당하는 학생이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="px-2 py-2 text-left">이름</th>
                <th className="px-2 py-2 text-left">학교</th>
                <th className="px-2 py-2 text-left">학년</th>
                <th className="px-2 py-2 text-left">반</th>
                <th className="px-2 py-2 text-left">연결 보호자</th>
                <th className="px-2 py-2 text-left">상태</th>
                <th className="px-2 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <StudentRow
                  key={s.id}
                  s={s}
                  onEdit={() =>
                    setEditing({
                      id: s.id,
                      name: s.name,
                      school: s.school ?? "",
                      grade: s.grade ?? "",
                      school_class: s.school_class ?? "",
                      class_code: s.class_code,
                      enrolled_on: s.enrolled_on ?? "",
                      memo: s.memo ?? "",
                    })
                  }
                  onLeave={() => setLeaving(s)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StudentRow({
  s,
  onEdit,
  onLeave,
}: {
  s: BkStudentRow;
  onEdit: () => void;
  onLeave: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function restore() {
    if (!confirm(`${s.name} 학생을 재원으로 되돌릴까요?`)) return;
    start(async () => {
      const res = await restoreStudent(s.id);
      if (!res.ok) setErr(res.message);
      else router.refresh();
    });
  }

  return (
    <tr className={tableRowCls}>
      <td className="px-2 py-2 font-semibold text-ink">
        {s.name}
        {s.memo && <p className="text-[11px] font-normal text-ink-hint">{s.memo}</p>}
      </td>
      <td className="px-2 py-2 text-ink-body">{s.school ?? "-"}</td>
      <td className="px-2 py-2 text-ink-body">
        {s.grade ?? "-"}
        {s.school_class && <span className="ml-1 text-ink-muted">{s.school_class}반</span>}
      </td>
      <td className="px-2 py-2">
        <span className={badgeNavy}>{bkClassLabel(s.class_code)}</span>
      </td>
      <td className="px-2 py-2 text-ink-body">
        <span className="font-semibold">{s.guardians.length}명</span>
        {s.guardians.length > 0 && (
          <span className="ml-1 text-xs">
            (
            {s.guardians.map((g, i) => (
              <span key={g.id}>
                {i > 0 && ", "}
                <Link href={`/bangka/members/guardians/${g.id}`} className={linkCls}>
                  {g.name}
                </Link>
              </span>
            ))}
            )
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {s.status === "active" ? (
          <span className={badgeSuccess}>재원</span>
        ) : (
          <span className={badgeNeutral}>퇴소 {s.left_on ?? ""}</span>
        )}
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={onEdit} className={`${btnSecondary} h-8 px-3 text-xs`}>
          수정
        </button>
        {s.status === "active" ? (
          <button type="button" onClick={onLeave} className={`ml-1 ${btnSecondary} h-8 px-3 text-xs`}>
            퇴소
          </button>
        ) : (
          <button
            type="button"
            onClick={restore}
            disabled={pending}
            className={`ml-1 ${btnSecondary} h-8 px-3 text-xs`}
          >
            재원으로
          </button>
        )}
        {err && <p className={`mt-1 ${noticeError}`}>{err}</p>}
      </td>
    </tr>
  );
}

function StudentForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: BkStudentInput;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<BkStudentInput>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof BkStudentInput) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await saveStudent(f);
      if (!res.ok) setErr(res.message);
      else onDone();
    });
  }

  return (
    <form onSubmit={submit} className={`${panelToneCls("yellow")} space-y-3`}>
      <h3 className="text-sm font-bold text-ink">{f.id ? "학생 정보 수정" : "학생 추가"}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className={labelCls}>이름 *</span>
          <input value={f.name} onChange={set("name")} className={inputCls} required />
        </label>
        <label>
          <span className={labelCls}>학교</span>
          <input value={f.school} onChange={set("school")} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>학년</span>
          <input value={f.grade} onChange={set("grade")} placeholder="예: 중1" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>학교 반</span>
          <input
            value={f.school_class}
            onChange={set("school_class")}
            inputMode="numeric"
            placeholder="예: 3 (공결확인서 '반' 칸)"
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>반 *</span>
          <select value={f.class_code} onChange={set("class_code")} className={inputCls}>
            {BK_CLASS_CODES.map((c) => (
              <option key={c} value={c}>
                {bkClassLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>입소일</span>
          <input type="date" value={f.enrolled_on} onChange={set("enrolled_on")} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>메모</span>
          <input value={f.memo} onChange={set("memo")} className={inputCls} />
        </label>
      </div>
      {err && <p className={noticeError}>{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className={btnSecondary}>
          취소
        </button>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

function LeaveDialog({
  student,
  todayYmd,
  onClose,
}: {
  student: BkStudentRow;
  todayYmd: string;
  onClose: (changed: boolean) => void;
}) {
  const [leftOn, setLeftOn] = useState(todayYmd);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      const res = await setStudentLeft({ id: student.id, leftOn });
      if (!res.ok) setErr(res.message);
      else onClose(true);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${student.name} 퇴소 처리`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className={`${panelToneCls("yellow")} w-full max-w-sm shadow-lg`}>
        <h3 className="text-base font-bold text-ink">퇴소 처리 — {student.name}</h3>
        <p className="mt-1 text-xs text-ink-muted">
          보호자 앱(동래방카)에서 이 학생이 바로 빠집니다. 기록은 남고, 잘못 눌렀으면
          [재원으로]로 되돌릴 수 있습니다.
        </p>
        <label className="mt-3 block">
          <span className={labelCls}>퇴소일</span>
          <input type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} className={inputCls} />
        </label>
        {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} disabled={pending} className={btnSecondary}>
            취소
          </button>
          <button type="button" onClick={submit} disabled={pending || !leftOn} className={btnPrimary}>
            {pending ? "처리 중…" : "퇴소 처리"}
          </button>
        </div>
      </div>
    </div>
  );
}
