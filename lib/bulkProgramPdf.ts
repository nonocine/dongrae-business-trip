// =====================================================================
// 프로그램 관리 "선택 출력" — 체크한 프로그램들의 근무일지·출석부를 PDF 한 파일로.
//   * 브라우저에서 만든다. 서버에서 한 파일로 만들지 않는 이유:
//       - 나눔고딕 통임베드(subset:false) 때문에 PDF 1건이 이미 ~1.6MB 다.
//         개별 PDF 를 받아 이어 붙이면 폰트가 건수만큼 반복돼 25건이면 ~40MB 가 된다.
//       - 서버 한 번에 25건을 다 만들면 응답 한도(Vercel 4.5MB)·시간 제한에 걸릴 수 있고,
//         진행 표시·건별 실패 처리를 할 수 없다.
//     그래서 프로그램마다 데이터(JSON, 수 KB)만 따로 받고(요청이 짧아 시간 초과 없음),
//     문서 하나에 폰트를 한 번만 임베드한 뒤 lib/*PdfDraw 로 차례로 그린다.
//     그리는 함수는 개별 출력 라우트와 같은 것이라 양식이 100% 같다.
//   * 각 프로그램은 새 쪽부터(그리기 함수가 첫 쪽을 addPage 로 시작한다).
//   * 한 건이 실패해도 나머지는 계속 그리고, 실패한 이름을 돌려준다.
//   * 클라이언트 전용 — ProgramsManager 가 버튼을 누를 때 동적 import 한다.
// =====================================================================

import { PDFDocument } from "pdf-lib";
import fontkit, { type Font as FontkitFont } from "@pdf-lib/fontkit";
import { embedPdfFonts } from "@/lib/pdfFontText";
import { decodeBase64 } from "@/lib/dataUrl";
import { drawWorkLog, type WorkLogData } from "@/lib/workLogPdfDraw";
import {
  drawAttendance,
  type AttendanceSheetData,
} from "@/lib/attendancePdfDraw";
import { periodLabel, periodQuery, type WorkLogPeriod } from "@/lib/workLogPeriod";

export type BulkDoc = "worklog" | "attendance" | "attendance-blank";

export const BULK_DOC_LABEL: Record<BulkDoc, string> = {
  worklog: "강사근무일지",
  attendance: "출석부",
  "attendance-blank": "출석부_빈양식",
};

export type BulkItem = { id: string; name: string };
export type BulkResult = {
  bytes: Uint8Array | null; // 전부 실패하면 null
  ok: number;
  failed: { name: string; reason: string }[];
  // 근무일지 기간 안에 회차가 0 인 프로그램 — 실패가 아니라 건너뜀(쪽을 만들지 않는다).
  skipped: string[];
};

// 폰트는 탭이 살아 있는 동안 한 번만 받는다(라우트도 브라우저 캐시를 허용한다).
let fontsP: Promise<{
  regular: Uint8Array;
  bold: Uint8Array;
  fk: (isBold: boolean) => FontkitFont;
}> | null = null;
function loadFonts() {
  if (!fontsP) {
    fontsP = (async () => {
      const get = async (w: string) => {
        const r = await fetch(`/hr/saems/programs/pdf-font/${w}`);
        if (!r.ok) throw new Error(`폰트를 받지 못했습니다(${r.status}).`);
        return new Uint8Array(await r.arrayBuffer());
      };
      const [regular, bold] = await Promise.all([get("regular"), get("bold")]);
      const fkR = fontkit.create(regular as never);
      const fkB = fontkit.create(bold as never);
      return { regular, bold, fk: (isBold: boolean) => (isBold ? fkB : fkR) };
    })();
    fontsP.catch(() => {
      fontsP = null; // 실패하면 다음 시도에서 다시 받는다
    });
  }
  return fontsP;
}

type Loaded =
  | { kind: "worklog"; data: WorkLogData }
  | { kind: "attendance"; data: AttendanceSheetData };

