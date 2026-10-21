"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { previewBulk, saveBulk } from "@/app/(app)/bangka/members/actions";
import { BK_BULK_COLUMNS, bkClassLabel, formatBkPhone, type BkBulkPlan } from "@/lib/bangka";
import {
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  inputCls,
  linkCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 학생 일괄 등록 — 탭 구분 붙여넣기 → 미리보기 → 저장.
//   열: 이름, 학교, 학년, 반, 보호자명, 관계, 보호자 전화 (lib/bangka BK_BULK_COLUMNS)
//   · 보호자는 전화번호(숫자만)로 찾아 있으면 연결만, 없으면 '초대중'으로 만듭니다.
//     가입 링크는 여기서 만들지 않습니다 — 보호자 상세에서 발급.
//   · 같은 이름·학교·학년·반 재원생이 이미 있으면 새로 만들지 않고 보호자만 연결.
//   · 저장은 미리보기 결과가 아니라 붙여넣은 원문을 서버가 다시 해석해 저장합니다.
//     그래서 미리보기 뒤에 글을 고치면 다시 [미리보기]를 눌러야 저장할 수 있습니다.
// =====================================================================

const SAMPLE = [
  BK_BULK_COLUMNS.join("\t"),
  "홍길동\t동래중\t중1\t이음반\t김영희\t어머니\t010-1234-5678",
  "홍길순\t동래중\t중2\t이음반\t김영희\t어머니\t010-1234-5678",
].join("\n");

export default function BulkImport() {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<BkBulkPlan | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null); // 미리보기한 원문
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const stale = plan !== null && planFor !== text;
  const canSave = !!plan && !stale && plan.errors.length === 0 && plan.students.length > 0;

  function preview() {
    setErr(null);
    setDone(null);
    const snapshot = text;
    start(async () => {
      const res = await previewBulk(snapshot);
      if (!res.ok) {
        setErr(res.message);
        setPlan(null);
        return;
      }
      setPlan(res.plan);
      setPlanFor(snapshot);
    });
  }

  function save() {
    if (!plan) return;
    const s = plan.summary;
    if (
      !confirm(
        `저장할까요?\n새 학생 ${s.newStudents}명 · 새 보호자 ${s.newGuardians}명 · 새 연결 ${s.newLinks}건` +
          (s.existingStudents ? `\n(이미 있는 학생 ${s.existingStudents}명은 보호자만 연결)` : "")
      )
    )
      return;
    setErr(null);
    start(async () => {
      const res = await saveBulk(text);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setDone(`저장했습니다 — 새 학생 ${res.students}명 · 새 보호자 ${res.guardians}명 · 연결 ${res.links}건.`);
      setPlan(null);
      setPlanFor(null);
      setText("");
    });
  }

  return (
    <div className="space-y-4">
      <section className={panelToneCls("blue")}>
        <h3 className={sectionTitleCls("blue")}>붙여넣기</h3>
        <p className="mt-1 text-xs text-ink-muted">
          엑셀에서 아래 순서의 열을 골라 복사(Ctrl+C)한 뒤 붙여 넣으세요. 머리글 줄은 있어도 됩니다.
        </p>
        <p className="mt-1 flex flex-wrap gap-1">
          {BK_BULK_COLUMNS.map((c, i) => (
            <span key={c} className={badgeNavy}>
              {i + 1}. {c}
            </span>
          ))}
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-hint">
          <li>반은 이음반/지음반. 보호자 세 칸(보호자명·관계·전화)은 비워도 됩니다(학생만 등록).</li>
          <li>형제는 줄을 나눠 같은 보호자를 적고, 보호자가 둘이면 같은 학생을 두 줄로 적습니다.</li>
          <li>보호자는 전화번호로 찾습니다 — 이미 있으면 연결만 하고, 없으면 &apos;초대중&apos;으로 만듭니다.</li>
        </ul>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={SAMPLE}
          className={`mt-3 ${inputCls} h-auto font-mono text-xs`}
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setText(SAMPLE)} disabled={pending} className={btnSecondary}>
            예시 넣기
          </button>
          <button type="button" onClick={preview} disabled={pending || !text.trim()} className={btnPrimary}>
            {pending && !plan ? "확인 중…" : "미리보기"}
          </button>
        </div>
      </section>

      {err && <p className={noticeError}>{err}</p>}
      {done && (
        <p className={noticeSuccess}>
          {done}{" "}
          <Link href="/bangka/members/guardians?status=invited" className={linkCls}>
            초대중 보호자 보기 →
          </Link>
        </p>
      )}

      {plan && (
        <section className={panelToneCls("green")}>
          <h3 className={sectionTitleCls("green")}>미리보기</h3>
          {stale && <p className={`mt-2 ${noticeWarning}`}>붙여넣은 내용이 바뀌었습니다. [미리보기]를 다시 눌러 주세요.</p>}

          <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className={badgeSuccess}>새 학생 {plan.summary.newStudents}</span>
            <span className={badgeNeutral}>이미 있는 학생 {plan.summary.existingStudents}</span>
            <span className={badgeSuccess}>새 보호자 {plan.summary.newGuardians}</span>
            <span className={badgeNeutral}>이미 있는 보호자 {plan.summary.existingGuardians}</span>
            <span className={badgeSuccess}>새 연결 {plan.summary.newLinks}</span>
          </p>

          {plan.errors.length > 0 && (
            <div className={`mt-3 ${noticeError}`}>
              <p className="font-semibold">오류 {plan.errors.length}건 — 고친 뒤 다시 미리보기 하세요.</p>
              <ul className="mt-1 list-disc pl-5">
                {plan.errors.map((e, i) => (
                  <li key={i}>
                    {e.line}번째 줄: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.students.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className={tableHeadCls}>
                    <th className="px-2 py-2 text-left">줄</th>
                    <th className="px-2 py-2 text-left">학생</th>
                    <th className="px-2 py-2 text-left">반</th>
                    <th className="px-2 py-2 text-left">보호자</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.students.map((s) => (
                    <tr key={s.lines.join(",")} className={tableRowCls}>
                      <td className="px-2 py-2 text-xs text-ink-muted">{s.lines.join(", ")}</td>
                      <td className="px-2 py-2">
                        <span className="font-semibold text-ink">{s.name}</span>
                        <span className="ml-1 text-xs text-ink-muted">
                          {[s.school, s.grade].filter(Boolean).join(" ")}
                        </span>
                        <span className={`ml-1 ${s.existingId ? badgeNeutral : badgeSuccess}`}>
                          {s.existingId ? "이미 있음" : "새로"}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className={badgeNavy}>{bkClassLabel(s.class_code)}</span>
                      </td>
                      <td className="px-2 py-2 text-ink-body">
                        {s.guardians.length === 0 ? (
                          <span className="text-xs text-ink-hint">없음(학생만)</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {s.guardians.map((g) => (
                              <li key={g.phone} className="text-xs">
                                {g.name}
                                {g.relation && ` (${g.relation})`} · {formatBkPhone(g.phone)}{" "}
                                {g.existingId ? (
                                  <span className={badgeNeutral}>{g.alreadyLinked ? "이미 연결됨" : "있는 보호자 — 연결만"}</span>
                                ) : (
                                  <span className={badgeSuccess}>새로(초대중)</span>
                                )}
                                {g.existingName && g.existingName !== g.name && (
                                  <span className={`ml-1 ${badgeWarning}`}>
                                    등록된 이름은 &quot;{g.existingName}&quot; — 기존 이름 유지
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <button type="button" onClick={save} disabled={pending || !canSave} className={btnPrimary}>
              {pending ? "저장 중…" : "저장"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
