"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSealRequest } from "@/app/(app)/seal-register/actions";
import {
  SEAL_DOC_TYPES,
  SEAL_MAX_ITEMS,
  SEAL_MAX_RECIPIENTS,
  SEAL_TITLE_MAX,
  certDateLabel,
  defaultCertDate,
  fillBody,
  placeholderKey,
  recipientItems,
  spacedTitle,
  templateFor,
  unfilledPlaceholders,
  type SealDocType,
  type SealItemDef,
} from "@/lib/sealRegister";
import { btnPrimary, btnSecondary, inputCls, labelCls, linkCls, noticeError, noticeWarning, panelToneCls, sectionTitleCls } from "@/lib/ui";
import { tap } from "@/app/(app)/seal-register/parts";

// 직인 사용 신청 작성·고치기.
//   종류 고르기 → 제목·○항목·본문 틀이 채워짐(모두 고칠 수 있음) → 대상자 여러 줄(엑셀 붙여넣기)
//   → 대상자별 미리보기 → 임시저장(작성 중) / 결재 올리기.
//   항목은 화면 안에서 고유 key 로 다루고(이름을 바꿔도 값이 따라감), 저장할 때 이름 기준으로 바꿉니다.

type Def = SealItemDef & { key: string };
type Row = { key: string; name: string; values: Record<string, string>; body: string | null };

export type SealFormInitial = {
  id: string;
  docType: SealDocType;
  title: string;
  certDate: string;
  purpose: string;
  itemTemplate: SealItemDef[];
  bodyTemplate: string;
  recipients: { name: string; values: Record<string, string>; body: string }[];
  lastRejectReason: string | null;
};

let seq = 0;
const nk = () => `k${++seq}`;
const field = `${inputCls} h-11 text-base sm:h-auto sm:text-sm`;
const area = `${inputCls} text-base sm:text-sm`;

function toDefs(items: SealItemDef[]): Def[] {
  return items.map((d) => ({ ...d, key: nk() }));
}
const emptyRow = (): Row => ({ key: nk(), name: "", values: {}, body: null });

// 고치기: 저장된 값(항목 이름 기준)을 화면 key 기준으로. 본문이 틀대로면 '틀 따라감'(null)으로 둡니다.
function initialState(initial?: SealFormInitial, initialType?: SealDocType | null): { defs: Def[]; rows: Row[]; title: string; body: string } {
  if (!initial) {
    const tpl = initialType ? templateFor(initialType) : null;
    return { defs: toDefs(tpl?.items ?? []), rows: [emptyRow()], title: tpl?.title ?? "", body: tpl?.body ?? "" };
  }
  const defs = toDefs(initial.itemTemplate);
  const rows = initial.recipients.map((r) => {
    const values: Record<string, string> = {};
    defs.forEach((d) => {
      if (d.scope === "person" && !d.isName) values[d.key] = r.values[d.label] ?? "";
    });
    const filled = fillBody(initial.bodyTemplate, initial.itemTemplate, r.name, r.values, initial.certDate);
    return { key: nk(), name: r.name, values, body: r.body === filled ? null : r.body };
  });
  return { defs, rows: rows.length ? rows : [emptyRow()], title: initial.title, body: initial.bodyTemplate };
}

