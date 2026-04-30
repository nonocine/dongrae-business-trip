"use client";

// Browser-only helper: render an HTML node as an A4 PDF using html2canvas + jsPDF.
// 한글은 DOM 렌더링 결과를 캔버스로 캡처하므로 시스템 폰트가 그대로 사용됩니다.
export async function generateTripPdf(node: HTMLElement, filename: string) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  // Wait for any images inside the node to fully load before snapshot
  const imgs = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

  if (imgHeight <= pageHeight) {
    pdf.addImage(dataUrl, "JPEG", 0, 0, imgWidth, imgHeight);
  } else {
    // Slice the canvas vertically across multiple A4 pages
    const pageHeightPx = (canvas.width * pageHeight) / pageWidth;
    let renderedPx = 0;
    let pageIdx = 0;
    while (renderedPx < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceHeightPx;
      const ctx = slice.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(
        canvas,
        0,
        renderedPx,
        canvas.width,
        sliceHeightPx,
        0,
        0,
        canvas.width,
        sliceHeightPx
      );
      const sliceMm = (sliceHeightPx * imgWidth) / canvas.width;
      const sliceUrl = slice.toDataURL("image/jpeg", 0.92);
      if (pageIdx > 0) pdf.addPage();
      pdf.addImage(sliceUrl, "JPEG", 0, 0, imgWidth, sliceMm);
      renderedPx += sliceHeightPx;
      pageIdx += 1;
    }
  }

  pdf.save(filename);
}
