export function createSimplePdf(title: string, lines: string[]): Uint8Array {
  const safeTitle = escapePdfText(title).slice(0, 120);
  const safeLines = lines.map((line) => escapePdfText(line).slice(0, 140)).slice(0, 36);
  const contentLines = [
    "BT",
    "/F1 24 Tf",
    "72 760 Td",
    `(${safeTitle}) Tj`,
    "/F1 12 Tf",
    "0 -34 Td",
    ...safeLines.flatMap((line) => [`(${line}) Tj`, "0 -18 Td"]),
    "ET"
  ];
  const stream = contentLines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  const chunks = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  let offset = byteLength(chunks[0]);
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(chunk);
    offset += byteLength(chunk);
  });
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF"
  ].join("\n");
  return new TextEncoder().encode(`${chunks.join("")}${xref}`);
}

export function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, "\\$&").replace(/[\r\n\t]+/g, " ").trim();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
