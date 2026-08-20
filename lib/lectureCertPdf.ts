// =====================================================================
// 강의확인증 PDF 생성 (2부-b) — 증명서(certificatePdf) 패턴 재사용.
//   * pdf-lib + fontkit + 나눔고딕 통임베드(subset:false — Vercel 글리프 누락 대응).
//   * 실물 양식 재현(이민정 제공 양식): 발급번호 / 큰 제목(자간 넓게) /
//     인적사항(성명·주민등록번호·주소) · 강사이력(강의내용·강의일자) · 용도 표 /
//     확인문구 / 발급일자 / "관장 : 허일수"+개인도장 · 연락처 /
//     "동래구청소년센터장"+기관 직인(글자 끝에 겹치게).
//   * 도장 2개는 storage(hr-documents, 비공개)에서 service_role 로 읽는다.
//     둘 다 없어도 throw 하지 않는다 — 자리만 비우고 발급한다.
//   * ⚠️ 주민등록번호는 저장하지 않는다. saem_lecture_certificates 에 컬럼 자체가
//     없고, 이 모듈도 인자로만 받아 페이지에 그린 뒤 버린다.
//     로그·DB·파일명·URL 어디에도 남기지 않는다(console 출력 금지).
//   * 강의내용·강의일자·주소는 강사가 직접 쓴 자유 텍스트다 —
//     lib/pdfFont 의 fitToFont 로 글리프 없는 글자를 대체하고 셀 폭에 맞춰 접는다.
// =====================================================================

import { PDFDocument, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { downloadHrImage, safeFileBase } from "@/lib/recruitmentApplicantDocData";
import { CERT_ORG, CERT_SEAL_PATH } from "@/lib/certificates";
import { regularFont, boldFont, fkFont, fitToFont, spaced } from "@/lib/pdfFont";
import { CERT_NO_UNISSUED, certNoLabel } from "@/lib/saem";

// 발급대장 행에서 PDF 에 필요한 값만. (주민번호는 여기에 없다 — 인자로 받는다)
export type LectureCertData = {
  certYear: number | null;
  certNo: number | null;
  applicantName: string;
  address: string;
  lectureContent: string;
  lecturePeriod: string;
};

export type LectureCertStamps = {
  directorStamp: Uint8Array | null; // 관장 개인 도장(employee_profiles.stamp_path)
  orgSeal: Uint8Array | null; // 기관 직인(org/center_seal.png)
};

const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.1, 0.1, 0.1);

// 용도는 양식상 고정값이다(신청서에 받는 항목이 아니다).
const PURPOSE = "제출용";

// --- 지면 상수(실물 양식 비율 그대로 A4 로 환산) -----------------------
const W = 595.28;
const H = 841.89;
const M = 76;
const CONTENT_W = W - 2 * M;
// 표 5열: 섹션명 | 항목라벨 | 값 | 주민등록번호 라벨 | 주민등록번호 값
const COL = { section: 69, label: 88, value: 92, rrnLabel: 79 };
const COL_RRN_VALUE = CONTENT_W - COL.section - COL.label - COL.value - COL.rrnLabel;

// --- 표기 헬퍼 --------------------------------------------------------

