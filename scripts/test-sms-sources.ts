// 문자 발송 출처 등록표 — 라이브 점검(읽기 전용, 발송·저장 없음).
//   실행: node --import tsx scripts/test-sms-sources.ts
//   ① 모든 출처의 loadOptions 응답에 전화번호 같은 숫자열이 없는지(화면으로 나가는 값).
//   ② 동래미래 기본 차시·'테스트' 차시 제외, 수강생은 active 만.
//   ③ 담긴 명단 계산(computeRecipients) — 중복 제거·번호 없음·개별 빼기.
//   ④ 권한(canUse) — 출처별 기준.
//   ⑤ 주소록·문구함 표가 없을 때 빈 목록 + missing.
//   ⑥ 본문 조립(머리말·광고 표기)·번호 판정·붙여넣기 해석.

import { readFileSync } from "node:fs";

let failed = 0;
function chk(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}
const PHONE_LIKE = /0\d{1,2}-?\d{3,4}-?\d{4}/;

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  const { SMS_SOURCES, findSmsSource } = await import("../lib/sms/sources");
  const { computeRecipients } = await import("../lib/sms/recipients");
  const { listGroups } = await import("../lib/sms/groups");
  const { listTemplates } = await import("../lib/sms/templates");
  const { smsChannel } = await import("../lib/sms/channels/sms");
  const t = await import("../lib/sms/text");

  const admin = { name: "점검", driverId: null, isM0: true, roles: ["saem", "bangka", "hr"], isPressAdmin: true };
  const staff = { name: "점검2", driverId: null, isM0: false, roles: [], isPressAdmin: false };

  // ①
  for (const s of SMS_SOURCES) {
    const r = await s.loadOptions(admin, { filter: {}, query: s.pickerType === "search" ? "" : "" });
    // id(UUID)는 숫자열이 우연히 번호 모양일 수 있어 빼고 봅니다.
    const shown = JSON.stringify({ ...r, items: r.items.map((i) => [i.name, i.sub, i.group]) });
    chk(`${s.label}: 목록 ${r.items.length}개, 번호 없음`, !PHONE_LIKE.test(shown));
  }

  // ②
  const academy = findSmsSource("saem-academy")!;
  const ao = await academy.loadOptions(admin, { filter: {}, query: "" });
  const termFilter = ao.filters[0];
  chk("동래미래 차시 목록에 '테스트' 없음", termFilter.options.every((o) => !o.label.includes("테스트")), termFilter.options.map((o) => o.label).join(", "));
  chk("동래미래 기본 차시 있음", !!termFilter.value, termFilter.options.find((o) => o.value === termFilter.value)?.label);
  const four = termFilter.options.find((o) => o.label.startsWith("4차시"));
  if (four) {
    const o4 = await academy.loadOptions(admin, { filter: { term: four.value }, query: "" });
    const people = o4.items.reduce((a, i) => a + (i.count ?? 0), 0);
    const r = await academy.resolvePhones(admin, { ids: o4.items.map((i) => i.id) });
    chk("4차시 전체 담기 = 프로그램 인원 합", r.people.length === people, `${o4.items.length}개 프로그램 · ${people}명 · 칩 "${r.label}"`);
  }

  // ③
  const inst = findSmsSource("instructors")!;
  const io = await inst.loadOptions(admin, { filter: {}, query: "" });
  const instIds = io.items.filter((i) => i.hasPhone).map((i) => i.id);
  const emp = await findSmsSource("employees")!.loadOptions(admin, { filter: {}, query: "" });
  const empIds = emp.items.map((i) => i.id);
  const base = await computeRecipients(admin, [
    { uid: "a", source: "instructors", selection: { ids: instIds }, excluded: [] },
    { uid: "b", source: "instructors", selection: { ids: instIds.slice(0, 3) }, excluded: [] },
    { uid: "c", source: "employees", selection: { ids: empIds }, excluded: [] },
    { uid: "d", source: "manual", selection: { text: "홍길동, 010-0000-0001\n010-0000-0001\n잘못된줄 123" }, excluded: [] },
  ]);
  const p = base.preview;
  chk("같은 강사 두 번 담으면 중복 3건", p.duplicates >= 3 + 1, `중복 ${p.duplicates} · 번호없음 ${p.noPhone} · 총 ${p.total} · 요약 "${p.summary}"`);
  chk(
    "미리보기 응답에 번호 없음(직접 입력 제외)",
    !PHONE_LIKE.test(
      JSON.stringify(p.people.filter((x) => !x.key.startsWith("manual:")).map((x) => [x.name, x.sourceLabel])),
    ),
  );
  const ex = await computeRecipients(admin, [
    { uid: "a", source: "instructors", selection: { ids: instIds }, excluded: [`instructors:${instIds[0]}`] },
  ]);
  chk("개별 빼기 반영", ex.preview.total === instIds.length - 1, `${instIds.length} → ${ex.preview.total}`);
  chk("주소록 저장 참조 — DB 출처는 phone 없음", ex.refs.every((r) => r.phone === null && !!r.ref_id));

  // ④
  const can = (k: string, u: typeof admin) => findSmsSource(k)!.canUse(u);
  chk("일반 직원: 방과후·동래미래·기자 못 씀", !can("bk-guardians", staff) && !can("saem-academy", staff) && !can("reporters", staff));
  chk("일반 직원: 강사·직원·거래처·주소록·직접 입력 씀", can("instructors", staff) && can("employees", staff) && can("partners", staff) && can("groups", staff) && can("manual", staff));
  let denied = false;
  try {
    await computeRecipients(staff, [{ uid: "x", source: "saem-academy", selection: { ids: ["x"] }, excluded: [] }]);
  } catch {
    denied = true;
  }
  chk("권한 없는 출처로 계산 요청 → 거부", denied);

  // ⑤
  const g = await listGroups(admin);
  const tm = await listTemplates(admin);
  chk("주소록 조회(표 없으면 missing)", Array.isArray(g.groups), `missing=${g.missing}`);
  chk("문구함 조회(표 없으면 missing)", Array.isArray(tm.templates), `missing=${tm.missing}`);

  // ⑥
  const ad = t.composeSmsText("모집 안내", { header: true, advertising: true });
  chk("광고 표기", ad === `(광고)[동래구청소년센터] 모집 안내\n수신거부 ${t.SMS_OPTOUT_NUMBER}`, JSON.stringify(ad));
  chk("번호 판정", t.isValidSmsPhone("01012345678") && !t.isValidSmsPhone("0101234567") && t.isValidSmsPhone("0519880924") && t.isValidSmsPhone("0212345678") && !t.isValidSmsPhone("01112345678"));
  const lines = t.parseContactLines("홍길동, 010-1234-5678\n김철수\t01011112222\n010-2222-3333\n잘못 12");
  chk("붙여넣기 해석(이름,번호 · 탭 · 번호만 · 잘못)", lines.length === 4 && lines.filter((l) => l.valid).length === 3 && lines[1].name === "김철수");
  const night = new Date("2026-11-03T13:00:00Z"); // 22:00 KST
  chk("광고 야간 실제 발송 차단", smsChannel.validate(ad, 10, { test: false, advertising: true, now: night }).errors.length > 0);
  chk("광고 야간 테스트 발송 허용", smsChannel.validate(ad, 1, { test: true, advertising: true, now: night }).errors.length === 0);

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
