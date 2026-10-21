"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireBangkaAccess } from "@/lib/bangkaAccess";
import {
  BK_MAX_BYTES,
  bkFileKind,
  fmtBytes,
  isBkPostType,
  isBkScope,
  kstInputToIso,
  type BkFileKind,
  type BkPostDetail,
  type BkPostRow,
  type BkPostType,
  type BkScope,
} from "@/lib/bangkaContent";
import { bucket, finalizeImage, newObjectName, signedUrls, signUpload, statObject } from "@/lib/bangkaMedia";

// =====================================================================
// 공지·알림장(bk_posts) 서버 액션 — /bangka/posts
//   * 권한: 방카 관리 권한(M0 또는 bangka 직무) — 진입 시마다 재검증(service_role).
//   * 삭제는 소프트삭제(deleted_at). 보호자 앱(동래방카)은 deleted_at IS NULL 이고
//     published_at <= now 인 글만 보여 줍니다 — 미래 게시일은 예약.
//   * 첨부: bangka-media/posts/{post_id}/. 업로드 흐름은 lib/bangkaMedia 참고.
// =====================================================================

const POSTS = "bk_posts";
const FILES = "bk_post_files";
const BASE = "/bangka/posts";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown, fb: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fb });

// 대상 반별 '사용중' 보호자 수 — 그 반(전체면 아무 반) 재원생에 연결된 active 보호자.
async function targetCounts(): Promise<Record<BkScope, number>> {
  const { data, error } = await supabaseAdmin
    .from("bk_guardian_students")
    .select("guardian_id, bk_students!inner(class_code, status), bk_guardians!inner(status)")
    .eq("bk_students.status", "active")
    .eq("bk_guardians.status", "active");
  if (error) throw new Error(error.message);
  const sets: Record<BkScope, Set<string>> = { all: new Set(), ieum: new Set(), jieum: new Set() };
  for (const r of (data ?? []) as unknown as { guardian_id: string; bk_students: { class_code: string } }[]) {
    sets.all.add(r.guardian_id);
    if (r.bk_students.class_code === "ieum" || r.bk_students.class_code === "jieum")
      sets[r.bk_students.class_code].add(r.guardian_id);
  }
  return { all: sets.all.size, ieum: sets.ieum.size, jieum: sets.jieum.size };
}

export async function listPosts(filters: { type?: string; scope?: string }): Promise<BkPostRow[]> {
  await requireBangkaAccess();
  let q = supabaseAdmin
    .from(POSTS)
    .select("id, post_type, scope, title, is_pinned, published_at, author_name, bk_post_files(count), bk_post_reads(count)")
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(500);
  if (isBkPostType(filters.type)) q = q.eq("post_type", filters.type);
  if (isBkScope(filters.scope)) q = q.eq("scope", filters.scope);
  const [{ data, error }, targets] = await Promise.all([q, targetCounts()]);
  if (error) throw new Error(error.message);
  const now = Date.now();
  type Raw = Omit<BkPostRow, "file_count" | "read_count" | "target_count" | "scheduled"> & {
    bk_post_files: { count: number }[];
    bk_post_reads: { count: number }[];
  };
  return ((data ?? []) as unknown as Raw[]).map(({ bk_post_files, bk_post_reads, ...p }) => ({
    ...p,
    file_count: bk_post_files[0]?.count ?? 0,
    read_count: bk_post_reads[0]?.count ?? 0,
    target_count: targets[p.scope] ?? 0,
    scheduled: new Date(p.published_at).getTime() > now,
  }));
}

export async function getPost(id: string): Promise<BkPostDetail | null> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from(POSTS)
    .select(
      "id, post_type, scope, title, body, is_pinned, published_at, author_name, bk_post_files(id, kind, path, name, mime, size, width, height, sort_order)"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  type F = { id: string; kind: BkFileKind; path: string; name: string | null; mime: string | null; size: number | null; width: number | null; height: number | null; sort_order: number };
  const { bk_post_files, ...p } = data as unknown as Omit<BkPostDetail, "files"> & { bk_post_files: F[] };
  const files = [...bk_post_files].sort((a, b) => a.sort_order - b.sort_order);
  const urls = await signedUrls(files.map((f) => f.path));
  return {
    ...p,
    files: files.map((f) => ({
      id: f.id,
      kind: f.kind,
      name: f.name,
      mime: f.mime,
      size: f.size == null ? null : Number(f.size),
      width: f.width,
      height: f.height,
      url: urls.get(f.path) ?? null,
    })),
  };
}

export type BkPostInput = {
  id?: string;
  post_type: BkPostType;
  scope: BkScope;
  title: string;
  body: string;
  is_pinned: boolean;
  published_at: string; // datetime-local(KST). 비면 지금
};

