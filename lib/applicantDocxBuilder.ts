// =====================================================================
// 입사지원서 docx 빌더 — 센터 기존 한글 지원서 양식을 재현 (순수 함수)
//   * DB·인증·Storage 의존 없음. 사진/서명 이미지는 호출 측에서 바이트로 받아옵니다.
//   * 1p 지원서(인적사항·학력·경력·자격·수상·교육) / 2p 자기소개서 / 3p 동의·서명.
//   * 맑은 고딕, A4 세로, 색 박스 섹션 헤더(흰 글씨·굵게).
//   * jsonb 배열이 비었거나 필드가 null 이면 해당 행/섹션을 안전하게 생략합니다.
// =====================================================================

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  TableLayoutType,
  VerticalAlign,
  BorderStyle,
  ShadingType,
  HeightRule,
  ImageRun,
  PageBreak,
  convertMillimetersToTwip,
} from "docx";
import { DOC_FONT, GRAY, para } from "./recruitmentDocx";
import { fmtKstDateTime } from "./datetime";
import type {
  EmployeeEducation,
  EmployeeLicense,
  EmployeeCareer,
  EmployeeAward,
  EmployeeTraining,
} from "./supabase";

// 섹션별 색상 — 기존 지원서 양식 그대로.
const PINK = "E89BA8"; // 인적사항
const BLUE = "3B6FB5"; // 학력 / 자기소개서 1
const GREEN = "4CAF50"; // 경력 / 자기소개서 2
const YELLOW = "E8C547"; // 자격 / 자기소개서 3
const LIGHT = "F2F2F2"; // 라벨 셀 배경
const STRIP_COLORS = ["E84040", BLUE, GREEN, YELLOW]; // 제목 위아래 4색 선

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

const THIN = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" } as const;
const BORDERS = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
  insideHorizontal: THIN,
  insideVertical: THIN,
};
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_BORDERS = {
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  insideHorizontal: NONE,
  insideVertical: NONE,
};

export type ApplicantDocInput = {
  applicant_number: string;
  name: string;
  name_hanja: string | null;
  birth_date: string;
  gender: "M" | "F" | null;
  address: string | null;
  email: string;
  phone: string;
  education: EmployeeEducation[];
  licenses: EmployeeLicense[];
  career: EmployeeCareer[];
  awards: EmployeeAward[];
  trainings: EmployeeTraining[];
  motivation: string | null;
  self_development: string | null;
  career_summary: string | null;
  philosophy: string | null;
  agreed_privacy: boolean;
  agreed_criminal_check: boolean;
  agreed_truth: boolean;
  consent_at: string | null;
  consent_signature_type: "drawn" | "typed" | null;
  // 타이핑 서명일 때의 이름 텍스트.
  consent_signature_text: string | null;
  // 미리 받아온 이미지 바이트(없으면 빈칸 처리). 손글씨 서명은 PNG.
  photoImage: Uint8Array | null;
  signatureImage: Uint8Array | null;
};

// ---------------------------------------------------------------------
// 저수준 헬퍼
// ---------------------------------------------------------------------

// 셀 본문 문단(기본 10pt).
function cp(
  text: string,
  opts: { bold?: boolean; align?: Align; color?: string; size?: number } = {}
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: 20, after: 20 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: (opts.size ?? 10) * 2,
        color: opts.color,
        font: DOC_FONT,
      }),
    ],
  });
}

// 색 박스 섹션 헤더(전체폭, 흰 글씨·굵게). "■ " 접두는 호출 측에서 포함.
function sectionHeader(text: string, fill: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: "auto", fill },
    spacing: { before: 240, after: 100 },
    children: [
      new TextRun({ text, bold: true, size: 24, color: "FFFFFF", font: DOC_FONT }),
    ],
  });
}

// 표 헤더 셀(섹션 색).
function headCell(text: string, fill: string, widthPct?: number): TableCell {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, color: "auto", fill },
    verticalAlign: VerticalAlign.CENTER,
    borders: BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text, bold: true, size: 20, color: "FFFFFF", font: DOC_FONT }),
        ],
      }),
    ],
  });
}

// 라벨 셀(연회색 배경, 굵게 가운데).
function labelCell(text: string, widthPct?: number): TableCell {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: LIGHT },
    verticalAlign: VerticalAlign.CENTER,
    borders: BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [cp(text, { bold: true, align: AlignmentType.CENTER })],
  });
}

