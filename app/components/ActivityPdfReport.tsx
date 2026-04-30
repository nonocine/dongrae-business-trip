import {
  ACTIVITY_LABEL,
  TRANSPORT_LABEL,
  type Activity,
  type ActivityKind,
} from "@/lib/supabase";

function formatKoreanDate(d: string | null) {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
}

function formatRange(start: string | null, end: string | null) {
  if (!start) return "-";
  if (!end || end === start) return formatKoreanDate(start);
  return `${formatKoreanDate(start)} ~ ${formatKoreanDate(end)}`;
}

function formatCompanion(list: string[]) {
  if (!list || list.length === 0) return "-";
  if (list.length === 1) return list[0];
  return list.join(", ");
}

const FONT_STACK =
  "'Pretendard','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";

const REPORT_TITLE: Record<ActivityKind, string> = {
  outside_work: "외 근 보 고 서",
  business_trip: "출 장 보 고 서",
  domestic_training: "국 내 연 수 보 고 서",
  overseas_training: "해 외 연 수 보 고 서",
  education: "교 육 보 고 서",
};

export default function ActivityPdfReport({ activity }: { activity: Activity }) {
  const photos = activity.photos.slice(0, 4);
  const a = activity;

  const rows: { label: string; value: string }[] = [];

  // Date row
  const usesRange =
    a.kind === "business_trip" ||
    a.kind === "domestic_training" ||
    a.kind === "overseas_training";
  rows.push({
    label:
      a.kind === "overseas_training"
        ? "출국/귀국일"
        : usesRange
        ? "기간"
        : "날짜",
    value: formatRange(a.start_date, a.end_date),
  });

  if (a.kind === "overseas_training") {
    rows.push({
      label: "국가/도시",
      value: [a.country, a.city].filter(Boolean).join(" / ") || "-",
    });
  } else {
    const locLabel =
      a.kind === "business_trip"
        ? "출장지"
        : a.kind === "domestic_training"
        ? "연수 장소"
        : "장소";
    rows.push({ label: locLabel, value: a.location || "-" });
  }

  if (a.kind === "domestic_training" || a.kind === "overseas_training") {
    if (a.organization) rows.push({ label: "연수 기관", value: a.organization });
    if (a.course_name) rows.push({ label: "과정명", value: a.course_name });
  }
  if (a.kind === "overseas_training" && a.visa_info) {
    rows.push({ label: "비자 정보", value: a.visa_info });
  }

  rows.push({ label: "작성자", value: a.author });
  rows.push({ label: "동행자", value: formatCompanion(a.companion) });
  rows.push({
    label:
      a.kind === "outside_work"
        ? "외근 목적"
        : a.kind === "business_trip"
        ? "출장 목적"
        : a.kind === "education"
        ? "교육 목적"
        : "연수 목적",
    value: a.purpose || "-",
  });

  if (a.transport_type) {
    rows.push({
      label: "이동수단",
      value: TRANSPORT_LABEL[a.transport_type] ?? a.transport_type,
    });
  }

  // Costs
  const costParts: string[] = [];
  if (a.transport_cost != null)
    costParts.push(`교통비 ${a.transport_cost.toLocaleString("ko-KR")}원`);
  if (a.accommodation_cost != null)
    costParts.push(`숙박비 ${a.accommodation_cost.toLocaleString("ko-KR")}원`);
  if (a.training_cost != null)
    costParts.push(`연수비 ${a.training_cost.toLocaleString("ko-KR")}원`);
  if (costParts.length > 0) {
    rows.push({ label: "비용", value: costParts.join(" · ") });
  }
  if (a.kind === "business_trip" && a.accommodation) {
    rows.push({ label: "숙박", value: "있음" });
  }

  // Education-specific
  if (a.kind === "education") {
    if (a.education_type) rows.push({ label: "교육 분류", value: a.education_type });
    if (a.instructor) rows.push({ label: "강사", value: a.instructor });
    if (a.education_hours != null)
      rows.push({ label: "교육 시간", value: `${a.education_hours}시간` });
    if (a.attendees_count != null)
      rows.push({ label: "참석자 수", value: `${a.attendees_count}명` });
  }

  return (
    <div
      style={{
        fontFamily: FONT_STACK,
        width: "794px",
        padding: "28px 48px",
        background: "#ffffff",
        color: "#0f172a",
        boxSizing: "border-box",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          paddingBottom: "10px",
          borderBottom: "3px solid #1a5fb4",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/dongrae-logo.png"
          alt="동래구청소년센터"
          crossOrigin="anonymous"
          style={{
            height: "72px",
            width: "auto",
            objectFit: "contain",
            display: "block",
          }}
        />
        <div style={{ width: "1px", height: "56px", background: "#cbd5e1" }} />
        <h1
          style={{
            margin: 0,
            fontSize: "30px",
            fontWeight: 800,
            letterSpacing: "0.1em",
            lineHeight: 1.1,
          }}
        >
          {REPORT_TITLE[a.kind]}
        </h1>
      </div>

      {/* 메타 표 */}
      <table
        style={{
          width: "100%",
          marginTop: "16px",
          borderCollapse: "collapse",
          fontSize: "13px",
        }}
      >
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th
                style={{
                  width: "100px",
                  padding: "7px 10px",
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  textAlign: "center",
                  fontWeight: 600,
                }}
              >
                {r.label}
              </th>
              <td
                style={{
                  padding: "7px 12px",
                  border: "1px solid #cbd5e1",
                }}
              >
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 내용 */}
      <SectionTitle>{ACTIVITY_LABEL[a.kind]} 내용</SectionTitle>
      <Block
        label={
          a.kind === "outside_work"
            ? "외근 내용"
            : a.kind === "business_trip"
            ? "회의/방문 내용"
            : a.kind === "education"
            ? "교육 내용"
            : "연수 내용"
        }
        content={a.content || "-"}
      />
      <Block label="결과 및 성과" content={a.result || "-"} />

      {/* 인증샷 */}
      {photos.length > 0 && (
        <>
          <SectionTitle>인증샷</SectionTitle>
          <PhotoGrid photos={photos} />
        </>
      )}

      <div
        style={{
          marginTop: "20px",
          paddingTop: "10px",
          borderTop: "1px solid #e2e8f0",
          textAlign: "right",
          fontSize: "12px",
          color: "#475569",
        }}
      >
        <p style={{ margin: "0 0 2px" }}>
          작성자: <strong style={{ color: "#0f172a" }}>{a.author}</strong>
        </p>
        <p style={{ margin: 0 }}>
          {a.start_date ? `${formatKoreanDate(a.start_date)} 작성` : ""}
        </p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        marginTop: "16px",
        marginBottom: "6px",
        fontSize: "15px",
        fontWeight: 700,
        color: "#1a5fb4",
        borderLeft: "4px solid #1a5fb4",
        paddingLeft: "10px",
      }}
    >
      {children}
    </h2>
  );
}

