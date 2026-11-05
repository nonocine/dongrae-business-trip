"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LMS_MAX_BYTES,
  SMS_AD_PREFIX,
  SMS_HEADER,
  SMS_MAX_BYTES,
  SMS_MAX_RECIPIENTS,
  SMS_OPTOUT_NUMBER,
  composeSmsText,
  eucKrBytes,
  isNightKst,
  isValidSmsPhone,
  looksLikeAdvertising,
  normalizeSmsPhone,
  smsCostWon,
  smsMsgType,
  type SmsBundle,
  type SmsChannelMeta,
  type SmsLogRow,
  type SmsPreviewResult,
  type SmsSelection,
  type SmsSendRequest,
  type SmsSendResponse,
  type SmsSendersInfo,
  type SmsSourceMeta,
} from "@/lib/sms/text";
import {
  badgeNavy,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";
import StepBox from "./StepBox";
import TemplateBar from "./TemplateBar";
import SmsHistory from "./SmsHistory";
import { GroupDialog, GroupManager, type BusinessProgramOption } from "./AddressBook";
import { PICKERS } from "./pickers";
import { chipCls, modalBackdrop, modalPanel, newUid, pickerBox, sourceCard } from "./ui";

// =====================================================================
// 문자 발송 화면 — 1 받는 사람 고르기 / 2 담긴 명단 / 3 내용 / 4 발송 + 발송 이력.
//   출처 카드는 서버가 준 메타(lib/sms/sources 등록표)대로 그립니다 — 출처가 늘어도
//   이 파일은 고치지 않습니다. 선택기는 pickerType 별 공용 컴포넌트(./pickers).
//   발송 수단도 등록표(lib/sms/channels) — 1개(문자)뿐이면 "보내는 방법"을 숨깁니다.
//   담긴 명단은 {출처, 선택값}만 들고 있고, 인원·이름은 /api/sms/preview 가 계산합니다.
//   전화번호는 화면에 오지 않습니다(직접 입력한 번호만 예외).
// =====================================================================

const won = new Intl.NumberFormat("ko-KR");

export default function SmsSender({
  sources,
  channels,
  logs,
  programs,
  loadError,
  initialBody = "",
}: {
  sources: SmsSourceMeta[];
  channels: SmsChannelMeta[];
  logs: SmsLogRow[];
  programs: BusinessProgramOption[];
  loadError: string | null;
  initialBody?: string; // ?body= 로 미리 채운 내용
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // --- 1. 받는 사람 고르기 ---
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = sources.find((s) => s.key === activeKey) ?? null;
  const Picker = active ? PICKERS[active.pickerType] : null;

  // --- 2. 담긴 명단 ---
  const [bundles, setBundles] = useState<SmsBundle[]>([]);
  // 미리보기 결과 — for: 어느 명단으로 계산했는지. 지금 명단과 다르면 "다시 세는 중".
  const [previewState, setPreviewState] = useState<{
    for: SmsBundle[] | null;
    result: SmsPreviewResult | null;
    error: string | null;
  }>({ for: null, result: null, error: null });
  const preview = bundles.length > 0 ? previewState.result : null;
  const previewError = bundles.length > 0 ? previewState.error : null;
  const previewing = bundles.length > 0 && previewState.for !== bundles;
  const [expanded, setExpanded] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [managingGroups, setManagingGroups] = useState(false);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (bundles.length === 0) return;
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/sms/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundles }),
        });
        const j = (await r.json().catch(() => ({}))) as Omit<SmsPreviewResult, "ok"> & {
          ok?: boolean;
          error?: string;
        };
        if (seq !== reqSeq.current) return;
        if (!r.ok || j.ok !== true)
          setPreviewState((p) => ({ for: bundles, result: p.result, error: j.error ?? `명단을 계산하지 못했습니다(${r.status}).` }));
        else setPreviewState({ for: bundles, result: { ...j, ok: true }, error: null });
      } catch {
        if (seq === reqSeq.current)
          setPreviewState((p) => ({ for: bundles, result: p.result, error: "명단을 계산하지 못했습니다." }));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [bundles]);

  function addBundle(source: string, selection: SmsSelection) {
    setBundles((p) => [...p, { uid: newUid(), source, selection, excluded: [] }]);
  }
  function removeBundle(uid: string) {
    setBundles((p) => p.filter((b) => b.uid !== uid));
  }
  function excludePerson(bundleUid: string, key: string) {
    setBundles((p) => p.map((b) => (b.uid === bundleUid ? { ...b, excluded: [...b.excluded, key] } : b)));
  }
  const total = preview?.total ?? 0;
  const peopleByBundle = useMemo(() => {
    const m = new Map<string, SmsPreviewResult["people"]>();
    for (const p of preview?.people ?? []) m.set(p.bundle, [...(m.get(p.bundle) ?? []), p]);
    return m;
  }, [preview]);

  // --- 3. 내용 ---
  const [body, setBody] = useState(initialBody);
  const [headerOn, setHeaderOn] = useState(true);
  const [advertising, setAdvertising] = useState(false);
  const finalText = composeSmsText(body, { header: headerOn, advertising });
  const bytes = eucKrBytes(finalText);
  const msgType = smsMsgType(finalText);
  const tooLong = bytes > LMS_MAX_BYTES;
  const adHint = !advertising && looksLikeAdvertising(body);

  // --- 4. 발송 ---
  const [channelKey, setChannelKey] = useState(channels[0]?.key ?? "sms");
  const channel = channels.find((c) => c.key === channelKey) ?? channels[0];
  const adNotAllowed = advertising && channel && !channel.allowsAd;

  const [senders, setSenders] = useState<SmsSendersInfo | null>(null);
  const [sendersError, setSendersError] = useState<string | null>(null);
  const [sender, setSender] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/sms/senders", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as Partial<SmsSendersInfo> & { ok?: boolean; error?: string };
        if (!alive) return;
        if (!r.ok || d.ok === false) return setSendersError(d.error ?? `발신번호를 불러오지 못했습니다(${r.status}).`);
        const info: SmsSendersInfo = { enabled: d.enabled === true, default: d.default ?? null, allowed: d.allowed ?? [] };
        setSenders(info);
        setSender(info.allowed.find((a) => a.number === info.default)?.number ?? info.allowed[0]?.number ?? "");
      })
      .catch(() => alive && setSendersError("발신번호를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);
  const senderDisplay = senders?.allowed.find((a) => a.number === sender)?.display ?? sender;

  const [testNumber, setTestNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const night = isNightKst();
  const enabled = senders?.enabled === true;
  const baseReady = enabled && !!sender && !!finalText && !tooLong && !busy && !adNotAllowed;
  const adNightBlocked = advertising && night;
  const realReady =
    baseReady && !previewing && !previewError && total > 0 && total <= SMS_MAX_RECIPIENTS && !adNightBlocked;
  const testDigits = normalizeSmsPhone(testNumber);
  const testReady = baseReady && testDigits.startsWith("010") && isValidSmsPhone(testDigits);

  async function send(test: boolean) {
    setBusy(true);
    setNotice(null);
    const req: SmsSendRequest = {
      channel: channel?.key,
      bundles: test ? [] : bundles,
      text: finalText,
      advertising,
      sender,
      test,
      ...(test ? { testNumber } : {}),
    };
    try {
      const r = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const d = (await r.json().catch(() => ({ ok: false, error: `발송 실패(${r.status})` }))) as SmsSendResponse;
      if (!d.ok) setNotice({ kind: "error", text: d.error });
      else
        setNotice({
          kind: d.partial ? "error" : "ok",
          text:
            `${test ? "테스트 " : ""}발송 요청 완료 — 성공 ${won.format(d.sent)}건 · 실패 ${won.format(d.failed)}건 (${d.msg_type ?? msgType}).` +
            (d.partial ? ` 일부 실패: ${d.partial}` : " 최종 결과는 아래 [결과 조회]로 확인하세요."),
        });
    } catch {
      setNotice({ kind: "error", text: "발송 요청이 서버에 닿지 않았습니다." });
    } finally {
      setBusy(false);
      setConfirming(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      {loadError && <p className={noticeError}>{loadError}</p>}

      {/* 1. 받는 사람 고르기 */}
      <StepBox
        step={1}
        title="받는 사람 고르기"
        right={
          <button type="button" className={btnSecondary} onClick={() => setManagingGroups(true)}>
            주소록 관리
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {sources.map((s) => (
            <button
              key={s.key}
              type="button"
              className={sourceCard(s.key === activeKey)}
              aria-pressed={s.key === activeKey}
              onClick={() => setActiveKey(s.key === activeKey ? null : s.key)}
            >
              <span className="text-xl" aria-hidden>
                {s.icon}
              </span>
              <span className="text-sm font-bold text-ink">{s.label}</span>
              <span className="text-xs text-ink-muted">{s.description}</span>
            </button>
          ))}
        </div>
        {active && Picker && (
          <div className={`${pickerBox} mt-4`}>
            <p className="mb-3 text-sm font-bold text-brand-blue-strong">
              {active.icon} {active.label}
            </p>
            {/* key 로 출처가 바뀌면 선택기 상태를 새로 시작합니다. */}
            <Picker key={active.key} meta={active} onAdd={(sel) => addBundle(active.key, sel)} />
          </div>
        )}
      </StepBox>

      {/* 2. 담긴 명단 */}
      <StepBox
        step={2}
        title="담긴 명단"
        tone="soft"
        right={
          bundles.length > 0 && (
            <>
              <button type="button" className={btnSecondary} onClick={() => setExpanded((v) => !v)}>
                {expanded ? "명단 접기" : "명단 펼쳐보기"}
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={!preview || total === 0}
                onClick={() => setSavingGroup(true)}
              >
                이 묶음을 주소록에 저장
              </button>
            </>
          )
        }
      >
        {bundles.length === 0 ? (
          <p className="text-sm text-ink-muted">위에서 받는 사람을 골라 담으세요. 여러 출처를 함께 담을 수 있습니다.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-3xl font-bold text-ink">
                {previewing && !preview ? "…" : won.format(total)}
                <span className="ml-1 text-base font-semibold text-ink-body">명</span>
              </p>
              {preview && (
                <p className="pb-1 text-xs text-ink-muted">
                  중복 {won.format(preview.duplicates)}건 자동 제외 · 번호 없음 {won.format(preview.noPhone)}건 제외
                  {preview.restricted > 0 && (
                    <span title="주소록에 든 사람 중 내가 쓸 권한이 없는 명단(예: 방과후 보호자)의 사람은 빠집니다.">
                      {" "}· 권한 밖 {won.format(preview.restricted)}명 제외
                    </span>
                  )}
                  {previewing && " · 다시 세는 중…"}
                </p>
              )}
            </div>
            {previewError && <p className={noticeError}>{previewError}</p>}
            {total > SMS_MAX_RECIPIENTS && (
              <p className={noticeError}>한 번에 {won.format(SMS_MAX_RECIPIENTS)}명까지 보낼 수 있습니다.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {bundles.map((b) => {
                const chip = preview?.bundles.find((c) => c.uid === b.uid);
                const meta = sources.find((s) => s.key === b.source);
                return (
                  <span key={b.uid} className={chipCls(chip?.color ?? meta?.color ?? "blue")}>
                    {chip ? `${chip.label} · ${won.format(chip.count)}명` : `${meta?.label ?? b.source} · 계산 중`}
                    <button
                      type="button"
                      aria-label="이 묶음 빼기"
                      className="ml-0.5 rounded-full px-1 leading-none hover:bg-black/10"
                      onClick={() => removeBundle(b.uid)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            {expanded && preview && (
              <div className="max-h-96 overflow-y-auto rounded-lg border border-rule bg-card">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-rule text-left text-xs text-ink-muted">
                      <th className="px-2 py-2">이름</th>
                      <th className="px-2 py-2">출처</th>
                      <th className="px-2 py-2">상태</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {bundles.flatMap((b) =>
                      (peopleByBundle.get(b.uid) ?? []).map((p) => (
                        <tr key={`${b.uid}-${p.key}`} className="border-b border-rule/70 last:border-0">
                          <td className={`px-2 py-1.5 ${p.hasPhone && !p.duplicate ? "" : "text-ink-hint"}`}>{p.name}</td>
                          <td className="px-2 py-1.5 text-xs">{p.sourceLabel}</td>
                          <td className="px-2 py-1.5 text-xs">
                            {!p.hasPhone ? "번호 없음(제외)" : p.duplicate ? "중복(제외)" : "보냄"}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              className="text-xs text-stamp hover:underline"
                              onClick={() => excludePerson(b.uid, p.key)}
                            >
                              빼기
                            </button>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </StepBox>

      {/* 3. 내용 */}
      <StepBox step={3} title="내용">
        <TemplateBar body={body} onUse={setBody} />
        <textarea
          className={`${inputCls} h-40`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="보낼 내용을 쓰세요."
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-body">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={headerOn} onChange={(e) => setHeaderOn(e.target.checked)} />
            머리말 “{SMS_HEADER}” 붙이기
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={advertising} onChange={(e) => setAdvertising(e.target.checked)} />
            광고성 문자
          </label>
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
            <span className={tooLong ? "font-semibold text-stamp" : ""}>
              {won.format(bytes)} / {bytes > SMS_MAX_BYTES ? won.format(LMS_MAX_BYTES) : SMS_MAX_BYTES} 바이트
            </span>
            <span className={msgType === "LMS" ? badgeWarning : badgeNavy}>{msgType}</span>
          </span>
        </div>
        {msgType === "LMS" && !tooLong && (
          <p className="mt-1 text-xs text-ink-muted">90바이트를 넘어 장문(LMS)으로 보냅니다.</p>
        )}
        {tooLong && <p className={`${noticeError} mt-2`}>2,000바이트를 넘으면 보낼 수 없습니다.</p>}
        {advertising && (
          <p className={`${noticeWarning} mt-2`}>
            광고성 문자: 맨 앞 “{SMS_AD_PREFIX}”와 맨 끝 “수신거부 {SMS_OPTOUT_NUMBER}”를 자동으로 붙입니다(바이트에 포함).
            밤 9시~아침 8시에는 실제 발송이 막힙니다(테스트 발송은 가능).
          </p>
        )}
        {adHint && <p className={`${noticeWarning} mt-2`}>광고성 문자일 수 있어요. 광고성 문자 체크를 확인하세요.</p>}
        {finalText && (headerOn || advertising) && (
          <div className="mt-3">
            <p className="text-xs font-medium text-ink-muted">실제로 나가는 문자</p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface p-2 text-sm text-ink-body">{finalText}</p>
          </div>
        )}
      </StepBox>

      {/* 4. 발송 */}
      <StepBox step={4} title="발송">
        {/* 보내는 방법 — 등록된 수단이 2개 이상일 때만 보입니다(지금은 문자 하나라 숨김). */}
        {channels.length > 1 && (
          <fieldset className="mb-4">
            <legend className={labelCls}>보내는 방법</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {channels.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={c.key === channel?.key}
                  className={`${sourceCard(c.key === channel?.key)} w-auto flex-row items-center px-4 py-2`}
                  onClick={() => setChannelKey(c.key)}
                >
                  <span aria-hidden>{c.icon}</span>
                  <span className="text-sm font-semibold text-ink">{c.label}</span>
                </button>
              ))}
            </div>
            {adNotAllowed && (
              <p className={`${noticeError} mt-2`}>“{channel?.label}”(으)로는 광고성 내용을 보낼 수 없습니다.</p>
            )}
          </fieldset>
        )}
        {sendersError && <p className={`${noticeError} mb-3`}>{sendersError}</p>}
        {senders && !senders.enabled && (
          <p className={`${noticeWarning} mb-3`}>문자 발송이 꺼져 있습니다(중계 서버 비활성). 담당자에게 문의하세요.</p>
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
          <div className="flex items-end gap-2">
            <label className="block flex-1">
              <span className={labelCls}>테스트 받을 내 번호</span>
              <input
                className={inputCls}
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                placeholder="010-0000-0000"
                inputMode="tel"
              />
            </label>
            <button type="button" className={btnSecondary} disabled={!testReady} onClick={() => send(true)}>
              테스트 발송
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-muted">테스트 발송은 내 번호 1개로, 포인트를 쓰지 않습니다.</p>
        {adNightBlocked && <p className={`${noticeError} mt-3`}>광고성 문자는 밤 9시~아침 8시에 보낼 수 없습니다.</p>}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className={`${btnPrimary} px-6 py-3 text-base`}
            disabled={!realReady}
            onClick={() => setConfirming(true)}
          >
            {won.format(total)}명에게 발송
          </button>
        </div>
        {notice && <p className={`mt-3 ${notice.kind === "ok" ? noticeSuccess : noticeError}`}>{notice.text}</p>}
      </StepBox>

      <SmsHistory logs={logs} />

      {/* 실제 발송 확인 */}
      {confirming && preview && (
        <div className={modalBackdrop} role="dialog" aria-modal="true">
          <div className={`${modalPanel} max-w-md`}>
            <h3 className="text-lg font-bold text-ink">문자를 보낼까요?</h3>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-ink-muted">받는 사람</dt>
              <dd className="font-semibold">{won.format(total)}명</dd>
              <dt className="text-ink-muted">출처</dt>
              <dd>{preview.summary}</dd>
              {channels.length > 1 && (
                <>
                  <dt className="text-ink-muted">보내는 방법</dt>
                  <dd>{channel?.label}</dd>
                </>
              )}
              <dt className="text-ink-muted">발신번호</dt>
              <dd>{senderDisplay}</dd>
              <dt className="text-ink-muted">유형</dt>
              <dd>
                {msgType} ({won.format(bytes)}바이트){advertising && " · 광고성"}
              </dd>
              <dt className="text-ink-muted">예상 비용</dt>
              <dd>
                약 {won.format(smsCostWon(msgType, total))}원
                <span className="ml-1 text-xs text-ink-muted">
                  ({msgType === "LMS" ? "LMS 건당 약 27원" : "SMS 건당 약 9원"})
                </span>
              </dd>
            </dl>
            {total > 1000 && <p className="mt-3 text-xs text-ink-muted">1,000명이 넘어 500명씩 나눠 차례로 보냅니다.</p>}
            {night && (
              <p className={`${noticeWarning} mt-3`}>야간 발송입니다(밤 9시~아침 8시). 보내도 되는지 한 번 더 확인하세요.</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => setConfirming(false)}>
                취소
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => send(false)}>
                {busy ? "보내는 중…" : `${won.format(total)}명에게 보내기`}
              </button>
            </div>
          </div>
        </div>
      )}

      {savingGroup && preview && (
        <GroupDialog
          mode={{ kind: "fromCart", bundles, count: total }}
          programs={programs}
          onClose={() => setSavingGroup(false)}
          onSaved={(m) => {
            setSavingGroup(false);
            setNotice({ kind: "ok", text: m });
          }}
        />
      )}
      {managingGroups && (
        <GroupManager
          programs={programs}
          onClose={() => setManagingGroups(false)}
          onChanged={(m) => setNotice({ kind: "ok", text: m })}
        />
      )}
    </div>
  );
}
