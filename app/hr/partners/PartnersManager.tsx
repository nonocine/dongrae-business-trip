"use client";

import { useMemo, useState, useTransition } from "react";
import {
  listPartners,
  savePartner,
  setPartnerActive,
  deletePartner,
  saveContact,
  deleteContact,
} from "@/app/hr/partners/actions";
import {
  PARTNER_CATEGORIES,
  PARTNER_CATEGORY_BADGE,
  PARTNER_FIELD_LABELS,
  CONTACT_FIELD_LABELS,
  DEFAULT_PARTNER_CATEGORY,
  contactLine,
  countByCategory,
  partnerSearchText,
  primaryContact,
  type PartnerCategory,
  type PartnerContact,
  type PartnerWithContacts,
} from "@/lib/businessPartners";
import { fmtKstDate } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
  noticeSuccess,
  badgeNeutral,
  badgeNavy,
  tabBarCls,
  tabNavCls,
  tabItemCls,
} from "@/lib/ui";

// 거래처 관리 — 분야별 목록·등록/수정·상세(담당자 여러 명 관리).
//   * 명함첩이 "받은편지함"이라면 여기는 "정리된 주소록"입니다. 명함이 없어도
//     수기로 등록할 수 있어야 해서 필수값은 거래처명 하나뿐입니다.
//   * 거래 종료는 삭제가 아니라 is_active=false(기본 숨김)로 처리합니다.
//   * 명함첩 연결(card_id)은 2단계 — 이 화면에서는 다루지 않습니다.

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const lblCls = "block text-xs font-medium text-ink-muted";

type CategoryTab = "전체" | PartnerCategory;

type PartnerForm = {
  id: string | null;
  name: string;
  category: PartnerCategory;
  phone: string;
  fax: string;
  address: string;
  website: string;
  memo: string;
  isActive: boolean;
};

const EMPTY_PARTNER_FORM: PartnerForm = {
  id: null,
  name: "",
  category: DEFAULT_PARTNER_CATEGORY,
  phone: "",
  fax: "",
  address: "",
  website: "",
  memo: "",
  isActive: true,
};

type ContactForm = {
  id: string | null;
  person_name: string;
  title: string;
  department: string;
  mobile: string;
  phone: string;
  email: string;
  memo: string;
  isPrimary: boolean;
};

const EMPTY_CONTACT_FORM: ContactForm = {
  id: null,
  person_name: "",
  title: "",
  department: "",
  mobile: "",
  phone: "",
  email: "",
  memo: "",
  isPrimary: false,
};

function categoryBadge(category: PartnerCategory): string {
  return `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${PARTNER_CATEGORY_BADGE[category]}`;
}

