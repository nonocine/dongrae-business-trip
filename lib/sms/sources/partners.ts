// 출처 ⑤ 거래처 담당자 — 거래처(또는 담당자) 이름 검색 → 담당자 체크.
//   번호: partner_contacts.mobile 우선, 없으면 phone.
//   비공개 거래처(is_private)와 그 담당자는 M0·hr 에게만(거래처 관리 화면과 같은 기준,
//   lib/partnerAccess). 사용: 문자 발송 권한이 있는 직원 누구나.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import type { SmsUser } from "@/lib/sms/access";
import { idsOf, inChunks, str, type SmsSource } from "./types";

type Partner = { id: string; name: string };
type Contact = {
  id: string;
  partner_id: string;
  person_name: string | null;
  title: string | null;
  department: string | null;
  mobile: string | null;
  phone: string | null;
};
const CONTACT_COLS = "id, partner_id, person_name, title, department, mobile, phone";

const canSeePrivate = (u: SmsUser) => u.isM0 || u.roles.includes("hr");

// 보이는 거래처 — 비공개는 권한자만, 사용 중지(is_active=false)는 뺍니다.
async function visiblePartners(u: SmsUser, ids?: string[]): Promise<Map<string, Partner>> {
  let q = supabaseAdmin.from("business_partners").select("id, name, is_private, is_active");
  if (ids) q = q.in("id", ids.slice(0, 1000));
  const { data, error } = await q;
  if (error) throw new Error(`거래처 조회 실패: ${error.message}`);
  const rows = (data ?? []) as (Partner & { is_private: boolean | null; is_active: boolean | null })[];
  return new Map(
    rows
      .filter((p) => p.is_active !== false && (p.is_private !== true || canSeePrivate(u)))
      .map((p) => [p.id, { id: p.id, name: p.name }]),
  );
}

const pickPhone = (c: Contact) => {
  const m = normalizeSmsPhone(c.mobile ?? "");
  return isValidSmsPhone(m) ? c.mobile : c.phone;
};

export const partnersSource: SmsSource = {
  key: "partners",
  label: "거래처",
  icon: "🤝",
  description: "거래처 검색 → 담당자",
  pickerType: "search",
  color: "violet",
  canUse: () => true,

  async loadOptions(u, { query }) {
    const q = query.trim();
    const partners = await visiblePartners(u);
    const { data, error } = await supabaseAdmin.from("partner_contacts").select(CONTACT_COLS);
    if (error) throw new Error(`담당자 조회 실패: ${error.message}`);
    const contacts = ((data ?? []) as Contact[]).filter((c) => partners.has(c.partner_id));
    const lower = q.toLowerCase();
    const hit = (c: Contact) =>
      !q ||
      str(partners.get(c.partner_id)?.name).toLowerCase().includes(lower) ||
      str(c.person_name).toLowerCase().includes(lower);
    return {
      filters: [],
      items: contacts
        .filter(hit)
        .sort((a, b) =>
          str(partners.get(a.partner_id)?.name).localeCompare(str(partners.get(b.partner_id)?.name), "ko"),
        )
        .slice(0, 300)
        .map((c) => ({
          id: c.id,
          name: str(c.person_name) || "(이름 없음)",
          sub: [c.department, c.title].filter(Boolean).join(" · ") || undefined,
          group: partners.get(c.partner_id)?.name ?? "",
          hasPhone: isValidSmsPhone(normalizeSmsPhone(pickPhone(c) ?? "")),
        })),
      note: q ? undefined : "거래처명이나 담당자 이름으로 검색하세요.",
    };
  },

  async resolvePhones(u, sel) {
    const contacts = await loadContacts(idsOf(sel));
    const partners = await visiblePartners(u, [...new Set(contacts.map((c) => c.partner_id))]);
    const list = contacts.filter((c) => partners.has(c.partner_id));
    const partnerNames = [...new Set(list.map((c) => partners.get(c.partner_id)!.name))];
    return {
      label:
        partnerNames.length === 1
          ? `거래처 ${partnerNames[0]} ${list.length}명`
          : `거래처 ${partnerNames.length}곳 ${list.length}명`,
      short: "거래처",
      people: list.map((c) => ({
        key: `partners:${c.id}`,
        name: `${str(c.person_name) || "담당자"}(${partners.get(c.partner_id)!.name})`,
        phone: pickPhone(c),
        ref: { source: "partners", ref_id: c.id, phone: null },
      })),
    };
  },

  async resolveRefs(ids) {
    const contacts = await loadContacts(ids);
    return new Map(contacts.map((c) => [c.id, { name: str(c.person_name), phone: pickPhone(c) }]));
  },
};

async function loadContacts(ids: string[]): Promise<Contact[]> {
  return inChunks(ids, async (chunk) => {
    const { data, error } = await supabaseAdmin.from("partner_contacts").select(CONTACT_COLS).in("id", chunk);
    if (error) throw new Error(`담당자 조회 실패: ${error.message}`);
    return (data ?? []) as Contact[];
  });
}