// 본문 값 셀 — string 또는 Paragraph[] / 자식(ImageRun 포함 문단) 허용.
function valueCell(
  content: string | Paragraph[],
  opts: {
    align?: Align;
    widthPct?: number;
    columnSpan?: number;
    rowSpan?: number;
  } = {}
): TableCell {
  const paras = Array.isArray(content)
    ? content
    : [cp(content, { align: opts.align })];
  return new TableCell({
    width: opts.widthPct
      ? { size: opts.widthPct, type: WidthType.PERCENTAGE }
      : undefined,
    columnSpan: opts.columnSpan,
    rowSpan: opts.rowSpan,
    verticalAlign: VerticalAlign.CENTER,
    borders: BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: paras,
  });
}

function fixedTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows,
  });
}

// 제목 위아래 4색 선.
function colorStrip(): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        height: { value: 90, rule: HeightRule.ATLEAST },
        children: STRIP_COLORS.map(
          (c) =>
            new TableCell({
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: "auto", fill: c },
              borders: NO_BORDERS,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [
                new Paragraph({ children: [new TextRun({ text: "", size: 2 })] }),
              ],
            })
        ),
      }),
    ],
  });
}

// 큰 제목(자간 강조, 가운데).
function bigTitle(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
    children: [
      new TextRun({ text, bold: true, size: 40, color: "1A1A1A", font: DOC_FONT }),
    ],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

// 두 날짜를 "a ~ b" 로. 둘 다 비면 "".
function range(a: string, b: string): string {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x && !y) return "";
  return `${x} ~ ${y}`;
}

// PNG/JPEG/GIF/BMP 시그니처 판별. 그 외(webp 등)는 null → 삽입 생략.
function detectImageType(
  bytes: Uint8Array | null
): "png" | "jpg" | "gif" | "bmp" | null {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return null;
}

// 이미지 문단 — 지원되는 형식이 아니면 null.
function imageParagraph(
  bytes: Uint8Array | null,
  width: number,
  height: number,
  align?: Align
): Paragraph | null {
  const type = detectImageType(bytes);
  if (!type || !bytes) return null;
  return new Paragraph({
    alignment: align,
    children: [
      new ImageRun({ type, data: bytes, transformation: { width, height } }),
    ],
  });
}

// 줄바꿈 보존 본문 문단들(자기소개서). 비면 안내 문구.
function bodyParagraphs(text: string | null): Paragraph[] {
  const t = (text ?? "").replace(/\r\n/g, "\n");
  if (!t.trim()) {
    return [para("— 작성하지 않음 —", { size: 10, color: GRAY })];
  }
  return t.split("\n").map((line) =>
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: line, size: 21, font: DOC_FONT })],
    })
  );
}

// ---------------------------------------------------------------------
// 표 섹션 — 헤더 + 행 반복. rows 비면 "해당 사항 없음" 1행.
// ---------------------------------------------------------------------
function listTable(
  fill: string,
  columns: { label: string; width: number }[],
  rows: string[][]
): Table {
  const header = new TableRow({
    tableHeader: true,
    children: columns.map((c) => headCell(c.label, fill, c.width)),
  });
  const body =
    rows.length > 0
      ? rows.map(
          (r) =>
            new TableRow({
              children: r.map((text, i) =>
                valueCell(text, {
                  widthPct: columns[i].width,
                  align:
                    i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
                })
              ),
            })
        )
      : [
          new TableRow({
            children: [
              valueCell("해당 사항 없음", {
                columnSpan: columns.length,
                align: AlignmentType.CENTER,
              }),
            ],
          }),
        ];
  return fixedTable([header, ...body]);
}