export default function PartnersManager({
  initialPartners,
}: {
  initialPartners: PartnerWithContacts[];
}) {
  const [partners, setPartners] =
    useState<PartnerWithContacts[]>(initialPartners);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<CategoryTab>("전체");
  const [showEnded, setShowEnded] = useState(false); // 거래종료 포함 보기
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, startBusy] = useTransition();

  // 거래처 등록·수정 폼.
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PartnerForm>({ ...EMPTY_PARTNER_FORM });

  // 상세(거래처 id) + 담당자 폼.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactForm, setContactForm] = useState<ContactForm>({
    ...EMPTY_CONTACT_FORM,
  });

  const detail = useMemo(
    () => partners.find((p) => p.id === detailId) ?? null,
    [partners, detailId],
  );

  // 거래 중인 곳만(또는 종료 포함) → 분야 카운트의 모집단.
  const visible = useMemo(
    () => (showEnded ? partners : partners.filter((p) => p.is_active)),
    [partners, showEnded],
  );

  const counts = useMemo(() => countByCategory(visible), [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible.filter((p) => {
      if (tab !== "전체" && p.category !== tab) return false;
      if (q && !partnerSearchText(p).includes(q)) return false;
      return true;
    });
  }, [visible, tab, query]);

  async function reload() {
    setPartners(await listPartners());
  }

  // --- 거래처 폼 ---
  function openNewPartner() {
    setForm({ ...EMPTY_PARTNER_FORM });
    setFormOpen(true);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openEditPartner(p: PartnerWithContacts) {
    setForm({
      id: p.id,
      name: p.name,
      category: p.category,
      phone: p.phone,
      fax: p.fax,
      address: p.address,
      website: p.website,
      memo: p.memo,
      isActive: p.is_active,
    });
    setFormOpen(true);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitPartner() {
    setMsg(null);
    startBusy(async () => {
      const res = await savePartner({
        id: form.id,
        name: form.name,
        category: form.category,
        phone: form.phone,
        fax: form.fax,
        address: form.address,
        website: form.website,
        memo: form.memo,
        isActive: form.isActive,
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      setFormOpen(false);
      const wasNew = !form.id;
      setForm({ ...EMPTY_PARTNER_FORM });
      // 새로 등록했으면 곧바로 상세를 열어 담당자를 이어서 넣을 수 있게 합니다.
      if (wasNew) {
        setDetailId(res.id);
        setContactOpen(false);
        setContactForm({ ...EMPTY_CONTACT_FORM });
      }
      setMsg({
        kind: "ok",
        text: wasNew
          ? "거래처를 등록했습니다. 아래에서 담당자를 추가할 수 있습니다."
          : "거래처를 수정했습니다.",
      });
    });
  }

  function toggleActive(p: PartnerWithContacts) {
    const next = !p.is_active;
    if (
      !next &&
      !confirm(
        `'${p.name}' 을(를) 거래 종료로 표시할까요?\n` +
          "삭제가 아니라 목록에서 숨기는 것이며, 담당자 이력은 그대로 남습니다.",
      )
    )
      return;
    setMsg(null);
    startBusy(async () => {
      const res = await setPartnerActive(p.id, next);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      setMsg({
        kind: "ok",
        text: next ? "거래를 재개했습니다." : "거래 종료로 표시했습니다.",
      });
    });
  }

  function removePartner(p: PartnerWithContacts) {
    if (
      !confirm(
        `'${p.name}' 거래처를 삭제할까요?\n` +
          `소속 담당자 ${p.contacts.length}명도 함께 삭제되며 되돌릴 수 없습니다.\n` +
          "이력을 남기려면 삭제 대신 '거래 종료'를 쓰세요.",
      )
    )
      return;
    setMsg(null);
    startBusy(async () => {
      const res = await deletePartner(p.id);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      if (detailId === p.id) setDetailId(null);
      if (form.id === p.id) {
        setForm({ ...EMPTY_PARTNER_FORM });
        setFormOpen(false);
      }
      setMsg({ kind: "ok", text: "거래처를 삭제했습니다." });
    });
  }

  // --- 담당자 폼 ---
  function openNewContact(p: PartnerWithContacts) {
    setContactForm({
      ...EMPTY_CONTACT_FORM,
      // 첫 담당자는 자동으로 대표담당자로 제안합니다.
      isPrimary: p.contacts.length === 0,
    });
    setContactOpen(true);
    setMsg(null);
  }

  function openEditContact(c: PartnerContact) {
    setContactForm({
      id: c.id,
      person_name: c.person_name,
      title: c.title,
      department: c.department,
      mobile: c.mobile,
      phone: c.phone,
      email: c.email,
      memo: c.memo,
      isPrimary: c.is_primary,
    });
    setContactOpen(true);
    setMsg(null);
  }

  function submitContact() {
    if (!detail) return;
    setMsg(null);
    startBusy(async () => {
      const res = await saveContact({
        id: contactForm.id,
        partnerId: detail.id,
        person_name: contactForm.person_name,
        title: contactForm.title,
        department: contactForm.department,
        mobile: contactForm.mobile,
        phone: contactForm.phone,
        email: contactForm.email,
        memo: contactForm.memo,
        isPrimary: contactForm.isPrimary,
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      setContactOpen(false);
      setContactForm({ ...EMPTY_CONTACT_FORM });
      setMsg({
        kind: "ok",
        text: contactForm.id
          ? "담당자를 수정했습니다."
          : "담당자를 추가했습니다.",
      });
    });
  }

  function removeContact(c: PartnerContact) {
    if (!confirm(`담당자 '${c.person_name}' 을(를) 삭제할까요?`)) return;
    setMsg(null);
    startBusy(async () => {
      const res = await deleteContact(c.id);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      if (contactForm.id === c.id) {
        setContactForm({ ...EMPTY_CONTACT_FORM });
        setContactOpen(false);
      }
      setMsg({ kind: "ok", text: "담당자를 삭제했습니다." });
    });
  }

  const endedCount = partners.filter((p) => !p.is_active).length;

  return (
    <div className="space-y-4">
      {/* 검색 · 등록 · 거래종료 보기 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inCls} max-w-xs flex-1`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처명·담당자명 검색"
          />
          <span className="text-xs text-ink-muted">
            {filtered.length} / {visible.length}곳
          </span>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={showEnded}
              onChange={(e) => setShowEnded(e.target.checked)}
            />
            거래종료 포함{endedCount > 0 ? ` (${endedCount})` : ""}
          </label>
          <div className="ml-auto">
            <button type="button" className={btnPrimary} onClick={openNewPartner}>
              + 거래처 등록
            </button>
          </div>
        </div>

        {/* 분야별 탭 — 인수인계 때 "시설만"·"학교만" 뽑아보는 축 */}
        <div className={`${tabBarCls} mt-3`}>
          <nav className={tabNavCls}>
            <button
              type="button"
              className={tabItemCls(tab === "전체")}
              onClick={() => setTab("전체")}
            >
              전체 {visible.length}
            </button>
            {PARTNER_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={tabItemCls(tab === cat)}
                onClick={() => setTab(cat)}
              >
                {cat} {counts[cat]}
              </button>
            ))}
          </nav>
        </div>
      </section>

      {msg && (
        <p className={msg.kind === "ok" ? noticeSuccess : noticeError}>
          {msg.text}
        </p>
      )}

      {/* 거래처 등록 · 수정 */}
      {formOpen && (
        <section className={cardCls}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold tracking-wide text-navy">
              {form.id ? "거래처 수정" : "거래처 등록"}
            </h3>
            <button
              type="button"
              className="text-xs text-ink-hint hover:underline"
              onClick={() => {
                setForm({ ...EMPTY_PARTNER_FORM });
                setFormOpen(false);
              }}
            >
              닫기 ✕
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className={lblCls} htmlFor="partner-name">
                거래처명 <span className="text-stamp">*</span>
              </label>
              <input
                id="partner-name"
                className={`${inCls} mt-1`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 동래중학교, ○○설비"
              />
            </div>
            <div>
              <label className={lblCls} htmlFor="partner-category">
                분야
              </label>
              <select
                id="partner-category"
                className={`${inCls} mt-1`}
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value as PartnerCategory,
                  })
                }
              >
                {PARTNER_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {PARTNER_FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className={key === "address" ? "sm:col-span-2" : ""}>
                <label className={lblCls} htmlFor={`partner-${key}`}>
                  {label}
                </label>
                <input
                  id={`partner-${key}`}
                  className={`${inCls} mt-1`}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}

            <div className="sm:col-span-2">
              <label className={lblCls} htmlFor="partner-memo">
                메모 (인수인계용)
              </label>
              <textarea
                id="partner-memo"
                className={`${inCls} mt-1`}
                rows={3}
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
                placeholder="거래 내용·주의사항·정산 방식 등 후임자가 알아야 할 내용"
              />
            </div>

            {form.id && (
              <label className="flex items-center gap-1.5 text-xs text-ink-muted sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                />
                거래 중 (해제하면 목록에서 숨겨집니다)
              </label>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={submitPartner}
            >
              {form.id ? "수정 저장" : "저장"}
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setForm({ ...EMPTY_PARTNER_FORM });
                setFormOpen(false);
              }}
            >
              취소
            </button>
          </div>
        </section>
      )}

      {/* 상세 — 거래처 정보 + 담당자 관리 */}
      {detail && (
        <section className={cardCls}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-ink">{detail.name}</h3>
                <span className={categoryBadge(detail.category)}>
                  {detail.category}
                </span>
                {!detail.is_active && (
                  <span className={badgeNeutral}>거래종료</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-hint">
                담당자 {detail.contacts.length}명 · 최근수정{" "}
                {fmtKstDate(detail.updated_at)}
                {detail.registered_by ? ` · 등록 ${detail.registered_by}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-ink-hint hover:underline"
              onClick={() => {
                setDetailId(null);
                setContactOpen(false);
              }}
            >
              닫기 ✕
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {PARTNER_FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs text-ink-muted">{label}</dt>
                <dd className="min-w-0 break-words text-ink-body">
                  {detail[key] || <span className="text-ink-hint">-</span>}
                </dd>
              </div>
            ))}
            {detail.memo && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="w-20 shrink-0 text-xs text-ink-muted">메모</dt>
                <dd className="whitespace-pre-wrap text-ink-body">
                  {detail.memo}
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btnSecondary} h-8 px-3 text-xs`}
              onClick={() => openEditPartner(detail)}
            >
              거래처 수정
            </button>
            <button
              type="button"
              className={`${btnSecondary} h-8 px-3 text-xs`}
              disabled={busy}
              onClick={() => toggleActive(detail)}
            >
              {detail.is_active ? "거래 종료" : "거래 재개"}
            </button>
            <button
              type="button"
              className={`${btnDanger} h-8 px-3 text-xs`}
              disabled={busy}
              onClick={() => removePartner(detail)}
            >
              삭제
            </button>
          </div>

          {/* 담당자 목록 */}
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold tracking-wide text-navy">
                담당자 ({detail.contacts.length})
              </h4>
              <button
                type="button"
                className={`${btnSecondary} h-8 px-3 text-xs`}
                onClick={() => openNewContact(detail)}
              >
                + 담당자 추가
              </button>
            </div>

            {detail.contacts.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-hint">
                등록된 담당자가 없습니다. 담당자 없이도 거래처는 유지됩니다.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {detail.contacts.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-line p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-ink">
                            {c.person_name || "(이름 없음)"}
                          </strong>
                          {c.is_primary && (
                            <span className={badgeNavy}>대표담당자</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-ink-muted">
                          {[c.title, c.department].filter(Boolean).join(" · ") ||
                            "-"}
                        </p>
                        <p className="mt-0.5 text-ink-body">
                          {[
                            c.mobile && `휴대 ${c.mobile}`,
                            c.phone && `직통 ${c.phone}`,
                            c.email,
                          ]
                            .filter(Boolean)
                            .join(" · ") || (
                            <span className="text-ink-hint">연락처 없음</span>
                          )}
                        </p>
                        {c.memo && (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">
                            {c.memo}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className={`${btnSecondary} h-8 px-3 text-xs`}
                          onClick={() => openEditContact(c)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className={`${btnDanger} h-8 px-3 text-xs`}
                          disabled={busy}
                          onClick={() => removeContact(c)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* 담당자 등록 · 수정 */}
            {contactOpen && (
              <div className="mt-3 rounded-lg border border-dashed border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-xs font-bold tracking-wide text-navy">
                    {contactForm.id ? "담당자 수정" : "담당자 추가"}
                  </h5>
                  <button
                    type="button"
                    className="text-xs text-ink-hint hover:underline"
                    onClick={() => {
                      setContactForm({ ...EMPTY_CONTACT_FORM });
                      setContactOpen(false);
                    }}
                  >
                    닫기 ✕
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CONTACT_FIELD_LABELS.map(({ key, label }) => (
                    <div key={key}>
                      <label className={lblCls} htmlFor={`contact-${key}`}>
                        {label}
                        {key === "person_name" && (
                          <span className="text-stamp"> *</span>
                        )}
                      </label>
                      <input
                        id={`contact-${key}`}
                        className={`${inCls} mt-1`}
                        value={contactForm[key]}
                        onChange={(e) =>
                          setContactForm({
                            ...contactForm,
                            [key]: e.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className={lblCls} htmlFor="contact-memo">
                      메모
                    </label>
                    <textarea
                      id="contact-memo"
                      className={`${inCls} mt-1`}
                      rows={2}
                      value={contactForm.memo}
                      onChange={(e) =>
                        setContactForm({ ...contactForm, memo: e.target.value })
                      }
                      placeholder="담당 업무·연락 시 유의사항 등"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={contactForm.isPrimary}
                      onChange={(e) =>
                        setContactForm({
                          ...contactForm,
                          isPrimary: e.target.checked,
                        })
                      }
                    />
                    대표담당자 (거래처당 한 명 — 지정하면 기존 대표는 해제됩니다)
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${btnPrimary} h-8 px-3 text-xs`}
                    disabled={busy}
                    onClick={submitContact}
                  >
                    {contactForm.id ? "수정 저장" : "추가"}
                  </button>
                  <button
                    type="button"
                    className={`${btnSecondary} h-8 px-3 text-xs`}
                    onClick={() => {
                      setContactForm({ ...EMPTY_CONTACT_FORM });
                      setContactOpen(false);
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 목록 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold tracking-wide text-navy">
          {tab === "전체" ? "거래처 목록" : `${tab} 거래처`}
        </h3>
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            {partners.length === 0
              ? "등록된 거래처가 없습니다. 위에서 거래처를 등록하세요."
              : "조건에 맞는 거래처가 없습니다."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => {
              const head = primaryContact(p.contacts);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setDetailId(p.id);
                      setContactOpen(false);
                      setContactForm({ ...EMPTY_CONTACT_FORM });
                    }}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-ink">{p.name}</strong>
                      <span className={categoryBadge(p.category)}>
                        {p.category}
                      </span>
                      {!p.is_active && (
                        <span className={badgeNeutral}>거래종료</span>
                      )}
                    </span>
                    <p className="mt-0.5 truncate text-ink-muted">
                      {p.phone || "대표전화 없음"}
                      {` · 담당자 ${p.contacts.length}명`}
                      {head ? ` (${contactLine(head)})` : ""}
                      {` · 최근수정 ${fmtKstDate(p.updated_at)}`}
                    </p>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={`${btnSecondary} h-8 px-3 text-xs`}
                      onClick={() => openEditPartner(p)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className={`${btnDanger} h-8 px-3 text-xs`}
                      disabled={busy}
                      onClick={() => removePartner(p)}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