// "2026-06-17" → "2026년  6월  17일" (실물 양식의 자간). 파싱 실패 시 원문.
export function formatLectureCertIssueDate(ymd: string): string {
  const m = (ymd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd ?? "";
  return `${Number(m[1])}년  ${Number(m[2])}월  ${Number(m[3])}일`;
}

// 주민등록번호 표기 — 13자리면 "######-#######", 그 외는 입력 그대로(공백이면 공란).
//   ⚠️ 이 값은 어디에도 기록하지 않는다. 반환값은 그리는 데만 쓴다.
function formatResidentNumber(v: string | null | undefined): string {
  const raw = (v ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return raw;
}

// 기관 상수가 단일 출처 — "관장 허일수" → { title: "관장", name: "허일수" }.
function director(): { title: string; name: string } {
  const parts = CERT_ORG.representative.trim().split(/\s+/);
  if (parts.length < 2) return { title: "관장", name: CERT_ORG.representative.trim() };
  return { title: parts[0], name: parts.slice(1).join(" ") };
}

export function lectureCertPdfFilename(cert: LectureCertData): string {
  // 승인 전(미리보기)에는 발급번호가 없다 — 파일명은 "미발급" 으로 구분한다.
  const label = certNoLabel(cert.certYear, cert.certNo) || CERT_NO_UNISSUED;
  const name = safeFileBase(cert.applicantName ?? "", "강사");
  return `강의확인증_${name}_${label}.pdf`;
}

// --- 도장 로드(둘 다 실패해도 발급은 계속) ----------------------------

// 관장 개인 도장 — 이름 → drivers.id → employee_profiles.stamp_path → Storage.
//   출석부(attendancePdf) 가 담당자 도장을 찾는 경로와 같다.
async function loadDirectorStamp(name: string): Promise<Uint8Array | null> {
  try {
    if (!name) return null;
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    const driverId = (drv as { id?: string } | null)?.id;
    if (!driverId) return null;
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("stamp_path")
      .eq("driver_id", String(driverId))
      .maybeSingle();
    const path = (prof as { stamp_path?: string | null } | null)?.stamp_path ?? null;
    return await downloadHrImage(path);
  } catch {
    return null; // 도장이 없어도 발급은 계속한다.
  }
}

export async function loadLectureCertStamps(): Promise<LectureCertStamps> {
  const [directorStamp, orgSeal] = await Promise.all([
    loadDirectorStamp(director().name),
    downloadHrImage(CERT_SEAL_PATH),
  ]);
  return { directorStamp, orgSeal };
}

// 발급대장 행 → PDF 입력. 없으면 null.
//   ⚠️ select 에 주민번호는 없다(컬럼 자체가 없음). printed_at 도 여기서 건드리지 않는다.
export async function loadLectureCertData(
  id: string
): Promise<LectureCertData | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("saem_lecture_certificates")
    .select("cert_year, cert_no, applicant_name, address, lecture_content, lecture_period")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const s = (v: unknown) => (v == null ? "" : String(v));
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    certYear: n(r.cert_year),
    certNo: n(r.cert_no),
    applicantName: s(r.applicant_name),
    address: s(r.address),
    lectureContent: s(r.lecture_content),
    lecturePeriod: s(r.lecture_period),
  };
}

