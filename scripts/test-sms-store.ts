// 문자 발송 — 문구함·주소록 실제 DB 점검(쓰기 있음: "[점검]" 행을 만들고 끝에 지웁니다).
//   실행: node --import tsx scripts/test-sms-store.ts
//   ① 문구함: 저장 → 목록(나만/공유) → 사용 횟수 → 즐겨찾기 → 수정 → 남이 수정 거부 → 삭제.
//   ② 주소록: 담긴 명단 저장(직원·방과후 보호자·직접 입력) → DB 출처는 참조만·직접 입력만 번호
//      → 공유 그룹을 권한 없는 직원이 쓰면 방과후 보호자는 "권한 밖"으로 제외 → 삭제(사람도 함께).
//   ③ 발송 이력 channel 칸.
//   ⚠️ 번호를 출력하지 않습니다.

import { readFileSync } from "node:fs";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  const { supabaseAdmin } = await import("../lib/supabaseAdmin");
  const tpl = await import("../lib/sms/templates");
  const grp = await import("../lib/sms/groups");
  const { computeRecipients } = await import("../lib/sms/recipients");
  const { findSmsSource } = await import("../lib/sms/sources");

  // 점검용 사용자 — 실제 직원 2명(만든 사람 / 다른 사람). 만든 행은 끝에 지웁니다.
  const { data: drivers } = await supabaseAdmin.from("drivers").select("id, name").eq("is_active", true).order("name").limit(2);
  const [d1, d2] = (drivers ?? []) as { id: string; name: string }[];
  const owner = { name: d1.name, driverId: d1.id, isM0: false, roles: ["bangka"], isPressAdmin: false };
  const other = { name: d2.name, driverId: d2.id, isM0: false, roles: [], isPressAdmin: false };

  const made: { templates: string[]; groups: string[] } = { templates: [], groups: [] };
  try {
    // ① 문구함
    const tid = await tpl.createTemplate(owner, { title: "[점검] 휴강 안내", body: "이번 주 수업은 휴강합니다.", category: "안내", visibility: "private" });
    made.templates.push(tid);
    let mine = await tpl.listTemplates(owner);
    let theirs = await tpl.listTemplates(other);
    chk("문구 저장·내 목록에 보임", mine.templates.some((t) => t.id === tid) && !mine.missing);
    chk("나만 문구는 남에게 안 보임", !theirs.templates.some((t) => t.id === tid));
    await tpl.updateTemplate(owner, tid, { visibility: "shared" });
    theirs = await tpl.listTemplates(other);
    const seen = theirs.templates.find((t) => t.id === tid);
    chk("공유로 바꾸면 남에게 보임·수정 권한 없음", !!seen && seen.can_edit === false);
    await tpl.markTemplateUsed(other, tid);
    await tpl.markTemplateUsed(owner, tid);
    await tpl.updateTemplate(owner, tid, { is_favorite: true });
    mine = await tpl.listTemplates(owner);
    const t1 = mine.templates.find((t) => t.id === tid);
    chk("사용 횟수 +2·즐겨찾기", t1?.use_count === 2 && t1?.is_favorite === true, `use_count ${t1?.use_count}`);
    chk("즐겨찾기가 맨 앞", mine.templates[0]?.id === tid || mine.templates[0]?.is_favorite === true);
    let refused = false;
    try {
      await tpl.updateTemplate(other, tid, { title: "남이 고침" });
    } catch {
      refused = true;
    }
    chk("남이 고치기 거부", refused);
    await tpl.deleteTemplate(owner, tid);
    made.templates = [];
    chk("문구 삭제", !(await tpl.listTemplates(owner)).templates.some((t) => t.id === tid));

    // ② 주소록
    const emp = await findSmsSource("employees")!.loadOptions(owner, { filter: {}, query: "" });
    const empIds = emp.items.filter((i) => i.hasPhone).slice(0, 2).map((i) => i.id);
    const bk = await findSmsSource("bk-guardians")!.loadOptions(owner, { filter: { mode: "all" }, query: "" });
    const bkIds = bk.items.filter((i) => i.hasPhone).slice(0, 1).map((i) => i.id);
    const { refs } = await computeRecipients(owner, [
      { uid: "e", source: "employees", selection: { ids: empIds }, excluded: [] },
      { uid: "b", source: "bk-guardians", selection: { filter: { mode: "all" }, ids: bkIds }, excluded: [] },
      { uid: "m", source: "manual", selection: { text: "점검, 010-0000-0009" }, excluded: [] },
    ]);
    const gid = await grp.createGroup(owner, { name: "[점검] 주소록", category: "점검", visibility: "shared", business_program_id: null }, refs);
    made.groups.push(gid);
    const { data: rows } = await supabaseAdmin.from(grp.GROUP_MEMBER_TABLE).select("source, ref_id, phone").eq("group_id", gid);
    const members = (rows ?? []) as { source: string; ref_id: string | null; phone: string | null }[];
    const bkCount = members.filter((m) => m.source === "bk-guardians").length;
    chk(
      "저장 — DB 출처는 참조만(번호 없음)·직접 입력만 번호",
      members.length === refs.length &&
        members.filter((m) => m.source !== "manual").every((m) => m.ref_id && m.phone === null) &&
        members.filter((m) => m.source === "manual").every((m) => !m.ref_id && !!m.phone),
      `직원 ${members.filter((m) => m.source === "employees").length} · 보호자 ${bkCount} · 직접 ${members.filter((m) => m.source === "manual").length}`,
    );
    const asOwner = await computeRecipients(owner, [{ uid: "g", source: "groups", selection: { ids: [gid] }, excluded: [] }]);
    chk("만든 사람(bangka 직무)으로 그룹 미리보기 — 권한 밖 0", asOwner.preview.restricted === 0 && asOwner.preview.total === members.length, `총 ${asOwner.preview.total}`);
    const asOther = await computeRecipients(other, [{ uid: "g", source: "groups", selection: { ids: [gid] }, excluded: [] }]);
    chk(
      "권한 없는 직원이 공유 그룹 쓰면 방과후 보호자 제외",
      asOther.preview.restricted === bkCount && asOther.preview.total === members.length - bkCount,
      `권한 밖 ${asOther.preview.restricted} · 총 ${asOther.preview.total}`,
    );
    const otherList = await grp.listGroups(other);
    chk("공유 그룹은 남의 목록에도 보이고 수정 권한 없음", otherList.groups.some((g) => g.id === gid && !g.can_edit));
    let refusedG = false;
    try {
      await grp.deleteGroup(other, gid);
    } catch {
      refusedG = true;
    }
    chk("남이 지우기 거부", refusedG);
    await grp.deleteGroup(owner, gid);
    made.groups = [];
    const { count } = await supabaseAdmin.from(grp.GROUP_MEMBER_TABLE).select("id", { count: "exact", head: true }).eq("group_id", gid);
    chk("그룹 삭제 시 사람도 함께 삭제(cascade)", count === 0);

    // ③
    const { error } = await supabaseAdmin.from("sms_send_logs").select("channel").limit(1);
    chk("발송 이력 channel 칸 있음", !error, error?.message);
  } finally {
    for (const id of made.templates) await supabaseAdmin.from(tpl.TEMPLATE_TABLE).delete().eq("id", id);
    for (const id of made.groups) await supabaseAdmin.from(grp.GROUP_TABLE).delete().eq("id", id);
  }

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
