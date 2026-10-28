import { notFound } from "next/navigation";
import { getTalkThread } from "@/app/(app)/bangka/talk/actions";
import TalkThreadView from "@/app/(app)/bangka/talk/[id]/TalkThreadView";

export const dynamic = "force-dynamic";

export default async function BangkaTalkThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thread = await getTalkThread(id);
  if (!thread) notFound();
  return <TalkThreadView key={thread.messages.length} thread={thread} />;
}