// png/jpg 모두 시도(형식 자동 판별). webp 는 pdf-lib 가 못 읽는다 → null.
async function embedStamp(
  pdf: PDFDocument,
  bytes: Uint8Array | null
): Promise<PDFImage | null> {
  if (!bytes || bytes.length === 0) return null;
  try {
    return await pdf.embedPng(bytes);
  } catch {
    try {
      return await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

// --- 본체 ------------------------------------------------------------

// 강의확인증 PDF. residentNumber 는 출력 시점에 입력받은 값(저장 금지),
//   비우면 주민등록번호 칸이 공란으로 나간다(담당자 미리보기).
//   issueDate 는 KST "YYYY-MM-DD".
export async function generateLectureCertPdf(
  cert: LectureCertData,
  residentNumber: string | null,
  issueDate: string
): Promise<Uint8Array> {
  const stamps = await loadLectureCertStamps();
  return buildLectureCertPdf(cert, residentNumber, issueDate, stamps);
}

// 순수 생성부 — 외부 I/O 없음(도장 바이트는 인자로 받는다).
export async function buildLectureCertPdf(
  cert: LectureCertData,
  residentNumber: string | null,
  issueDate: string,
  stamps: LectureCertStamps
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regularFont(), { subset: false });
  const bold = await pdf.embedFont(boldFont(), { subset: false });
  const page = pdf.addPage([W, H]);

  // 나눔고딕에 없는 글자는 여기서 한 번에 대체한다(폭 계산 전이라 접기와 어긋나지 않음).
  const fk = fkFont(false);
  const fit = (s: string) => fitToFont(String(s ?? ""), fk);
  const applicantName = fit(cert.applicantName ?? "");
  const address = fit(cert.address ?? "");
  const lectureContent = fit(cert.lectureContent ?? "");
  const lecturePeriod = fit(cert.lecturePeriod ?? "");
  const rrn = fit(formatResidentNumber(residentNumber));

  // top-origin 헬퍼(certificatePdf 와 동일).
  const text = (
    x: number,
    yTop: number,
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      align?: "left" | "right" | "center";
    } = {}
  ) => {
    const size = opts.size ?? 10.5;
    const f: PDFFont = opts.bold ? bold : font;
    const tw = f.widthOfTextAtSize(s, size);
    let dx = x;
    if (opts.align === "right") dx = x - tw;
    else if (opts.align === "center") dx = x - tw / 2;
    page.drawText(s, { x: dx, y: H - yTop - size, size, font: f, color: INK });
  };
  const rect = (x: number, yTop: number, w: number, h: number) => {
    page.drawRectangle({
      x,
      y: H - yTop - h,
      width: w,
      height: h,
      borderColor: LINE,
      borderWidth: 0.9,
    });
  };

  // 셀 폭에 맞춰 줄바꿈 — 줄바꿈 문자를 먼저 살리고, 넘치면 글자 단위로 접는다.
  //   한글은 단어 사이 공백이 없을 수 있어 글자 단위가 안전하다.
  const wrap = (s: string, size: number, maxW: number): string[] => {
    const out: string[] = [];
    for (const raw of s.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let cur = "";
      for (const ch of line) {
        const next = cur + ch;
        if (font.widthOfTextAtSize(next, size) > maxW && cur) {
          out.push(cur);
          cur = ch;
        } else {
          cur = next;
        }
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [""];
  };

  // 여러 줄을 셀 안에서 가로·세로 중앙 정렬.
  const cellLines = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    lines: string[],
    opts: { size?: number; bold?: boolean } = {}
  ) => {
    const size = opts.size ?? 10.5;
    const gap = size * 1.55;
    const blockH = (lines.length - 1) * gap + size;
    const start = yTop + (h - blockH) / 2;
    lines.forEach((ln, i) => {
      text(x + w / 2, start + i * gap, ln, { size, bold: opts.bold, align: "center" });
    });
  };
  const cellCenter = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    s: string,
    opts: { size?: number; bold?: boolean } = {}
  ) => cellLines(x, yTop, w, h, [s], opts);

  // ---- 발급번호(좌상단) ----
  //   번호는 승인 시 부여된다 — 승인 전 미리보기는 이 칸이 공란으로 나간다
  //   (certNoLabel 이 "" 를 준다). 실제 발급되는 양식에는 항상 번호가 있다.
  text(M, 85, `발급번호  ${certNoLabel(cert.certYear, cert.certNo)}`.trimEnd(), {
    size: 11,
  });

  // ---- 제목 ----
  text(W / 2, 108, spaced("강의확인증"), { size: 24, bold: true, align: "center" });

  // ---- 표 ----
  const xSection = M;
  const xLabel = xSection + COL.section;
  const xValue = xLabel + COL.label;
  const xRrnLabel = xValue + COL.value;
  const xRrnValue = xRrnLabel + COL.rrnLabel;
  const mergedValueW = CONTENT_W - COL.section - COL.label; // 값이 우측 3열을 병합

  const BODY = 10.5;
  const PAD = 12; // 값 셀 좌우 여백

  // 값 줄 접기 → 행 높이(최소 높이 이상, 줄 수에 따라 늘어남).
  const addrLines = wrap(address || "-", BODY, mergedValueW - PAD * 2);
  const contentLines = wrap(lectureContent || "-", BODY, mergedValueW - PAD * 2);
  const periodLines = wrap(lecturePeriod || "-", BODY, mergedValueW - PAD * 2);
  const rowH = (lines: string[], min: number) =>
    Math.max(min, lines.length * BODY * 1.55 + 22);

  const hName = 49;
  const hAddr = rowH(addrLines, 38);
  const hContent = rowH(contentLines, 58);
  const hPeriod = rowH(periodLines, 74);
  const hPurpose = 62;

  let y = 162;

  // 인적사항 — 성명 / 주민등록번호 행 + 주소 행(좌측 섹션 셀 세로 병합).
  const personalTop = y;
  rect(xLabel, y, COL.label, hName);
  cellCenter(xLabel, y, COL.label, hName, spaced("성명"));
  rect(xValue, y, COL.value, hName);
  cellCenter(xValue, y, COL.value, hName, applicantName || "-");
  rect(xRrnLabel, y, COL.rrnLabel, hName);
  // 양식대로 두 줄("주민등록" / "번호").
  cellLines(xRrnLabel, y, COL.rrnLabel, hName, ["주민등록", "번호"]);
  rect(xRrnValue, y, COL_RRN_VALUE, hName);
  cellCenter(xRrnValue, y, COL_RRN_VALUE, hName, rrn); // 비면 공란
  y += hName;

  rect(xLabel, y, COL.label, hAddr);
  cellCenter(xLabel, y, COL.label, hAddr, spaced("주소"));
  rect(xValue, y, mergedValueW, hAddr);
  cellLines(xValue, y, mergedValueW, hAddr, addrLines);
  y += hAddr;

  rect(xSection, personalTop, COL.section, hName + hAddr);
  cellCenter(xSection, personalTop, COL.section, hName + hAddr, "인적사항");

  // 강사이력 — 강의내용 / 강의일자(좌측 섹션 셀 세로 병합).
  const careerTop = y;
  rect(xLabel, y, COL.label, hContent);
  cellCenter(xLabel, y, COL.label, hContent, "강의내용");
  rect(xValue, y, mergedValueW, hContent);
  cellLines(xValue, y, mergedValueW, hContent, contentLines);
  y += hContent;

  rect(xLabel, y, COL.label, hPeriod);
  cellCenter(xLabel, y, COL.label, hPeriod, "강의일자");
  rect(xValue, y, mergedValueW, hPeriod);
  cellLines(xValue, y, mergedValueW, hPeriod, periodLines);
  y += hPeriod;

  rect(xSection, careerTop, COL.section, hContent + hPeriod);
  cellCenter(xSection, careerTop, COL.section, hContent + hPeriod, "강사이력");

  // 용도 — 표 전체 폭 1행, 좌측 정렬(양식 고정값).
  rect(M, y, CONTENT_W, hPurpose);
  text(M + 16, y + (hPurpose - BODY) / 2, `${spaced("용도")} :  ${PURPOSE}`, {
    size: BODY,
  });
  y += hPurpose;

  // ---- 확인문구 · 발급일자 ----
  y += 34;
  text(W / 2, y, "위와 같이 상기인의 강의 사실을 확인합니다.", {
    size: 12.5,
    align: "center",
  });
  y += 34;
  text(W / 2, y, formatLectureCertIssueDate(issueDate), {
    size: 12.5,
    align: "center",
  });

  // ---- 관장 + 개인 도장 / 연락처 ----
  const { title, name } = director();
  const dirStampSize = 20;
  const rightX = M + CONTENT_W;
  // 개인 도장은 이름을 덮지 않고 바로 오른쪽 옆에 찍힌다(실물 양식).
  //   도장이 있든 없든 글자 위치가 같도록 도장 자리를 미리 비워 두고 우측 정렬한다.
  const dirTextRight = rightX - dirStampSize - 5;
  const dirSize = 11.5;
  y += 50;
  const dirLine = `${title} :  ${fit(name)}`;
  text(dirTextRight, y, dirLine, { size: dirSize, align: "right" });

  const dirImg = await embedStamp(pdf, stamps.directorStamp);
  if (dirImg) {
    const stampX = rightX - dirStampSize;
    const stampTop = y + dirSize / 2 - dirStampSize / 2;
    page.drawImage(dirImg, {
      x: stampX,
      y: H - stampTop - dirStampSize,
      width: dirStampSize,
      height: dirStampSize,
      opacity: 0.92,
    });
  }

  y += 20;
  text(rightX, y, `연락처 :  ${CERT_ORG.phone}`, { size: dirSize, align: "right" });

  // ---- 기관명(센터장) + 기관 직인 ----
  y += 44;
  const certifier = CERT_ORG.certifierTitle;
  const certSize = 15;
  const certW = bold.widthOfTextAtSize(certifier, certSize);
  const sealSize = 74;
  const sealOverlap = sealSize * 0.4;
  // 글자+직인 덩어리를 통째로 가운데 맞춘다(실물 양식의 배치).
  const groupW = certW + sealSize - sealOverlap;
  const certX = W / 2 - groupW / 2;
  text(certX, y, certifier, { size: certSize, bold: true });

  const sealImg = await embedStamp(pdf, stamps.orgSeal);
  if (sealImg) {
    const sealX = certX + certW - sealOverlap;
    const sealTop = y + certSize / 2 - sealSize / 2;
    page.drawImage(sealImg, {
      x: sealX,
      y: H - sealTop - sealSize,
      width: sealSize,
      height: sealSize,
      opacity: 0.92,
    });
  }

  return pdf.save();
}
