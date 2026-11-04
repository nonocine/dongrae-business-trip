import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplicationDetail, getRecruitment } from "@/app/(app)/bangka/enroll/actions";
import ApplicationDetailView from "@/app/(app)/bangka/enroll/[rid]/[aid]/ApplicationDetailView";
import { kstTodayYmd } from "@/lib/trainings";
import { linkCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 신청서 상세 — 입력 내용·서류 확인·보완요청·결정(서류확인/합격/대기/불합격)·기록.
//   민감정보(알레르기 상세·장애 증빙)는 내려보내지 않고 [민감정보 보기]를 눌러야(기록 남김) 불러옵니다.
export default async function EnrollApplicationPage({ params }: { params: Promise<{ rid: string; aid: string }> }) {
  const { rid, aid } = await params;
  const [rec, app] = await Promise.all([getRecruitment(rid), getApplicationDetail(rid, aid)]);
  if (!rec || !app) notFound();
  return (
    <div className="space-y-3">
      <Link href={`/bangka/enroll/${rid}`} className={`text-sm ${linkCls}`}>
        ← {rec.title} 접수 목록
      </Link>
      <ApplicationDetailView app={app} recruitment={rec} todayYmd={kstTodayYmd()} />
    </div>
  );
}
