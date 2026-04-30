import {
  TRANSPORT_LABEL,
  type BusinessTrip,
} from "@/lib/supabase";

function formatKoreanDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
}

function formatCompanion(list: string[]) {
  if (!list || list.length === 0) return "-";
  if (list.length === 1) return list[0];
  return list.join(", ");
}

const FONT_STACK =
  "'Pretendard','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";

export default function TripPdfReport({ trip }: { trip: BusinessTrip }) {
  const photos = trip.photos.slice(0, 5);

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
      {/* 헤더: 로고 | 출장보고서 (가로 배치) */}
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
        <div
          style={{
            width: "1px",
            height: "56px",
            background: "#cbd5e1",
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: "32px",
            fontWeight: 800,
            letterSpacing: "0.1em",
            lineHeight: 1.1,
          }}
        >
          출 장 보 고 서
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
          <Row label="출장일자" value={formatKoreanDate(trip.trip_date)} />
          <Row label="출장지" value={trip.destination} />
          <Row label="출장자" value={trip.traveler} />
          <Row label="동행자" value={formatCompanion(trip.companion)} />
          <Row label="출장 목적" value={trip.purpose} />
          <Row
            label="이동수단"
            value={
              TRANSPORT_LABEL[trip.transport_type] +
              (trip.transport_type === "public" && trip.transport_cost != null
                ? ` (교통비 ${trip.transport_cost.toLocaleString("ko-KR")}원)`
                : "")
            }
          />
        </tbody>
      </table>

      {/* 출장 내용 */}
      <SectionTitle>출장 내용</SectionTitle>
      <Block label="주요 안건" content={trip.main_agenda || "-"} />
      <Block label="회의/방문 내용" content={trip.meeting_content || "-"} />
      <Block label="결과 및 성과" content={trip.result || "-"} />

      {/* 인증샷 */}
      {photos.length > 0 && (
        <>
          <SectionTitle>인증샷</SectionTitle>
          <PhotoGrid photos={photos} />
        </>
      )}

      {/* 작성자 푸터 */}
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
          작성자: <strong style={{ color: "#0f172a" }}>{trip.traveler}</strong>
        </p>
        <p style={{ margin: 0 }}>{formatKoreanDate(trip.trip_date)} 작성</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
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
        {label}
      </th>
      <td
        style={{
          padding: "7px 12px",
          border: "1px solid #cbd5e1",
        }}
      >
        {value}
      </td>
    </tr>
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

// =====================================================================
// 사진 개수에 따라 자동 배치 (작은 크기, contain)
// =====================================================================
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
  // 각 사진 약 30% 폭, 가운데 정렬
  const gridWrap: React.CSSProperties = {
    marginTop: "6px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: `${GAP}px`,
  };

  if (photos.length === 1) {
    return (
      <div style={gridWrap}>
        <div style={{ width: "32%" }}>
          <PhotoImg src={photos[0]} index={0} />
        </div>
      </div>
    );
  }

  if (photos.length === 2) {
    return (
      <div style={gridWrap}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: `${GAP}px`,
            width: "64%",
          }}
        >
          <PhotoImg src={photos[0]} index={0} />
          <PhotoImg src={photos[1]} index={1} />
        </div>
      </div>
    );
  }

  if (photos.length === 3) {
    return (
      <div style={gridWrap}>
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

  if (photos.length === 4) {
    return (
      <div style={gridWrap}>
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

  // 5장: 위 2장 (각 30%) + 아래 3장 (각 30%)
  return (
    <div style={gridWrap}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: `${GAP}px`,
          width: "64%",
        }}
      >
        <PhotoImg src={photos[0]} index={0} />
        <PhotoImg src={photos[1]} index={1} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: `${GAP}px`,
          width: "94%",
        }}
      >
        <PhotoImg src={photos[2]} index={2} />
        <PhotoImg src={photos[3]} index={3} />
        <PhotoImg src={photos[4]} index={4} />
      </div>
    </div>
  );
}
