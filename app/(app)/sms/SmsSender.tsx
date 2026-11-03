"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bkClassLabel } from "@/lib/bangka";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  LMS_MAX_BYTES,
  SMS_HEADER,
  SMS_MAX_BYTES,
  SMS_MAX_RECIPIENTS,
  bkGuardianIdsFor,
  eucKrBytes,
  isNightKst,
  isValidSmsPhone,
  normalizeSmsPhone,
  parsePhoneList,
  smsCostWon,
  smsMsgType,
  withSmsHeader,
  type BkGuardianMode,
  type SmsBkStudent,
  type SmsLogRow,
  type SmsProgram,
  type SmsResultSummary,
  type SmsSendRequest,
  type SmsSendResponse,
  type SmsSendersInfo,
} from "@/lib/smsText";
import {
  badgeDanger,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  panelToneCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 문자 발송 화면 — 받는 사람(방과후 보호자 / 직접 입력) · 발신번호 · 본문 · 발송 · 이력.
//   방과후 보호자 번호는 화면에 오지 않습니다(보호자 id 만). 서버가 발송 때 번호로 바꿉니다.
// =====================================================================

const won = new Intl.NumberFormat("ko-KR");
const tabCls = (on: boolean) =>
  `rounded-lg px-4 py-2 text-sm font-semibold ${
    on ? "bg-navy text-white" : "border border-line bg-card text-ink-body hover:bg-surface"
  }`;

type ResultState = { loading: boolean; summary?: SmsResultSummary };

export default function SmsSender({
  students,
  logs,
  loadError,
}: {
  students: SmsBkStudent[];
  logs: SmsLogRow[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [program, setProgram] = useState<SmsProgram>("bk");

  // --- 발신번호 ---
  const [senders, setSenders] = useState<SmsSendersInfo | null>(null);
  const [sendersError, setSendersError] = useState<string | null>(null);
  const [sender, setSender] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/sms/senders", { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as Partial<SmsSendersInfo> & {
          ok?: boolean;
          error?: string;
        };
        if (!alive) return;
        if (!r.ok || data.ok === false) {
          setSendersError(data.error ?? `발신번호를 불러오지 못했습니다(${r.status}).`);
          return;
        }
        const info: SmsSendersInfo = {
          enabled: data.enabled === true,
          default: data.default ?? null,
          allowed: data.allowed ?? [],
        };
        setSenders(info);
        setSender(
          info.allowed.find((a) => a.number === info.default)?.number ??
            info.allowed[0]?.number ??
            "",
        );
      })
      .catch(() => alive && setSendersError("발신번호를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);
  const senderDisplay =
    senders?.allowed.find((a) => a.number === sender)?.display ?? sender;

  // --- 받는 사람: 방과후 ---
  const [gradeFilter, setGradeFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [guardianMode, setGuardianMode] = useState<BkGuardianMode>("primary");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const grades = useMemo(
    () => [...new Set(students.map((s) => s.grade).filter(Boolean))].sort(),
    [students],
  );
  const classes = useMemo(
    () => [...new Set(students.map((s) => s.class_code))].sort(),
    [students],
  );
  const visible = students.filter(
    (s) =>
      (gradeFilter === "all" || s.grade === gradeFilter) &&
      (classFilter === "all" || s.class_code === classFilter),
  );
  const reachable = (s: SmsBkStudent) => bkGuardianIdsFor(s, guardianMode).length > 0;
  const visibleReachable = visible.filter(reachable);
  const allVisibleOn =
    visibleReachable.length > 0 && visibleReachable.every((s) => selected.has(s.id));
  const pickedStudents = students.filter((s) => selected.has(s.id) && reachable(s));
  const bkCount = new Set(
    pickedStudents.flatMap((s) => bkGuardianIdsFor(s, guardianMode)),
  ).size;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of visibleReachable) {
        if (allVisibleOn) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  }

  // --- 받는 사람: 직접 입력 ---
  const [manualText, setManualText] = useState("");
  const manual = useMemo(() => parsePhoneList(manualText), [manualText]);

  const recipientCount = program === "bk" ? bkCount : manual.valid.length;

  // --- 본문 ---
  const [body, setBody] = useState("");
  const [headerOn, setHeaderOn] = useState(true);
  const finalText = withSmsHeader(body, headerOn);
  const bytes = eucKrBytes(finalText);
  const msgType = smsMsgType(finalText);
  const tooLong = bytes > LMS_MAX_BYTES;

  // --- 발송 ---
  const [testNumber, setTestNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const enabled = senders?.enabled === true;
  const baseReady = enabled && !!sender && !!finalText && !tooLong && !busy;
  const realReady =
    baseReady && recipientCount > 0 && recipientCount <= SMS_MAX_RECIPIENTS;
  const testReady = baseReady && isValidSmsPhone(normalizeSmsPhone(testNumber));

  async function send(test: boolean) {
    setBusy(true);
    setNotice(null);
    const req: SmsSendRequest = {
      program,
      text: finalText,
      sender,
      test,
      ...(test ? { testNumber } : {}),
      ...(program === "bk"
        ? { studentIds: pickedStudents.map((s) => s.id), guardianMode }
        : { numbers: manualText }),
    };
    try {
      const r = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = (await r.json().catch(() => ({
        ok: false,
        error: `발송 실패(${r.status})`,
      }))) as SmsSendResponse;
      if (!data.ok) {
        setNotice({ kind: "error", text: data.error });
      } else {
        setNotice({
          kind: "ok",
          text: `${test ? "테스트 " : ""}발송 요청 완료 — 성공 ${data.sent}건 · 실패 ${data.failed}건 (${data.msg_type ?? msgType}). 최종 결과는 아래 [결과 조회]로 확인하세요.`,
        });
      }
    } catch {
      setNotice({ kind: "error", text: "발송 요청이 서버에 닿지 않았습니다." });
    } finally {
      setBusy(false);
      setConfirming(false);
      router.refresh();
    }
  }

  // --- 이력 결과 조회 ---
  const [results, setResults] = useState<Record<string, ResultState>>({});
  async function checkResult(row: SmsLogRow) {
    if (!row.provider_msg_id) return;
    setResults((p) => ({ ...p, [row.id]: { loading: true } }));
    try {
      const r = await fetch(
        `/api/sms/result/${encodeURIComponent(row.provider_msg_id)}`,
        { cache: "no-store" },
      );
      const data = (await r.json().catch(() => ({
        ok: false,
        error: `조회 실패(${r.status})`,
      }))) as SmsResultSummary;
      setResults((p) => ({
        ...p,
        [row.id]: {
          loading: false,
          summary: {
            ok: data.ok === true,
            sent: data.sent ?? 0,
            failed: data.failed ?? 0,
            pending: data.pending ?? 0,
            error: data.error,
          },
        },
      }));
    } catch {
      setResults((p) => ({
        ...p,
        [row.id]: {
          loading: false,
          summary: { ok: false, sent: 0, failed: 0, pending: 0, error: "조회 실패" },
        },
      }));
    }
  }

  return (
    <div className="space-y-5">
      {loadError && <p className={noticeError}>{loadError}</p>}

      {/* 받는 사람 */}
      <section className={panelToneCls("blue")}>
        <h3 className="mb-3 text-sm font-bold text-ink">받는 사람</h3>
        <div className="mb-4 flex gap-2">
          <button type="button" className={tabCls(program === "bk")} onClick={() => setProgram("bk")}>
            방과후아카데미 보호자
          </button>
          <button
            type="button"
            className={tabCls(program === "manual")}
            onClick={() => setProgram("manual")}
          >
            직접 입력
          </button>
        </div>

        {program === "bk" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[7rem]">
                <span className={labelCls}>반</span>
                <select
                  className={inputCls}
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                >
                  <option value="all">전체</option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {bkClassLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[7rem]">
                <span className={labelCls}>학년</span>
                <select
                  className={inputCls}
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value)}
                >
                  <option value="all">전체</option>
                  {grades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="flex items-center gap-3 text-sm text-ink-body">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={guardianMode === "primary"}
                    onChange={() => setGuardianMode("primary")}
                  />
                  대표 보호자만
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={guardianMode === "all"}
                    onChange={() => setGuardianMode("all")}
                  />
                  모든 보호자
                </label>
              </fieldset>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={tableHeadCls}>
                    <th className="w-10 px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        aria-label="보이는 학생 전체 선택"
                        checked={allVisibleOn}
                        disabled={visibleReachable.length === 0}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th className="px-2 py-2 text-left">이름</th>
                    <th className="px-2 py-2 text-left">반</th>
                    <th className="px-2 py-2 text-left">학년</th>
                    <th className="px-2 py-2 text-left">받는 보호자</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-4 text-center text-ink-muted">
                        재원 중인 학생이 없습니다.
                      </td>
                    </tr>
                  )}
                  {visible.map((s) => {
                    const n = bkGuardianIdsFor(s, guardianMode).length;
                    const ok = n > 0;
                    return (
                      <tr key={s.id} className={`${tableRowCls} ${ok ? "" : "text-ink-hint"}`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`${s.name} 선택`}
                            checked={ok && selected.has(s.id)}
                            disabled={!ok}
                            onChange={() => toggle(s.id)}
                          />
                        </td>
                        <td className="px-2 py-1.5">{s.name}</td>
                        <td className="px-2 py-1.5">{bkClassLabel(s.class_code)}</td>
                        <td className="px-2 py-1.5">{s.grade || "-"}</td>
                        <td className="px-2 py-1.5">
                          {ok ? `${n}명` : "번호 없음"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-muted">
              학생 {pickedStudents.length}명 선택 · 같은 보호자는 한 번만 보냅니다. 번호가 없거나
              사용중이 아닌 보호자는 빠집니다.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block">
              <span className={labelCls}>휴대폰 번호 (줄바꿈·쉼표로 여러 개)</span>
              <textarea
                className={`${inputCls} h-32 font-mono`}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={"010-1234-5678\n01098765432"}
              />
            </label>
            {manual.invalidCount > 0 && (
              <p className={noticeWarning}>
                잘못된 번호 {manual.invalidCount}개 — 010으로 시작하는 10~11자리만 보냅니다.
              </p>
            )}
          </div>
        )}

        <p className="mt-3 text-sm font-semibold text-ink">
          {recipientCount}명에게 발송
          {recipientCount > SMS_MAX_RECIPIENTS && (
            <span className="ml-2 text-stamp">
              한 번에 {SMS_MAX_RECIPIENTS}명까지만 보낼 수 있습니다.
            </span>
          )}
        </p>
      </section>

      {/* 본문 */}
      <section className={panelToneCls("navy")}>
        <h3 className="mb-3 text-sm font-bold text-ink">내용</h3>
        {sendersError && <p className={`${noticeError} mb-3`}>{sendersError}</p>}
        {senders && !senders.enabled && (
          <p className={`${noticeWarning} mb-3`}>
            문자 발송이 꺼져 있습니다(중계 서버 비활성). 담당자에게 문의하세요.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>발신번호</span>
            <select
              className={inputCls}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              disabled={!senders || senders.allowed.length === 0}
            >
              {!senders && <option value="">불러오는 중…</option>}
              {senders?.allowed.map((a) => (
                <option key={a.number} value={a.number}>
                  {a.display}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-ink-body">
            <input
              type="checkbox"
              checked={headerOn}
              onChange={(e) => setHeaderOn(e.target.checked)}
            />
            머리말 “{SMS_HEADER}” 자동 붙이기
          </label>
        </div>
        <label className="mt-3 block">
          <span className={labelCls}>본문</span>
          <textarea
            className={`${inputCls} h-40`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className={tooLong ? "font-semibold text-stamp" : ""}>
            {won.format(bytes)} / {bytes > SMS_MAX_BYTES ? won.format(LMS_MAX_BYTES) : SMS_MAX_BYTES} 바이트
          </span>
          <span className={msgType === "LMS" ? badgeWarning : badgeNavy}>{msgType}</span>
          {msgType === "LMS" && <span>90바이트를 넘어 장문(LMS)으로 보냅니다.</span>}
          {tooLong && <span className="text-stamp">2,000바이트를 넘으면 보낼 수 없습니다.</span>}
        </div>
        {headerOn && finalText && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-2 text-xs text-ink-body">
            {finalText}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-rule pt-4">
          <label className="min-w-[12rem]">
            <span className={labelCls}>테스트 받을 내 번호</span>
            <input
              className={inputCls}
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              placeholder="010-0000-0000"
              inputMode="tel"
            />
          </label>
          <button
            type="button"
            className={btnSecondary}
            disabled={!testReady}
            onClick={() => send(true)}
          >
            테스트 발송
          </button>
          <span className="pb-2 text-xs text-ink-muted">포인트를 쓰지 않는 시험 발송입니다.</span>
          <button
            type="button"
            className={`${btnPrimary} ml-auto`}
            disabled={!realReady}
            onClick={() => setConfirming(true)}
          >
            실제 발송
          </button>
        </div>
        {notice && (
          <p className={`mt-3 ${notice.kind === "ok" ? noticeSuccess : noticeError}`}>
            {notice.text}
          </p>
        )}
      </section>

      {/* 발송 이력 */}
      <section className={panelToneCls("navy")}>
        <h3 className="mb-1 text-sm font-bold text-ink">발송 이력 (최근 50건)</h3>
        <p className="mb-3 text-xs text-ink-muted">
          전 직원이 같은 이력을 봅니다. 본문 전체는 보낸 사람·관장·부장만, 다른 직원에게는
          앞 20자만 보입니다. [결과 조회]는 그 시점의 성공·실패 수이고, 최종 확정은 발송
          24시간 뒤입니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="px-2 py-2 text-left">일시</th>
                <th className="px-2 py-2 text-left">보낸 사람</th>
                <th className="px-2 py-2 text-left">대상</th>
                <th className="px-2 py-2 text-left">본문</th>
                <th className="px-2 py-2 text-right">인원</th>
                <th className="px-2 py-2 text-left">유형</th>
                <th className="px-2 py-2 text-left">결과</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-ink-muted">
                    아직 보낸 문자가 없습니다.
                  </td>
                </tr>
              )}
              {logs.map((row) => {
                const rs = results[row.id];
                const s = rs?.summary;
                return (
                  <tr key={row.id} className={tableRowCls}>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {fmtKstDateTime(row.created_at)}
                    </td>
                    <td className="px-2 py-1.5">{row.sender_name ?? "-"}</td>
                    <td className="px-2 py-1.5">{row.audience_desc ?? "-"}</td>
                    <td className="max-w-[20rem] px-2 py-1.5">
                      <span
                        className="whitespace-pre-wrap break-words text-xs text-ink-body"
                        title={
                          row.text_truncated
                            ? "본문 전체는 보낸 사람·관장·부장만 볼 수 있습니다."
                            : undefined
                        }
                      >
                        {row.text_body || "-"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{row.recipient_count}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {row.msg_type ?? "-"}{" "}
                      {row.is_test && <span className={badgeNeutral}>시험</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {!row.ok ? (
                        <span className={badgeDanger} title={row.error ?? ""}>
                          실패{row.error ? ` · ${row.error}` : ""}
                        </span>
                      ) : s ? (
                        s.ok ? (
                          <span className={badgeSuccess}>
                            성공 {s.sent} · 실패 {s.failed}
                            {s.pending > 0 ? ` · 대기 ${s.pending}` : ""}
                          </span>
                        ) : (
                          <span className={badgeDanger}>{s.error ?? "조회 실패"}</span>
                        )
                      ) : (
                        <span className={badgeSuccess}>
                          성공 {row.sent_count ?? 0} · 실패 {row.failed_count ?? 0}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {row.provider_msg_id && (
                        <button
                          type="button"
                          className={btnSecondary}
                          disabled={rs?.loading}
                          onClick={() => checkResult(row)}
                        >
                          {rs?.loading ? "조회 중…" : "결과 조회"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 실제 발송 확인 */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
            <h3 className="text-lg font-bold text-ink">문자를 보낼까요?</h3>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-ink-muted">받는 사람</dt>
              <dd className="font-semibold">{recipientCount}명</dd>
              <dt className="text-ink-muted">발신번호</dt>
              <dd>{senderDisplay}</dd>
              <dt className="text-ink-muted">유형</dt>
              <dd>
                {msgType} ({won.format(bytes)}바이트)
              </dd>
              <dt className="text-ink-muted">예상 비용</dt>
              <dd>
                약 {won.format(smsCostWon(msgType, recipientCount))}원
                <span className="ml-1 text-xs text-ink-muted">
                  ({msgType === "LMS" ? "LMS 건당 약 27원" : "SMS 건당 약 9원"})
                </span>
              </dd>
            </dl>
            {isNightKst() && (
              <p className={`${noticeWarning} mt-3`}>
                야간 발송입니다(밤 9시~아침 8시). 보내도 되는지 한 번 더 확인하세요.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                취소
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => send(false)}
              >
                {busy ? "보내는 중…" : `${recipientCount}명에게 보내기`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