function Block({ label, content }: { label: string; content: string }) {
  return (
    <div style={{ marginTop: "6px" }}>
      <p
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "#475569",
          margin: "0 0 3px",
        }}
      >
        {label}
      </p>
      <div
        style={{
          padding: "8px 12px",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          fontSize: "13px",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          minHeight: "32px",
        }}
      >
        {content}
      </div>
    </div>
  );
}

const GAP = 8;
const PHOTO_HEIGHT = 160;

const cellStyle: React.CSSProperties = {
  width: "100%",
  height: `${PHOTO_HEIGHT}px`,
  objectFit: "contain",
  background: "#f8fafc",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  display: "block",
};

function PhotoImg({ src, index }: { src: string; index: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`인증샷 ${index + 1}`}
      crossOrigin="anonymous"
      style={cellStyle}
    />
  );
}

function PhotoGrid({ photos }: { photos: string[] }) {
  const wrap: React.CSSProperties = {
    marginTop: "6px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: `${GAP}px`,
  };
  if (photos.length === 1) {
    return (
      <div style={wrap}>
        <div style={{ width: "32%" }}>
          <PhotoImg src={photos[0]} index={0} />
        </div>
      </div>
    );
  }
  if (photos.length === 2) {
    return (
      <div style={wrap}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: `${GAP}px`,
            width: "64%",
          }}
        >
          {photos.map((src, i) => (
            <PhotoImg key={i} src={src} index={i} />
          ))}
        </div>
      </div>
    );
  }
  if (photos.length === 3) {
    return (
      <div style={wrap}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: `${GAP}px`,
            width: "94%",
          }}
        >
          {photos.map((src, i) => (
            <PhotoImg key={i} src={src} index={i} />
          ))}
        </div>
      </div>
    );
  }
  // 4
  return (
    <div style={wrap}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: `${GAP}px`,
          width: "64%",
        }}
      >
        {photos.map((src, i) => (
          <PhotoImg key={i} src={src} index={i} />
        ))}
      </div>
    </div>
  );
}
