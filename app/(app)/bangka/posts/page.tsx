import { listPosts } from "@/app/(app)/bangka/posts/actions";
import PostsList from "@/app/(app)/bangka/posts/PostsList";

export const dynamic = "force-dynamic";

// 공지·알림장 목록 — 종류·대상 필터는 주소(?type=&scope=)로.
export default async function BangkaPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const posts = await listPosts({ type: sp.type, scope: sp.scope });
  return <PostsList posts={posts} typeFilter={sp.type ?? "all"} scopeFilter={sp.scope ?? "all"} />;
}