// ---------------------------------------------------------------------
// 인적사항 표 — 왼쪽 증명사진(rowSpan) + 우측 라벨/값 그리드.
// ---------------------------------------------------------------------
function personalSection(input: ApplicantDocInput): Table {
  const nameText = input.name_hanja?.trim()
    ? `${input.name} (${input.name_hanja.trim()})`
    : input.name;
  const genderText =
    input.gender === "M" ? "남성" : input.gender === "F" ? "여성" : "";

  // 증명사진 셀(rowSpan=4). 이미지 없으면 빈 칸.
  const photoPara =
    imageParagraph(input.photoImage, 96, 128, AlignmentType.CENTER) ??
    cp("", { align: AlignmentType.CENTER });
  const photoCell = new TableCell({
    width: { size: 18, type: WidthType.PERCENTAGE },
    rowSpan: 4,
    verticalAlign: VerticalAlign.CENTER,
    borders: BORDERS,
    margins: { top: 60, bottom: 60, left: 40, right: 40 },
    children: [photoPara],
  });

  const rows = [
    new TableRow({
      children: [
        photoCell,
        labelCell("성 명", 14),
        valueCell(nameText, { widthPct: 34, align: AlignmentType.LEFT }),
        labelCell("생년월일", 14),
        valueCell(input.birth_date || "", { widthPct: 20 }),
      ],
    }),
    new TableRow({
      children: [
        labelCell("성 별", 14),
        valueCell(genderText, { widthPct: 34 }),
        labelCell("전화번호", 14),
        valueCell(input.phone || "", { widthPct: 20 }),
      ],
    }),
    new TableRow({
      children: [
        labelCell("E-Mail", 14),
        valueCell(input.email || "", {
          columnSpan: 3,
          align: AlignmentType.LEFT,
        }),
      ],
    }),
    new TableRow({
      children: [
        labelCell("현주소", 14),
        valueCell(input.address || "", {
          columnSpan: 3,
          align: AlignmentType.LEFT,
        }),
      ],
    }),
  ];
  return fixedTable(rows);
}

// ---------------------------------------------------------------------
// 동의·서명 (3페이지)
// ---------------------------------------------------------------------
function consentSection(input: ApplicantDocInput): (Paragraph | Table)[] {
  const yn = (v: boolean) => (v ? "동의함" : "미동의");
  const consentTable = fixedTable([
    new TableRow({
      tableHeader: true,
      children: [
        headCell("동의 항목", BLUE, 60),
        headCell("동의 여부", BLUE, 40),
      ],
    }),
    new TableRow({
      children: [
        valueCell("개인정보 수집·이용 동의", { widthPct: 60, align: AlignmentType.LEFT }),
        valueCell(yn(input.agreed_privacy), { widthPct: 40 }),
      ],
    }),
    new TableRow({
      children: [
        valueCell("민감정보 처리 동의", { widthPct: 60, align: AlignmentType.LEFT }),
        valueCell(yn(input.agreed_criminal_check), { widthPct: 40 }),
      ],
    }),
    new TableRow({
      children: [
        valueCell("기재사항 사실 확인", { widthPct: 60, align: AlignmentType.LEFT }),
        valueCell(yn(input.agreed_truth), { widthPct: 40 }),
      ],
    }),
  ]);

  const consentAt = input.consent_at
    ? fmtKstDateTime(input.consent_at)
    : "-";

  // 서명 자식 — 손글씨 이미지 우선, 없으면 타이핑 이름을 서명체로.
  const signatureChildren: (TextRun | ImageRun)[] = [
    new TextRun({ text: "성  명 : ", bold: true, size: 22, font: DOC_FONT }),
    new TextRun({ text: input.name || "", size: 22, font: DOC_FONT }),
    new TextRun({ text: "          (서명) ", size: 20, color: GRAY, font: DOC_FONT }),
  ];
  const drawn = detectImageType(input.signatureImage);
  if (drawn && input.signatureImage) {
    signatureChildren.push(
      new ImageRun({
        type: drawn,
        data: input.signatureImage,
        transformation: { width: 150, height: 56 },
      })
    );
  } else if (
    input.consent_signature_type === "typed" &&
    input.consent_signature_text?.trim()
  ) {
    signatureChildren.push(
      new TextRun({
        text: input.consent_signature_text.trim(),
        italics: true,
        bold: true,
        size: 28,
        font: DOC_FONT,
      })
    );
  }

  return [
    sectionHeader("■ 개인정보 수집·이용 동의", BLUE),
    consentTable,
    para(`동의일시 : ${consentAt}`, {
      size: 10,
      color: GRAY,
      spacing: { before: 100, after: 280 },
    }),
    para(
      "위 본인은 위와 같이 지원서를 제출하며 기재사항이 사실임을 확인합니다.",
      { size: 11, spacing: { after: 240 } }
    ),
    para(
      input.consent_at ? kstDateLine(input.consent_at) : "",
      { size: 11, align: AlignmentType.RIGHT, spacing: { after: 120 } }
    ),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: signatureChildren,
    }),
  ];
}

// 'YYYY년 M월 D일'(KST) — consent_at 기준.
function kstDateLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return fmt.format(d);
}

