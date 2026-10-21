import { notFound } from "next/navigation";
import { getPost } from "@/app/(app)/bangka/posts/actions";
import PostEditor from "@/app/(app)/bangka/posts/PostEditor";

export const dynamic = "force-dynamic";

export default async function BangkaPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();
  return <PostEditor post={post} />;
}
