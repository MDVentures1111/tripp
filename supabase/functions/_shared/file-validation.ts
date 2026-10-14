/** Bounded structural checks; no decompression or embedded content execution.
 * D04-C: practical compatibility policy. Ordinary business documents produced by
 * Word, Google Docs, Acrobat, macOS Preview and scanners must pass. Malware detection
 * is delegated to the mandatory scanner; these checks only reject clearly active or
 * unscannable content and malformed containers.
 */
export const MAX_DOCUMENT_BYTES = 20_971_520;
export type ValidationFailure =
  | "file_too_large" | "invalid_pdf" | "invalid_docx"
  | "pdf_active_content" | "pdf_encrypted" | "docx_macros";
export type ValidationResult = { ok: true } | { ok: false; reason: ValidationFailure };

const ascii = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] + b[p+1]*256 + b[p+2]*65536 + b[p+3]*16777216) >>> 0;

// Rejected PDF features: executable script, external launch, embedded payloads,
// rich media and XFA forms. Ordinary AcroForms, object streams, OpenAction (page
// view on open) and additional actions are allowed; script inside them is caught by
// the /JS and /JavaScript markers or by the malware scanner.
const PDF_ACTIVE = /\/(?:JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA)(?![A-Za-z0-9])/;
const PDF_ENCRYPT = /\/Encrypt(?![A-Za-z0-9])/;

export function checkPdf(b: Uint8Array): ValidationResult {
  if (b.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: "file_too_large" };
  if (b.length < 16) return { ok: false, reason: "invalid_pdf" };
  const head = ascii(b.subarray(0, Math.min(1024, b.length)));
  if (!head.startsWith("%PDF-")) return { ok: false, reason: "invalid_pdf" };
  const end = ascii(b.subarray(Math.max(0, b.length - 2048)));
  // Allow trailing whitespace and NUL padding, which some scanners and generators emit.
  if (!/%%EOF[\s\x00]*$/.test(end)) return { ok: false, reason: "invalid_pdf" };
  // Strip stream payloads first: compressed binary (images, fonts) and page content
  // operators are not action dictionaries and would cause false positives.
  const source = ascii(b).replace(/stream\r?\n[\s\S]*?endstream/g, "stream endstream");
  // PDF names permit #hh hex escapes, e.g. /J#61vaScript. Normalize before matching.
  const decodedNames = source.replace(/\/([A-Za-z0-9#]+)/g, (_m, raw: string) =>
    "/" + raw.replace(/#([0-9a-fA-F]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16))));
  if (PDF_ENCRYPT.test(decodedNames)) return { ok: false, reason: "pdf_encrypted" };
  if (PDF_ACTIVE.test(decodedNames)) return { ok: false, reason: "pdf_active_content" };
  return { ok: true };
}

/** Reject ZIP64, encryption, traversal, duplicates, macros and oversized ZIP entries. */
export function checkDocx(b: Uint8Array): ValidationResult {
  if (b.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: "file_too_large" };
  const bad: ValidationResult = { ok: false, reason: "invalid_docx" };
  if (b.length < 100) return bad;
  const start = Math.max(0, b.length - 65557);
  let eocd = -1;
  for (let i = b.length - 22; i >= start; i--) {
    if (u32(b, i) === 0x06054b50 && i + 22 + u16(b, i + 20) === b.length) { eocd = i; break; }
  }
  if (eocd < 0 || u16(b, eocd + 4) !== 0 || u16(b, eocd + 6) !== 0) return bad;
  const count = u16(b, eocd + 10), centralSize = u32(b, eocd + 12), offset = u32(b, eocd + 16);
  if (count < 3 || count > 1000 || centralSize > 2_000_000 || offset + centralSize !== eocd) return bad;
  const names = new Set<string>(); let pos = offset; let total = 0; const ranges: Array<[number, number]> = [];
  let macros = false;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || u32(b, pos) !== 0x02014b50) return bad;
    const flags = u16(b, pos + 8), method = u16(b, pos + 10), compressed = u32(b, pos + 20), expanded = u32(b, pos + 24);
    const nameLen = u16(b, pos + 28), extra = u16(b, pos + 30), comment = u16(b, pos + 32);
    const local = u32(b, pos + 42), end = pos + 46 + nameLen + extra + comment;
    // Bit 3 (data descriptor) is permitted: sizes are taken from the central directory,
    // which is authoritative. Encryption (bits 0, 6) and masked headers (bit 13) are not.
    if (end > eocd || !nameLen || (flags & (1 | 0x40 | 0x2000)) !== 0 || (method !== 0 && method !== 8) ||
      compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff ||
      expanded > 10_000_000 || (compressed === 0 && expanded > 0) ||
      (compressed > 0 && expanded / compressed > 100)) return bad;
    total += expanded;
    if (total > 40_000_000) return bad;
    const name = ascii(b.subarray(pos + 46, pos + 46 + nameLen));
    if (names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) return bad;
    if (/(?:^|\/)vbaProject\.bin$/i.test(name) || /(?:^|\/)vbaData\.xml$/i.test(name) ||
        /(?:^|\/)embeddings\/.*\.(?:bin|exe|dll|js|vbs|ps1|bat|cmd|docm|xlsm|pptm)$/i.test(name) ||
        /(?:^|\/)activeX\//i.test(name)) macros = true;
    names.add(name);
    if (local + 30 > offset || u32(b, local) !== 0x04034b50) return bad;
    const dataStart = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    if (dataStart + compressed > offset || dataStart > offset) return bad;
    // Local extra fields legitimately differ from central ones (e.g. Info-ZIP timestamps),
    // so only flags, method and name must match.
    if (u16(b, local + 6) !== flags || u16(b, local + 8) !== method || u16(b, local + 26) !== nameLen) return bad;
    if (!b.subarray(local + 30, local + 30 + nameLen).every((v, j) => v === b[pos + 46 + j])) return bad;
    if (method === 0 && compressed !== expanded) return bad;
    ranges.push([local, dataStart + compressed]);
    pos = end;
  }
  ranges.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) return bad;
  if (pos !== eocd || !names.has("[Content_Types].xml") || !names.has("_rels/.rels") || !names.has("word/document.xml")) return bad;
  if (macros) return { ok: false, reason: "docx_macros" };
  return { ok: true };
}

export function checkDocument(ext: "pdf" | "docx", b: Uint8Array): ValidationResult {
  return ext === "pdf" ? checkPdf(b) : checkDocx(b);
}
/** Backward-compatible boolean wrappers. */
export const validatePdf = (b: Uint8Array) => checkPdf(b).ok;
export const validateDocx = (b: Uint8Array) => checkDocx(b).ok;