async function fetchData(
  id: string,
  doc: BulkDoc,
  period: WorkLogPeriod
): Promise<Loaded> {
  const kind = doc === "worklog" ? "worklog" : "attendance";
  const q = kind === "worklog" && period ? `&${periodQuery(period)}` : "";
  const r = await fetch(
    `/hr/saems/programs/${encodeURIComponent(id)}/print-data?doc=${kind}${q}`,
    { cache: "no-store" }
  );
  if (!r.ok) {
    const msg = (await r.text().catch(() => "")).slice(0, 80);
    throw new Error(msg || `서버 오류 ${r.status}`);
  }
  const json = await r.json();
  if (kind === "worklog") return { kind, data: json as WorkLogData };
  // 도장은 base64 로 온다 → 바이트로 되돌린다(개별 출력과 같은 입력이 되게).
  const stamps: Record<string, Uint8Array | null> = {};
  for (const [name, b64] of Object.entries(
    (json.staffStamps ?? {}) as Record<string, string | null>
  ))
    stamps[name] = b64 ? decodeBase64(b64) : null;
  return { kind, data: { ...json, staffStamps: stamps } as AttendanceSheetData };
}

// 데이터 요청은 몇 개씩 미리 보내 두고, 그리기는 화면 표 순서대로 한다.
const PREFETCH = 4;

export async function buildBulkProgramPdf(
  items: BulkItem[],
  doc: BulkDoc,
  onProgress: (done: number, total: number) => void,
  period: WorkLogPeriod = null // 근무일지 전용. 출석부는 무시한다.
): Promise<BulkResult> {
  if (doc !== "worklog") period = null;
  const total = items.length;
  onProgress(0, total);
  const fonts = await loadFonts();
  const pdf = await PDFDocument.create();
  const embedded = await embedPdfFonts(pdf, fonts);

  const pending: Promise<Loaded>[] = [];
  const kick = (i: number) => {
    if (i < total && !pending[i]) {
      pending[i] = fetchData(items[i].id, doc, period);
      pending[i].catch(() => {}); // 처리되지 않은 거부 경고 방지 — 아래에서 await 한다
    }
  };
  for (let i = 0; i < PREFETCH; i++) kick(i);

  let ok = 0;
  const failed: BulkResult["failed"] = [];
  const skipped: string[] = [];
  for (let i = 0; i < total; i++) {
    kick(i + PREFETCH);
    const before = pdf.getPageCount();
    try {
      const got = await pending[i];
      if (got.kind === "worklog" && period && got.data.sessions.length === 0) {
        skipped.push(items[i].name);
      } else {
        if (got.kind === "worklog") await drawWorkLog(pdf, embedded, got.data);
        else
          await drawAttendance(pdf, embedded, got.data, {
            blank: doc === "attendance-blank",
          });
        ok++;
      }
    } catch (e) {
      // 그리다 실패했으면 그 건이 만든 쪽을 걷어 낸다(반쯤 그린 쪽이 남지 않게).
      while (pdf.getPageCount() > before) pdf.removePage(pdf.getPageCount() - 1);
      failed.push({
        name: items[i].name,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
    onProgress(i + 1, total);
  }

  return { bytes: ok > 0 ? await pdf.save() : null, ok, failed, skipped };
}

// 파일명 — 문서_차시_프로젝트_N건.pdf(근무일지 기간 지정 시 문서_기간_차시_프로젝트_N건.pdf).
//   N 은 실제로 들어간 건수. 윈도에서 못 쓰는 글자는 밑줄로.
//   다운로드는 a[download] 로 브라우저가 이름을 정하므로 한글이 그대로 남는다.
export function bulkPdfFilename(
  doc: BulkDoc,
  termName: string,
  projectName: string,
  count: number,
  period: WorkLogPeriod = null
): string {
  const parts = [
    BULK_DOC_LABEL[doc],
    doc === "worklog" && period ? periodLabel(period) : "",
    termName.trim(),
    projectName.trim(),
    `${count}건`,
  ].filter(Boolean);
  return `${parts.join("_")}.pdf`.replace(/[\\/:*?"<>|]/g, "_");
}
