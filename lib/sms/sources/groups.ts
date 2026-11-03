// 출처 ⑦ 주소록 — 내 그룹 + 전 직원 공유 그룹(lib/sms/groups).
//   공유 그룹은 모든 직원의 이 카드 안에 보입니다 → 직원이 코드 수정 없이 새 출처를 만드는 셈.
//   그룹 안 사람: DB 출처는 {source, ref_id} 로 저장돼 있어, 보낼 때 그 출처의
//   resolveRefs 로 최신 이름·번호를 가져옵니다. 직접 입력(manual)은 저장된 번호.
//   ⚠️ 공유 그룹에 든 사람은 그 출처의 canUse 가 없는 직원도 보낼 수 있습니다
//     (만든 사람이 공유를 고른 것). 번호는 여전히 화면에 나가지 않습니다.

import { listGroups, loadGroupMembers } from "@/lib/sms/groups";
import { SMS_TABLE_MISSING } from "@/lib/sms/text";
import { findSmsSource } from "./index";
import { idsOf, type ResolvedPerson, type SmsSource } from "./types";

export const groupsSource: SmsSource = {
  key: "groups",
  label: "주소록",
  icon: "📇",
  description: "내 그룹 · 전 직원 공유 그룹",
  pickerType: "list",
  color: "green",
  canUse: () => true,

  async loadOptions(u, { filter }) {
    const { groups, missing } = await listGroups(u);
    const scope = filter.scope === "mine" || filter.scope === "shared" ? filter.scope : "all";
    const list = groups.filter(
      (g) =>
        scope === "all" ||
        (scope === "shared" ? g.visibility === "shared" : g.visibility === "private"),
    );
    return {
      filters: [
        {
          key: "scope",
          label: "보기",
          kind: "radio",
          value: scope,
          options: [
            { value: "all", label: "전체" },
            { value: "mine", label: "나만" },
            { value: "shared", label: "공유" },
          ],
        },
      ],
      grouped: true,
      items: list.map((g) => ({
        id: g.id,
        name: g.name,
        sub: [
          g.visibility === "shared" ? "공유" : "나만",
          g.category,
          g.business_program_name,
          g.owner_name ? `만든 사람 ${g.owner_name}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        count: g.member_count,
        hasPhone: g.member_count > 0,
      })),
      note: missing ? SMS_TABLE_MISSING : list.length === 0 ? "주소록이 없습니다. 담긴 명단을 저장하거나 새로 만드세요." : undefined,
    };
  },

  async resolvePhones(u, sel) {
    const { groups, members } = await loadGroupMembers(u, idsOf(sel));
    // 출처별로 모아 한 번에 최신 정보를 가져옵니다.
    const bySource = new Map<string, string[]>();
    for (const m of members) {
      if (m.source === "manual" || !m.ref_id) continue;
      bySource.set(m.source, [...(bySource.get(m.source) ?? []), m.ref_id]);
    }
    const latest = new Map<string, { name: string; phone: string | null }>();
    for (const [source, ids] of bySource) {
      const src = findSmsSource(source);
      if (!src?.resolveRefs) continue;
      const map = await src.resolveRefs([...new Set(ids)]);
      for (const [id, v] of map) latest.set(`${source}:${id}`, v);
    }
    const people: ResolvedPerson[] = members.map((m) => {
      if (m.source === "manual")
        return {
          key: `groups:${m.id}`,
          name: m.name || "직접 입력",
          phone: m.phone,
          ref: { source: "manual", ref_id: null, phone: m.phone },
        };
      const cur = latest.get(`${m.source}:${m.ref_id}`);
      return {
        key: `groups:${m.id}`,
        // 이름은 저장 당시 이름(누구인지 알아보기 쉬움). 번호는 늘 최신 — 없어졌으면 번호 없음.
        name: m.name || cur?.name || "(이름 없음)",
        phone: cur?.phone ?? null,
        ref: { source: m.source, ref_id: m.ref_id, phone: null },
      };
    });
    const label =
      groups.length === 1 ? `주소록 ${groups[0].name}` : `주소록 ${groups.length}개`;
    return { label, short: label, people };
  },
};
