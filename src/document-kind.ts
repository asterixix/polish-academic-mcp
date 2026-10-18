export type DocumentKind = "pdf" | "image" | "office" | "epub" | "delimited" | "other";

export function classifyDocument(buf: Buffer, name: string, mime: string): DocumentKind {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image";
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (/\.epub$/i.test(name) || /epub/i.test(mime)) return "epub";
    if (/\.(docx|odt|ods)$/i.test(name)) return "office";
    return "other";
  }
  if (/\.(csv|tsv)$/i.test(name)) return "delimited";
  return "other";
}
