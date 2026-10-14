import { checkPdf, validatePdf } from "../_shared/file-validation.ts";
const encode = (s: string) => new TextEncoder().encode(s);
Deno.test("active PDF feature markers are rejected with a reason", () => {
 for (const feature of ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"]) {
  const r = checkPdf(encode("%PDF-1.7\n1 0 obj\n<< " + feature + " 2 0 R >>\nendobj\n%%EOF\n"));
  if (r.ok || r.reason !== "pdf_active_content") throw new Error("Unexpectedly accepted " + feature);
 }
 const enc = checkPdf(encode("%PDF-1.7\ntrailer << /Encrypt 5 0 R >>\n%%EOF\n"));
 if (enc.ok || enc.reason !== "pdf_encrypted") throw new Error("Encrypted PDF not flagged");
 if (!validatePdf(encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"))) throw new Error("Ordinary PDF rejected");
});
Deno.test("markers inside stream payloads do not cause false positives", () => {
 const pdf = encode("%PDF-1.7\n4 0 obj\n<< /Length 30 >>\nstream\nBT /JS 1 Tf (x) Tj /Launch ET\nendstream\nendobj\n%%EOF\n");
 if (!validatePdf(pdf)) throw new Error("Stream content triggered active-content rejection");
 const after = encode("%PDF-1.7\n4 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj\n5 0 obj\n<< /S /JavaScript >>\nendobj\n%%EOF\n");
 if (validatePdf(after)) throw new Error("Action dictionary after a stream was missed");
});
Deno.test("trailing whitespace and NUL padding after %%EOF are accepted", () => {
 if (!validatePdf(encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\r\n\x00\x00"))) throw new Error("Padded EOF rejected");
});
