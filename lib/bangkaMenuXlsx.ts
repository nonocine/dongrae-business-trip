// =====================================================================
// 업체 식단표 xlsx → 칸 격자(서버 전용).
//   업체 파일은 한컴오피스 셀에서 저장되어 XML 태그마다 "x:" 접두사가 붙어 있고
//   서식 정보도 표준과 달라 exceljs·SheetJS 가 열지 못하거나(예외) 빈 시트로 읽습니다.
//   그래서 값만 필요한 이 용도에는 zip 을 직접 풀어 시트 XML 의 값만 읽습니다.
//     · 접두사(x:, mc: …)는 떼고 봅니다. mc:Choice(한컴 확장 서식)는 통째로 버립니다.
//     · 공유 문자열(서식 있는 글자 조각 포함)·인라인 문자열·숫자 값을 읽습니다.
//     · 병합 칸은 왼쪽 위 칸에만 값이 있으므로 따로 펴지 않습니다.
// =====================================================================

import JSZip from "jszip";

export type XlsxGrid = { sheetName: string; rows: string[][] };

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

// 접두사 제거 + 한컴 확장 블록 제거.
function plain(xml: string): string {
  return xml
    .replace(/<mc:Choice\b[\s\S]*?<\/mc:Choice>/g, "")
    .replace(/<(\/?)[A-Za-z][\w.-]*:/g, "<$1");
}

// <t> 조각을 모두 이어 붙임(서식 조각 <r><t>…</t></r> 포함, 발음 <rPh> 제외).
function textOf(fragment: string): string {
  const noPh = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of noPh.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) out += decode(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// 첫 시트(또는 이름이 맞는 시트)를 격자로 읽습니다.
export async function readXlsxGrid(buf: ArrayBuffer | Uint8Array, preferSheet?: string): Promise<XlsxGrid> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("엑셀(xlsx) 파일을 열 수 없습니다. 파일이 손상되었거나 xls(옛 형식)일 수 있습니다.");
  }
  const read = async (p: string) => {
    const f = zip.file(p);
    return f ? plain(await f.async("string")) : null;
  };

  const wb = await read("xl/workbook.xml");
  if (!wb) throw new Error("엑셀 통합문서 정보를 찾지 못했습니다(xlsx 가 맞는지 확인하세요).");
  const rels = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, resolvePath("xl/workbook.xml", target.trim()));
  }
  const sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: decode(m[1].match(/\bname="([^"]*)"/)?.[1] ?? ""),
    rid: m[1].match(/\br:id="([^"]+)"|\bid="([^"]+)"/)?.slice(1).find(Boolean) ?? "",
  }));
  if (!sheets.length) throw new Error("시트가 없습니다.");
  const sheet = sheets.find((s) => preferSheet && s.name === preferSheet) ?? sheets[0];
  const sheetPath = relTarget.get(sheet.rid) ?? "xl/worksheets/sheet1.xml";

  const sstXml = await read("xl/sharedStrings.xml");
  const sst = sstXml ? [...sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  const ws = await read(sheetPath);
  if (!ws) throw new Error(`시트 '${sheet.name}' 내용을 찾지 못했습니다.`);
  const rows: string[][] = [];
  for (const rm of ws.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row: string[] = rows[r] ?? [];
    let auto = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const c = ref ? colIndex(ref) : auto;
      auto = c + 1;
      const body = cm[2] ?? "";
      const t = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (t === "s") val = sst[Number(v)] ?? "";
      else if (t === "inlineStr") val = textOf(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (v != null) val = decode(v);
      while (row.length < c) row.push("");
      row[c] = val;
    }
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) rows[i] = rows[i] ?? [];
  return { sheetName: sheet.name, rows };
}
