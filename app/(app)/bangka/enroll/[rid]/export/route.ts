import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { T_APPS, T_RECRUIT, logStaffAccess, metaFromHeaders } from "@/lib/bangkaEnrollServer";
import {
  APP_STATUS_LABEL,
  GUARDIAN_RELATION_LABEL,
  normalizeData,
  normalizeSensitive,
  parseStops,
  priorityLabel,
  returnMethodLabel,
  type AppStatus,
} from "@/lib/bangkaEnroll";
import { BK_ALLERGENS } from "@/lib/bangkaMenuParse";
import { bkClassLabel, formatBkPhone } from "@/lib/bangka";
import { allergySymptomsText } from "@/app/(app)/bangka/enroll/badges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 신규 접수 엑셀 — GET /bangka/enroll/{rid}/export[?sensitive=1]
//   제출 이후 상태(작성중 제외)만. 성평등가족부 보고용 기본 칸 +
//   '민감정보 포함'일 때만 알레르기 칸(기본은 뺌). 내보낼 때마다 기록(export).
export async function GET(request: Request, ctx: { params: Promise<{ rid: string }> }) {
  const me = await resolveBangkaAccess();
  if (!me) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const { rid } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(rid)) return new Response("잘못된 요청입니다.", { status: 400 });
  const withSensitive = new URL(request.url).searchParams.get("sensitive") === "1";

  const { data: rec, error: re } = await supabaseAdmin
    .from(T_RECRUIT)
    .select("id, title, shuttle_stops")
    .eq("id", rid)
    .maybeSingle();
  if (re) return new Response(re.message, { status: 500 });
  if (!rec) return new Response("회차를 찾을 수 없습니다.", { status: 404 });
  const r = rec as { id: string; title: string; shuttle_stops: unknown };
  const stops = parseStops(r.shuttle_stops);

  const cols = `id, app_no, status, guardian_phone, data, submitted_at, student_id${withSensitive ? ", sensitive" : ""}`;
  const { data, error } = await supabaseAdmin
    .from(T_APPS)
    .select(cols)
    .eq("recruitment_id", rid)
    .neq("status", "draft")
    .order("app_no", { ascending: true, nullsFirst: false });
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data ?? []) as unknown as {
    id: string;
    app_no: string | null;
    status: AppStatus;
    guardian_phone: string;
    data: unknown;
    submitted_at: string | null;
    student_id: string | null;
    sensitive?: unknown;
  }[];

  // 방과후 반 — 합격 처리로 연결된 학생(bk_applications.student_id)의 반.
  const studentIds = [...new Set(rows.map((a) => a.student_id).filter((v): v is string => !!v))];
  const classByStudent = new Map<string, string>();
  for (let i = 0; i < studentIds.length; i += 200) {
    const { data: st, error: se } = await supabaseAdmin
      .from("bk_students")
      .select("id, class_code")
      .in("id", studentIds.slice(i, i + 200));
    if (se) return new Response(se.message, { status: 500 });
    for (const x of (st ?? []) as { id: string; class_code: string | null }[])
      if (x.class_code) classByStudent.set(x.id, bkClassLabel(x.class_code));
  }

  const kstDate = (iso: string | null) =>
    iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "";
  const yn = (v: boolean | null | undefined) => (v == null ? "" : v ? "예" : "아니오");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("신규 접수", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const head = [
    "접수번호",
    "이름",
    "성별",
    "생년월일",
    "학교",
    "학년",
    "반",
    "방과후 반",
    "주소",
    "보호자명",
    "관계",
    "보호자 연락처",
    "우선지원 유형",
    "귀가방법",
    "하차장소",
    "상태",
    "제출일",
  ];
  const widths = [11, 10, 6, 12, 16, 7, 6, 9, 40, 10, 12, 15, 30, 12, 24, 9, 17];
  if (withSensitive) {
    head.push("식품 알레르기", "원인 식품", "증상", "병원 진료", "스스로 구분");
    widths.push(10, 30, 30, 9, 10);
  }
  ws.addRow(head);
  for (const a of rows) {
    const d = normalizeData(a.data);
    const stop =
      d.ret.method === "shuttle" && d.ret.stop_seq != null ? stops.find((s) => s.seq === d.ret.stop_seq) : null;
    const line: string[] = [
      a.app_no ?? "",
      d.youth.name,
      d.youth.gender === "M" ? "남" : d.youth.gender === "F" ? "여" : "",
      d.youth.birth,
      d.youth.school,
      d.youth.grade,
      String(d.youth.class_no ?? "").replace(/반\s*$/, ""),
      a.student_id ? classByStudent.get(a.student_id) ?? "" : "",
      [d.youth.zip && `(${d.youth.zip})`, d.youth.addr1, d.youth.addr2].filter(Boolean).join(" "),
      d.guardian.name,
      GUARDIAN_RELATION_LABEL[d.guardian.relation] ?? "",
      formatBkPhone(a.guardian_phone),
      d.priority.map(priorityLabel).join(", "),
      returnMethodLabel(d.ret.method) + (d.ret.method === "other" && d.ret.other ? `(${d.ret.other})` : ""),
      stop ? `${stop.time ? `${stop.time} ` : ""}${stop.place}` : "",
      APP_STATUS_LABEL[a.status] ?? a.status,
      kstDate(a.submitted_at),
    ];
    if (withSensitive) {
      const al = a.sensitive != null ? normalizeSensitive(a.sensitive).allergy : null;
      line.push(
        al ? yn(al.has) : "(삭제됨)",
        al?.has ? [...al.foods.map((n) => `${n}.${BK_ALLERGENS[n] ?? ""}`), al.other].filter(Boolean).join(", ") : "",
        al?.has ? allergySymptomsText(al) : "",
        al?.has ? yn(al.treated) : "",
        al?.has ? yn(al.self_aware) : "",
      );
    }
    ws.addRow(line);
  }
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.eachRow((row, n) => {
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      c.alignment = { vertical: "middle", wrapText: true, horizontal: n === 1 ? "center" : undefined };
      if (n === 1) {
        c.font = { bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } };
      }
    });
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  await logStaffAccess(me, metaFromHeaders(request.headers), {
    recruitmentId: rid,
    action: "export",
    target: withSensitive ? "sensitive" : "basic",
    detail: { sensitive: withSensitive, rows: rows.length },
  });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `${r.title}_신규접수${withSensitive ? "_민감정보포함" : ""}.xlsx`;
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
