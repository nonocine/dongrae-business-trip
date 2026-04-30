"use client";

import { useTransition } from "react";
import { deleteBusinessTrip } from "@/app/actions";

export default function DeleteTripButton({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        if (!confirm("이 출장일지를 삭제하시겠습니까?")) return;
        startTransition(async () => {
          await deleteBusinessTrip(formData);
          onDeleted?.();
        });
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-[color:var(--accent)] hover:underline disabled:opacity-50"
      >
        {pending ? "삭제 중…" : "삭제"}
      </button>
    </form>
  );
}
