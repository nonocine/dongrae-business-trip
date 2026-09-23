import JSZip from "jszip";
import { requireSaemAccess } from "@/lib/saemAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { saemDocLabel } from "@/lib/saem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "hr-documents";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSaemAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const { id } = await params;

  const { data: ins } = await supabaseAdmin
    .from("saem_instructors")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!ins) return new Response("강사를 찾을 수 없습니다.", { status: 404 });
  const name = String((ins as { name: string }).name);

  const { data: docs } = await supabaseAdmin
    .from("saem_instructor_documents")
    .select("slot, file_path, original_name")
    .eq("instructor_id", id);
  const rows = (docs ?? []) as {
    slot: string;
    file_path: string;
    original_name: string | null;
  }[];
  if (rows.length === 0)
    return new Response("등록된 서류가 없습니다.", { status: 404 });

  const zip = new JSZip();
  const used = new Set<string>();
  for (const d of rows) {
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
    zip.file(entry, bytes);
  }

  const content = await zip.generateAsync({ type: "arraybuffer" });
  const filename = `${name}_서류.zip`;
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
