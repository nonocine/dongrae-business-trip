// =====================================================================
// 채용 문서(docx) 공통 헬퍼 — 최종 총괄표 / 서류 총괄표 / 면접 대상자 공고
//   * 한글 공문 톤: 맑은 고딕, 네이비 헤더, 가는 테두리.
//   * 한자는 쓰지 않습니다(UI 규칙과 동일).
// =====================================================================

import {
  Paragraph,
  TextRun,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  type ISpacingProperties,
} from "docx";

export const DOC_FONT = "맑은 고딕";
export const NAVY = "1F3A5F";
export const GRAY = "666666";

const THIN = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" } as const;
export const CELL_BORDERS = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
};

// 문단 — 굵기/크기/정렬/색상 옵션.
export function para(
  text: string,
  opts: {
    bold?: boolean;
    size?: number; // pt
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    color?: string;
    spacing?: ISpacingProperties;
  } = {}
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: opts.spacing,
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: (opts.size ?? 11) * 2, // half-points
        color: opts.color,
        font: DOC_FONT,
      }),
    ],
  });
}

// 제목 문단 (가운데, 큰 글씨, 자간 강조).
export function titlePara(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 36, // 18pt
        font: DOC_FONT,
        color: NAVY,
      }),
    ],
  });
}

// 표 헤더 셀 — 네이비 배경 + 흰 글씨.
export function headCell(text: string, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: { fill: NAVY, color: "auto" },
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            bold: true,
            size: 20, // 10pt
            color: "FFFFFF",
            font: DOC_FONT,
          }),
        ],
      }),
    ],
  });
}

// 본문 데이터 셀.
export function dataCell(
  text: string,
  opts: {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    bold?: boolean;
    width?: number;
  } = {}
): TableCell {
  return new TableCell({
    width: opts.width
      ? { size: opts.width, type: WidthType.PERCENTAGE }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            bold: opts.bold,
            size: 20, // 10pt
            font: DOC_FONT,
          }),
        ],
      }),
    ],
  });
}

// 이름 마스킹 — 가운데 글자를 ○ 로. 김민호→김○호, 이수→이○, 남궁민수→남○○수.
export function maskName(name: string): string {
  const n = (name ?? "").trim();
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + "○";
  return n[0] + "○".repeat(n.length - 2) + n[n.length - 1];
}

// KST 기준 'YYYY년 M월 D일' 문자열.
export function kstDateLabel(d: Date): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return fmt.format(d);
}

// 다운로드 Response — docx Buffer + 첨부 헤더.
export function docxResponse(buffer: Buffer | ArrayBuffer, filename: string): Response {
  return new Response(buffer as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
