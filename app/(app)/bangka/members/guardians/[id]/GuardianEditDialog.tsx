"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resendGuardianInviteSms,
  sendGuardianPhoneNotice,
  updateGuardianInfo,
} from "@/app/(app)/bangka/members/actions";
import {
  formatBkPhone,
  isValidBkPhone,
  normalizeBkPhone,
  type BkGuardianDetail,
  type BkGuardianStatus,
} from "@/lib/bangka";
import {
  blockCls,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  panelToneCls,
} from "@/lib/ui";

// =====================================================================
// 보호자 정보 수정 창 — 이름·연락처·관계·메모. (조유경 팀장 요청 2026-11)
//   입력 → 확인(바뀐 항목, 연락처면 "로그인 번호가 바뀝니다") → 저장 →
//   연락처를 바꿨으면 상태별 문자 버튼(자동 발송 없음):
//     · 초대중: [초대 문자 다시 보내기] — 링크가 만료됐으면 서버가 새로 발급
//     · 사용중: [연락처 변경 안내 문자 보내기]
//   PIN·상태·초대 토큰은 여기서 바꾸지 않습니다.
// =====================================================================

type Form = { name: string; phone: string; relation: string; memo: string };
type Step = "form" | "confirm" | "done";

export default function GuardianEditDialog({
  guardian: g,
  onClose,
}: {
  guardian: BkGuardianDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>("form");
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({
    name: g.name,
    phone: formatBkPhone(g.phone),
    relation: g.relation ?? "",
    memo: g.memo ?? "",
  });
  const [saved, setSaved] = useState<{ phoneChanged: boolean; status: BkGuardianStatus } | null>(null);
  const [smsMsg, setSmsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [smsSent, setSmsSent] = useState(false);

  const phoneDigits = normalizeBkPhone(form.phone);
  const changes: { label: string; from: string; to: string }[] = [];
  if (form.name.trim() !== g.name) changes.push({ label: "이름", from: g.name, to: form.name.trim() });
  if (phoneDigits !== g.phone)
    changes.push({ label: "연락처", from: formatBkPhone(g.phone), to: formatBkPhone(phoneDigits) });
  if (form.relation.trim() !== (g.relation ?? ""))
    changes.push({ label: "관계", from: g.relation || "-", to: form.relation.trim() || "-" });
  if (form.memo.trim() !== (g.memo ?? ""))
    changes.push({ label: "메모", from: g.memo || "-", to: form.memo.trim() || "-" });
  const phoneChanging = phoneDigits !== g.phone;

  function toConfirm() {
    setErr(null);
    if (!form.name.trim()) return setErr("이름을 입력하세요.");
    if (!phoneDigits) return setErr("연락처를 입력하세요.");
    if (!isValidBkPhone(phoneDigits)) return setErr("휴대폰 번호를 입력해 주세요. 예: 010-1234-5678");
    if (changes.length === 0) return setErr("바뀐 내용이 없습니다.");
    setStep("confirm");
  }

  function save() {
    setErr(null);
    start(async () => {
      const res = await updateGuardianInfo({
        id: g.id,
        name: form.name,
        phone: phoneDigits,
        relation: form.relation,
        memo: form.memo,
      });
      if (!res.ok) {
        setErr(res.message);
        setStep("form");
        return;
      }
      setSaved({ phoneChanged: res.phoneChanged, status: res.status });
      setStep("done");
      router.refresh();
    });
  }

  function sendSms(kind: "invite" | "notice") {
    setSmsMsg(null);
    start(async () => {
      const res = kind === "invite" ? await resendGuardianInviteSms(g.id) : await sendGuardianPhoneNotice(g.id);
      if (!res.ok) {
        setSmsMsg({ ok: false, text: res.message });
        return;
      }
      if (res.smsError) {
        setSmsMsg({ ok: false, text: `${res.smsError} (보호자 정보는 저장되어 있습니다)` });
      } else {
        setSmsSent(true);
        setSmsMsg({
          ok: true,
          text:
            kind === "invite"
              ? `초대 문자를 보냈습니다${"reissued" in res && res.reissued ? " — 링크가 만료돼 새로 발급했습니다" : ""}.`
              : "연락처 변경 안내 문자를 보냈습니다.",
        });
      }
      router.refresh();
    });
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${g.name} 보호자 정보 수정`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className={`${panelToneCls("blue")} max-h-[92vh] w-full max-w-md overflow-y-auto shadow-lg`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">보호자 정보 수정 — {g.name}</h3>
          <button type="button" onClick={onClose} disabled={pending} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>

        {g.students.length > 0 && (
          <p className={noticeWarning}>
            이 보호자는 학생 {g.students.length}명({g.students.map((s) => s.name).join(", ")})과 연결되어 있어
            수정하면 모두에 반영됩니다.
          </p>
        )}

        {step === "form" && (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className={labelCls}>이름</span>
              <input value={form.name} onChange={set("name")} className={`mt-1 ${inputCls}`} />
            </label>
            <label className="block">
              <span className={labelCls}>연락처 (동래방카 로그인 번호)</span>
              <input
                value={form.phone}
                onChange={set("phone")}
                inputMode="tel"
                placeholder="010-1234-5678"
                className={`mt-1 ${inputCls}`}
              />
              <span className="mt-1 block text-xs text-ink-hint">하이픈은 빼고 숫자만 저장합니다.</span>
            </label>
            <label className="block">
              <span className={labelCls}>관계</span>
              <input value={form.relation} onChange={set("relation")} placeholder="예: 모, 부, 조모" className={`mt-1 ${inputCls}`} />
            </label>
            <label className="block">
              <span className={labelCls}>메모</span>
              <textarea value={form.memo} onChange={set("memo")} rows={3} className={`mt-1 ${inputCls}`} />
            </label>
            <p className="text-xs text-ink-hint">PIN·상태·가입 링크는 여기서 바꾸지 않습니다.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnSecondary}>
                취소
              </button>
              <button type="button" onClick={toConfirm} className={btnPrimary}>
                다음
              </button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="mt-3 space-y-3">
            <div className={blockCls}>
              <p className="text-sm font-semibold text-ink">이렇게 바꿀까요?</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-body">
                {changes.map((c) => (
                  <li key={c.label}>
                    <span className="inline-block w-14 text-ink-muted">{c.label}</span>
                    <span className="text-ink-hint line-through">{c.from}</span> → <b>{c.to}</b>
                  </li>
                ))}
              </ul>
            </div>
            {phoneChanging && (
              <p className={noticeWarning}>
                로그인 번호가 바뀝니다. 저장하면 보호자는 동래방카에 새 번호({formatBkPhone(phoneDigits)})로 로그인해야
                합니다(PIN은 그대로). 문자는 자동으로 보내지 않습니다.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStep("form")} disabled={pending} className={btnSecondary}>
                뒤로
              </button>
              <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
                {pending ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && saved && (
          <div className="mt-3 space-y-3">
            <p className={noticeSuccess}>저장했습니다.</p>
            {saved.phoneChanged && saved.status === "invited" && (
              <div className={blockCls}>
                <p className="text-sm text-ink-body">
                  아직 가입 전(초대중)인 보호자입니다. 새 번호로 초대 문자를 다시 보낼 수 있습니다. 기존 초대 링크가
                  만료됐으면 새로 발급해 보냅니다.
                </p>
                <button
                  type="button"
                  disabled={pending || smsSent}
                  onClick={() => sendSms("invite")}
                  className={`mt-2 ${btnPrimary}`}
                >
                  {pending ? "보내는 중…" : "초대 문자 다시 보내기"}
                </button>
              </div>
            )}
            {saved.phoneChanged && saved.status === "active" && (
              <div className={blockCls}>
                <p className="text-sm text-ink-body">
                  가입한 보호자입니다. 필요하면 새 번호로 안내 문자를 보내세요(선택).
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-ink-hint">
                  [동래구청소년센터 방과후아카데미] 보호자 연락처가 {phoneDigits.slice(-4)}로 변경되었습니다. 방카
                  로그인은 새 번호로 해 주세요.
                </p>
                <button
                  type="button"
                  disabled={pending || smsSent}
                  onClick={() => sendSms("notice")}
                  className={`mt-2 ${btnPrimary}`}
                >
                  {pending ? "보내는 중…" : "연락처 변경 안내 문자 보내기"}
                </button>
              </div>
            )}
            {saved.phoneChanged && saved.status === "suspended" && (
              <p className="text-xs text-ink-hint">정지된 보호자라 문자 버튼은 없습니다.</p>
            )}
            {smsMsg && <p className={smsMsg.ok ? noticeSuccess : noticeError}>{smsMsg.text}</p>}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} disabled={pending} className={btnSecondary}>
                닫기
              </button>
            </div>
          </div>
        )}

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      </div>
    </div>
  );
}