// ---------------------------------------------------------------------
// 메인 빌더
// ---------------------------------------------------------------------
export async function buildApplicantDoc(
  input: ApplicantDocInput
): Promise<Buffer> {
  // --- 학력 / 경력 / 자격 행 ---
  const eduRows = input.education
    .filter((e) => (e.school ?? "").trim().length > 0)
    .map((e) => [
      e.school,
      range(e.enter_date, e.graduate_date),
      e.degree ?? "",
      e.major ?? "",
      e.note ?? "",
    ]);
  const careerRows = input.career
    .filter((c) => (c.company ?? "").trim().length > 0)
    .map((c) => [
      c.company,
      range(c.start_date, c.current ? "현재" : c.end_date),
      c.department ?? "",
      c.duties ?? "",
    ]);
  const licenseRows = input.licenses
    .filter((l) => (l.name ?? "").trim().length > 0)
    .map((l) => [
      l.name,
      l.acquired_date ?? "",
      l.registration_number ?? "",
      l.issuer ?? "",
    ]);
  const awardRows = input.awards
    .filter((w) => (w.name ?? "").trim().length > 0)
    .map((w) => [w.name, w.date ?? "", w.issuer ?? "", w.reason ?? ""]);
  const trainingRows = input.trainings
    .filter((t) => (t.name ?? "").trim().length > 0)
    .map((t) => [
      t.name,
      t.institution ?? "",
      range(t.start_date, t.end_date),
      t.hours ?? "",
    ]);

  const children: (Paragraph | Table)[] = [
    // ===== 1페이지: 지원서 =====
    colorStrip(),
    bigTitle("지 원 서"),
    colorStrip(),

    sectionHeader("■ 인적사항", PINK),
    personalSection(input),

    sectionHeader("■ 학력사항", BLUE),
    listTable(
      BLUE,
      [
        { label: "학교명", width: 28 },
        { label: "재학기간", width: 24 },
        { label: "졸업여부", width: 14 },
        { label: "전공", width: 20 },
        { label: "소재지", width: 14 },
      ],
      eduRows
    ),

    sectionHeader("■ 경력사항", GREEN),
    listTable(
      GREEN,
      [
        { label: "회사명", width: 26 },
        { label: "근무기간", width: 24 },
        { label: "부서명·직급", width: 22 },
        { label: "활동내용", width: 28 },
      ],
      careerRows
    ),

    sectionHeader("■ 자격사항", YELLOW),
    listTable(
      YELLOW,
      [
        { label: "자격명", width: 30 },
        { label: "취득일", width: 22 },
        { label: "등록번호", width: 26 },
        { label: "발행처", width: 22 },
      ],
      licenseRows
    ),
  ];

  // 수상 / 교육이수 — 값 있을 때만.
  if (awardRows.length > 0) {
    children.push(
      sectionHeader("■ 수상경력", PINK),
      listTable(
        PINK,
        [
          { label: "수상명", width: 30 },
          { label: "수상일", width: 20 },
          { label: "수여기관", width: 28 },
          { label: "사유", width: 22 },
        ],
        awardRows
      )
    );
  }
  if (trainingRows.length > 0) {
    children.push(
      sectionHeader("■ 교육이수", GREEN),
      listTable(
        GREEN,
        [
          { label: "교육명", width: 32 },
          { label: "교육기관", width: 28 },
          { label: "교육기간", width: 26 },
          { label: "시간", width: 14 },
        ],
        trainingRows
      )
    );
  }

  // ===== 2페이지: 자기소개서 =====
  children.push(
    pageBreak(),
    colorStrip(),
    bigTitle("자 기 소 개 서"),
    colorStrip(),

    sectionHeader("1. 수련관 지원동기 및 입사 후 포부", BLUE),
    ...bodyParagraphs(input.motivation),

    sectionHeader("2. 해당 분야 자기개발 계획", GREEN),
    ...bodyParagraphs(input.self_development),

    sectionHeader(
      "3. 직무 관련 경력 및 경험에 대한 소속에서의 역할과 활동 결과",
      YELLOW
    ),
    ...bodyParagraphs(input.career_summary)
  );
  if ((input.philosophy ?? "").trim().length > 0) {
    children.push(
      sectionHeader("4. 청소년관과 직업관·삶의 철학", PINK),
      ...bodyParagraphs(input.philosophy)
    );
  }

  // ===== 3페이지: 개인정보 수집·이용 동의 =====
  children.push(pageBreak(), ...consentSection(input));

  const doc = new Document({
    creator: "동래구청소년센터 채용시스템",
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297),
            },
            margin: {
              top: convertMillimetersToTwip(18),
              bottom: convertMillimetersToTwip(18),
              left: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(20),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
