import { validatePdf, validateDocx } from "../_shared/file-validation.ts";
function check(condition: boolean, label: string) { if (!condition) throw new Error(label); }
Deno.test("PDF requires header and terminal EOF", () => {
  const enc = new TextEncoder();
  check(validatePdf(enc.encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")), "valid header/EOF rejected");
  check(!validatePdf(enc.encode("not a pdf %%EOF")), "missing header accepted");
  check(!validatePdf(enc.encode("%PDF-1.7\ncontent without trailer")), "missing EOF accepted");
});
Deno.test("DOCX rejects non-ZIP and malformed central directory", () => {
  check(!validateDocx(new Uint8Array(256)), "zero bytes accepted");
  const b = new Uint8Array(256); b[0]=0x50; b[1]=0x4b;
  check(!validateDocx(b), "fake ZIP accepted");
});