export async function savePost(input: BkPostInput): Promise<Result<{ id: string }>> {
  try {
    const me = await requireBangkaAccess();
    const title = (input.title ?? "").trim();
    if (!title) return { ok: false, message: "제목을 입력하세요." };
    if (!isBkPostType(input.post_type)) return { ok: false, message: "종류를 고르세요." };
    if (!isBkScope(input.scope)) return { ok: false, message: "대상을 고르세요." };
    const published = input.published_at ? kstInputToIso(input.published_at) : new Date().toISOString();
    if (!published) return { ok: false, message: "게시일시 형식이 올바르지 않습니다." };
    const row = {
      post_type: input.post_type,
      scope: input.scope,
      title,
      body: (input.body ?? "").trim() || null,
      is_pinned: !!input.is_pinned,
      published_at: published,
    };
    if (input.id) {
      const { data, error } = await supabaseAdmin
        .from(POSTS)
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .is("deleted_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) return { ok: false, message: "삭제되었거나 없는 글입니다." };
      revalidatePath(BASE);
      return { ok: true, id: input.id };
    }
    const { data, error } = await supabaseAdmin
      .from(POSTS)
      .insert({ ...row, author_driver_id: me.driverId, author_name: me.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return fail(e, "글을 저장하지 못했습니다.");
  }
}

// 소프트삭제 — 보호자 앱에서 바로 사라집니다. 첨부 파일은 남겨 둡니다.
export async function deletePost(id: string): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { error } = await supabaseAdmin
      .from(POSTS)
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "글을 삭제하지 못했습니다.");
  }
}

async function assertLivePost(postId: string): Promise<void> {
  const { data } = await supabaseAdmin.from(POSTS).select("id").eq("id", postId).is("deleted_at", null).maybeSingle();
  if (!data) throw new Error("삭제되었거나 없는 글입니다.");
}

// 1) 업로드 자리 — 사진은 tmp/(서버가 줄임), 동영상·문서는 바로 최종 경로.
export async function createPostUpload(input: {
  postId: string;
  name: string;
  mime: string;
  size: number;
}): Promise<Result<{ path: string; token: string; kind: BkFileKind }>> {
  try {
    await requireBangkaAccess();
    await assertLivePost(input.postId);
    const kind = bkFileKind(input.name, input.mime);
    if (!kind) return { ok: false, message: `${input.name}: 올릴 수 없는 형식입니다(사진·동영상·문서만).` };
    if (input.size > BK_MAX_BYTES[kind])
      return { ok: false, message: `${input.name}: ${fmtBytes(BK_MAX_BYTES[kind])} 이하만 올릴 수 있습니다.` };
    const name = newObjectName(input.name, kind === "image" ? "jpg" : kind === "video" ? "mp4" : "bin");
    const slot = await signUpload(kind === "image" ? `tmp/${name}` : `posts/${input.postId}/${name}`);
    return { ok: true, ...slot, kind };
  } catch (e) {
    return fail(e, "업로드를 준비하지 못했습니다.");
  }
}

// 3) 마무리 — 사진은 줄여서 저장, 동영상·문서는 올라갔는지 확인 후 기록.
export async function finalizePostUpload(input: {
  postId: string;
  path: string;
  name: string;
  mime: string;
  kind: BkFileKind;
}): Promise<Result> {
  try {
    await requireBangkaAccess();
    await assertLivePost(input.postId);
    const { data: last } = await supabaseAdmin
      .from(FILES)
      .select("sort_order")
      .eq("post_id", input.postId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const sort_order = ((last ?? [])[0] as { sort_order?: number } | undefined)?.sort_order ?? -1;
    let row: { path: string; mime: string | null; size: number; width: number | null; height: number | null; kind: BkFileKind };
    if (input.kind === "image") {
      const img = await finalizeImage(input.path, `posts/${input.postId}`, input.mime);
      row = { path: img.path, mime: img.mime, size: img.bytes.length, width: img.width, height: img.height, kind: "image" };
    } else {
      const ok = new RegExp(`^posts/${input.postId}/[0-9a-f-]{36}\\.[a-z0-9]{1,6}$`).test(input.path);
      if (!ok) return { ok: false, message: "업로드 경로가 올바르지 않습니다." };
      const st = await statObject(input.path);
      if (!st) return { ok: false, message: `${input.name}: 올라간 파일을 찾지 못했습니다. 다시 올려 주세요.` };
      row = { path: input.path, mime: input.mime || st.mime, size: st.size, width: null, height: null, kind: input.kind };
    }
    const { error } = await supabaseAdmin
      .from(FILES)
      .insert({ post_id: input.postId, name: input.name.slice(0, 200), sort_order: sort_order + 1, ...row });
    if (error) {
      await bucket().remove([row.path]);
      throw new Error(error.message);
    }
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "첨부를 저장하지 못했습니다.");
  }
}

export async function deletePostFile(input: { postId: string; fileId: string }): Promise<Result> {
  try {
    await requireBangkaAccess();
    const { data } = await supabaseAdmin
      .from(FILES)
      .select("id, path")
      .eq("id", input.fileId)
      .eq("post_id", input.postId)
      .maybeSingle();
    if (!data) return { ok: true };
    const { error: rmErr } = await bucket().remove([(data as { path: string }).path]);
    if (rmErr) return { ok: false, message: `파일 삭제 실패: ${rmErr.message}` };
    const { error } = await supabaseAdmin.from(FILES).delete().eq("id", input.fileId);
    if (error) throw new Error(error.message);
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "첨부를 삭제하지 못했습니다.");
  }
}
