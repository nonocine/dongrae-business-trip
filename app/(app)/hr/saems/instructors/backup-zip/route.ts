import JSZip from "jszip";
import { requireSaemAccess } from "@/lib/saemAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { saemDocLabel } from "@/lib/saem";
import {
  loadInstructorExportRows,
  buildInstructorsWorkbook,
} from "@/lib/saemExport";
import { kstTodayYmd } from "@/lib/trainings";

// 전체 백업 — M0 전용. 강사명단.xlsx + 강사별 서류 폴더.
//   TODO: 구글드라이브 자동 업로드는 범위 외(추후 vercel connect 등으로 연동).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "hr-documents";

export async function GET() {
  try {
    await requireSaemAccess({ onlyM0: true });
  } catch {
    return new Response("권한이 없습니다. (관장·부장 전용)", { status: 403 });
  }

  const rows = await loadInstructorExportRows();
  const zip = new JSZip();

  // 1) 강사명단 엑셀.
  const wb = await buildInstructorsWorkbook(rows);
  zip.file("강사명단.xlsx", Buffer.from(wb));

  // 2) 강사별 서류 폴더({이름}_{전화뒤4}) — 서류 없는 강사는 폴더 생략.
  const { data: docs } = await supabaseAdmin
    .from("saem_instructor_documents")
    .select("instructor_id, slot, file_path, original_name");
  const byInstr = new Map<
    string,
    { slot: string; file_path: string; original_name: string | null }[]
  >();
  for (const d of docs ?? []) {
    const r = d as {
      instructor_id: string;
      slot: string;
      file_path: string;
      original_name: string | null;
    };
    const list = byInstr.get(r.instructor_id) ?? [];
    list.push(r);
    byInstr.set(r.instructor_id, list);
  }

  for (const row of rows) {
    const list = byInstr.get(row.id);
    if (!list || list.length === 0) continue; // 서류 없는 강사 생략
    const folder = `${row.name}_${row.phoneLast4}`;
    const used = new Set<string>();
    for (const d of list) {
      const { data: file } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(d.file_path);
      if (!file) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = d.file_path.split(".").pop() ?? "bin";
      const base = d.original_name || `${saemDocLabel(d.slot)}.${ext}`;
      let entry = `${saemDocLabel(d.slot)}_${base}`;
      let n = 1;
      while (used.has(entry)) entry = `${saemDocLabel(d.slot)}_${n++}_${base}`;
      used.add(entry);
      zip.file(`${folder}/${entry}`, bytes);
    }
  }

  const content = await zip.generateAsync({ type: "arraybuffer" });
  const filename = `강사백업_${kstTodayYmd()}.zip`;
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