export default function SealRequestForm({
  today,
  initial,
  initialType,
}: {
  today: string;
  initial?: SealFormInitial;
  initialType?: SealDocType | null; // 새 신청 주소의 ?type= — 종류를 미리 골라 둠
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [init] = useState(() => initialState(initial, initialType));
  const [docType, setDocType] = useState<SealDocType | null>(initial?.docType ?? initialType ?? null);
  const [title, setTitle] = useState(init.title);
  const [defs, setDefs] = useState<Def[]>(init.defs);
  const [bodyTemplate, setBodyTemplate] = useState(init.body);
  const [certDate, setCertDate] = useState(initial?.certDate ?? "");
  const [certTouched, setCertTouched] = useState(!!initial);
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [rows, setRows] = useState<Row[]>(init.rows);

  const [paste, setPaste] = useState("");
  const [previewIdx, setPreviewIdx] = useState(0);

  const personDefs = defs.filter((d) => d.scope === "person" && !d.isName);
  const nameDef = defs.find((d) => d.isName);
  const effCertDate = certTouched ? certDate : docType ? defaultCertDate(docType, defs, today) : today;

  // 저장 형태(항목 이름 기준) — 미리보기와 저장이 같은 계산을 씀
  const plainDefs: SealItemDef[] = useMemo(
    () => defs.map((d) => ({ label: d.label, scope: d.scope, isName: d.isName, date: d.date, value: d.value })),
    [defs],
  );
  const labelValues = (r: Row) => Object.fromEntries(personDefs.map((d) => [d.label, r.values[d.key] ?? ""]));
  const bodyOf = (r: Row) => r.body ?? fillBody(bodyTemplate, plainDefs, r.name.trim(), labelValues(r), effCertDate);

  const chooseType = (t: SealDocType) => {
    if (t === docType) return;
    const touched = defs.length > 0 && (title || bodyTemplate || rows.some((r) => r.name.trim()));
    if (touched && !window.confirm("종류를 바꾸면 제목·○ 항목·본문 틀이 새로 채워집니다(대상자 이름은 남음). 바꿀까요?")) return;
    const tpl = templateFor(t);
    setDocType(t);
    setTitle(tpl.title);
    setDefs(toDefs(tpl.items));
    setBodyTemplate(tpl.body);
    setRows((rs) => rs.map((r) => ({ ...r, values: {}, body: null })));
    if (!initial) setCertTouched(false);
  };

  const updateDef = (key: string, patch: Partial<SealItemDef>) => setDefs((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const removeDef = (key: string) => setDefs((ds) => ds.filter((d) => d.key !== key));
  const addDef = () => setDefs((ds) => (ds.length >= SEAL_MAX_ITEMS ? ds : [...ds, { key: nk(), label: "", scope: "common", value: "" }]));

  const updateRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setRowValue = (rk: string, dk: string, v: string) =>
    setRows((rs) => rs.map((r) => (r.key === rk ? { ...r, values: { ...r.values, [dk]: v } } : r)));

  // 엑셀에서 복사한 칸(탭 구분) — 순서: 이름, 사람마다 항목들
  const addPasted = () => {
    const lines = paste
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l) => l.trim());
    if (!lines.length) return;
    const fresh: Row[] = lines.map((l) => {
      const cells = l.split("\t").map((c) => c.trim());
      const values: Record<string, string> = {};
      personDefs.forEach((d, i) => (values[d.key] = cells[i + 1] ?? ""));
      return { key: nk(), name: cells[0] ?? "", values, body: null };
    });
    setRows((rs) => {
      const kept = rs.filter((r) => r.name.trim() || Object.values(r.values).some((v) => v.trim()));
      return [...kept, ...fresh].slice(0, SEAL_MAX_RECIPIENTS);
    });
    setPaste("");
  };

  const filledRows = rows.filter((r) => r.name.trim());
  const leftovers = filledRows.flatMap((r) => unfilledPlaceholders(bodyOf(r)).map((p) => `${r.name}: {${p}}`));
  const available = [...defs.map((d) => placeholderKey(d.label)).filter(Boolean), "성명", "날짜"];

  const save = (submit: boolean) => {
    setError(null);
    if (!docType) return setError("증서 종류를 고르세요.");
    start(async () => {
      const res = await saveSealRequest(
        {
          id: initial?.id ?? null,
          docType,
          title,
          certDate: effCertDate,
          purpose,
          itemTemplate: plainDefs,
          bodyTemplate,
          recipients: rows
            .filter((r) => r.name.trim() || Object.values(r.values).some((v) => v.trim()))
            .map((r) => ({ name: r.name, values: labelValues(r), body: bodyOf(r) })),
        },
        submit,
      );
      if (!res.ok) return setError(res.message);
      router.push(`/seal-register/${res.id}`);
      router.refresh();
    });
  };

  const prevRow = filledRows[Math.min(previewIdx, Math.max(0, filledRows.length - 1))];

  return (
    <div className="space-y-5">
      {initial?.lastRejectReason && (
        <p className={noticeWarning}>
          반려 사유: <span className="break-all">{initial.lastRejectReason}</span> — 고친 뒤 [결재 올리기]를 누르세요.
        </p>
      )}

      {/* 1. 종류 */}
      <section className={`${panelToneCls("navy")} space-y-2`}>
        <h3 className={sectionTitleCls("navy")}>1. 증서 종류</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {SEAL_DOC_TYPES.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => chooseType(d.key)}
              aria-pressed={docType === d.key}
              className={`${docType === d.key ? btnPrimary : btnSecondary} ${tap} w-full break-keep px-2`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>

      {docType && (
        <>
          {/* 2. 제목·날짜·항목 */}
          <section className={`${panelToneCls("blue")} space-y-4`}>
            <h3 className={sectionTitleCls("blue")}>2. 제목·○ 항목·본문</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={labelCls}>제목(PDF 에서 글자 사이를 띄움)</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={SEAL_TITLE_MAX} className={field} placeholder="예: 수상확인증" />
              </label>
              <label className="block">
                <span className={labelCls}>증서 날짜{docType === "award_confirm" && !certTouched ? "(참가일시를 따라감)" : ""}</span>
                <input
                  type="date"
                  value={effCertDate}
                  onChange={(e) => {
                    setCertTouched(true);
                    setCertDate(e.target.value);
                  }}
                  className={field}
                />
              </label>
              <label className="block">
                <span className={labelCls}>사용 목적·메모(대장에만, PDF 에는 안 나옴)</span>
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} className={field} />
              </label>
            </div>

            <div>
              <p className={labelCls}>○ 항목(위에서부터 차례로 PDF 에 찍힘)</p>
              <ul className="mt-1 space-y-2">
                {defs.map((d) => (
                  <li key={d.key} className="rounded-lg border border-line bg-card p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={d.label}
                        onChange={(e) => updateDef(d.key, { label: e.target.value })}
                        maxLength={20}
                        aria-label="항목 이름"
                        placeholder="항목 이름"
                        className={`${field} mt-0 w-36 shrink-0`}
                      />
                      {d.isName ? (
                        <span className="text-xs text-ink-muted">대상자 이름(사람마다)</span>
                      ) : (
                        <>
                          <select
                            value={d.scope}
                            onChange={(e) => updateDef(d.key, { scope: e.target.value === "common" ? "common" : "person" })}
                            aria-label="입력 방식"
                            className={`${field} mt-0 w-auto`}
                          >
                            <option value="common">모두 같음</option>
                            <option value="person">사람마다</option>
                          </select>
                          <button type="button" onClick={() => removeDef(d.key)} className={`${btnSecondary} ${tap} px-3`}>
                            빼기
                          </button>
                        </>
                      )}
                    </div>
                    {d.scope === "common" && !d.isName && (
                      <input
                        type={d.date ? "date" : "text"}
                        value={d.value ?? ""}
                        onChange={(e) => updateDef(d.key, { value: e.target.value })}
                        maxLength={200}
                        aria-label={`${d.label} 값`}
                        placeholder={`${d.label} — 모든 대상자 같음`}
                        className={field}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {defs.length < SEAL_MAX_ITEMS && (
                <button type="button" onClick={addDef} className={`${btnSecondary} ${tap} mt-2`}>
                  + 항목 더하기
                </button>
              )}
            </div>

            <label className="block">
              <span className={labelCls}>본문 틀 — 대상자마다 자리표시가 채워집니다</span>
              <textarea value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} rows={4} maxLength={1000} className={area} />
            </label>
            <p className="break-keep text-xs text-ink-muted">
              쓸 수 있는 자리표시: {available.map((k) => `{${k}}`).join(" ")} · 수상확인증의 &lsquo;주최·주관&rsquo; 문장은 행사마다 고쳐 쓰세요.
            </p>
          </section>

          {/* 3. 대상자 */}
          <section className={`${panelToneCls("green")} space-y-3`}>
            <h3 className={sectionTitleCls("green")}>
              3. 대상자 {filledRows.length}명 <span className="text-xs font-normal text-ink-muted">(최대 {SEAL_MAX_RECIPIENTS}명, 승인 때 이 순서로 번호)</span>
            </h3>
            <ol className="space-y-2">
              {rows.map((r, i) => (
                <li key={r.key} className="rounded-lg border border-line bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink-muted">{i + 1}번</span>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className={`${btnSecondary} ${tap} px-3`}>
                        줄 빼기
                      </button>
                    )}
                  </div>
                  <div className="mt-1 grid gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className={labelCls}>{nameDef?.label || "이름"}</span>
                      <input value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} maxLength={100} className={field} />
                    </label>
                    {personDefs.map((d) => (
                      <label key={d.key} className="block">
                        <span className={labelCls}>{d.label || "(이름 없는 항목)"}</span>
                        <input value={r.values[d.key] ?? ""} onChange={(e) => setRowValue(r.key, d.key, e.target.value)} maxLength={200} className={field} />
                      </label>
                    ))}
                  </div>
                  {r.body === null ? (
                    <button type="button" onClick={() => updateRow(r.key, { body: bodyOf(r) })} className={`${linkCls} mt-2 inline-flex min-h-11 items-center text-sm sm:min-h-0`}>
                      이 사람 문장만 따로 고치기
                    </button>
                  ) : (
                    <div className="mt-2">
                      <textarea value={r.body} onChange={(e) => updateRow(r.key, { body: e.target.value })} rows={3} maxLength={1000} aria-label={`${i + 1}번 본문`} className={area} />
                      <button type="button" onClick={() => updateRow(r.key, { body: null })} className={`${linkCls} inline-flex min-h-11 items-center text-sm sm:min-h-0`}>
                        본문 틀로 되돌리기
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {rows.length < SEAL_MAX_RECIPIENTS && (
              <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])} className={`${btnSecondary} ${tap}`}>
                + 한 줄 더하기
              </button>
            )}

            <details className="rounded-lg border border-line bg-card p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink sm:min-h-0">엑셀에서 여러 명 한 번에 붙여넣기</summary>
              <p className="mt-2 break-keep text-xs text-ink-muted">
                엑셀에서 칸을 이 순서로 골라 복사(Ctrl+C)해 붙여넣으세요: {[nameDef?.label || "이름", ...personDefs.map((d) => d.label)].join(" | ")}
              </p>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} aria-label="엑셀 붙여넣기" className={area} />
              <button type="button" onClick={addPasted} disabled={!paste.trim()} className={`${btnSecondary} ${tap} mt-2`}>
                붙여넣은 줄 더하기
              </button>
            </details>
          </section>

          {/* 4. 미리보기 */}
          <section className={`${panelToneCls("yellow")} space-y-3`}>
            <h3 className={sectionTitleCls("yellow")}>4. 미리보기(결재 전 — 직인 없음)</h3>
            {leftovers.length > 0 && (
              <p className={noticeWarning}>
                채워지지 않은 자리표시가 있습니다: <span className="break-all">{leftovers.slice(0, 5).join(", ")}</span>
                {leftovers.length > 5 ? ` 외 ${leftovers.length - 5}개` : ""}
              </p>
            )}
            {prevRow ? (
              <>
                {filledRows.length > 1 && (
                  <label className="block sm:max-w-xs">
                    <span className={labelCls}>미리볼 대상자</span>
                    <select value={Math.min(previewIdx, filledRows.length - 1)} onChange={(e) => setPreviewIdx(Number(e.target.value))} className={field}>
                      {filledRows.map((r, i) => (
                        <option key={r.key} value={i}>
                          {i + 1}. {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <CertPreview
                  title={title}
                  items={recipientItems(plainDefs, prevRow.name.trim(), labelValues(prevRow))}
                  body={bodyOf(prevRow)}
                  date={certDateLabel(effCertDate)}
                />
              </>
            ) : (
              <p className="text-sm text-ink-muted">대상자 이름을 넣으면 여기에 보입니다.</p>
            )}
          </section>

          {error && <p className={`${noticeError} break-all text-sm`}>{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => save(false)} disabled={pending} className={`${btnSecondary} ${tap}`}>
              {pending ? "저장하는 중…" : "임시저장"}
            </button>
            <button type="button" onClick={() => save(true)} disabled={pending} className={`${btnPrimary} ${tap}`}>
              {pending ? "올리는 중…" : "결재 올리기"}
            </button>
            <Link href={initial ? `/seal-register/${initial.id}` : "/seal-register"} className={`${btnSecondary} ${tap}`}>
              취소
            </Link>
          </div>
          <p className="break-keep text-xs text-ink-muted">결재 올리면 관장·부장에게 알림이 갑니다. 결재 대기 중에도 [회수]하면 다시 고칠 수 있습니다.</p>
        </>
      )}
    </div>
  );
}

// 화면용 증서 모양(PDF 와 같은 순서) — 번호는 승인 때 붙음
export function CertPreview({
  issueLabel,
  title,
  items,
  body,
  date,
}: {
  issueLabel?: string;
  title: string;
  items: { label: string; value: string }[];
  body: string;
  date: string;
}) {
  return (
    <div className="mx-auto w-full max-w-xl rounded border border-ink/40 bg-card px-4 py-5 text-ink sm:px-8 sm:py-7">
      <p className="text-xs font-bold sm:text-sm">발급번호 : {issueLabel ?? `제${date.slice(0, 4)}-○○호(승인 시 부여)`}</p>
      <p className="mt-4 text-center text-xl font-bold sm:text-2xl">{spacedTitle(title || "제목")}</p>
      <dl className="mt-5 space-y-1.5 text-sm">
        {items.map((it, i) => (
          <div key={i} className="flex gap-1">
            <dt className="shrink-0">○ {it.label} :</dt>
            <dd className="min-w-0 break-all">{it.value || "-"}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 whitespace-pre-line break-keep text-center text-base leading-relaxed [overflow-wrap:anywhere]">{body}</p>
      <p className="mt-5 text-center text-sm font-bold">{date}</p>
      <p className="mt-4 text-center text-lg font-bold">동래구청소년센터장</p>
    </div>
  );
}
