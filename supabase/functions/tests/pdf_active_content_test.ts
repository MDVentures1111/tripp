import { validatePdf } from "../_shared/file-validation.ts";
Deno.test("active PDF feature markers are rejected", () => {
 const encode = (s: string) => new TextEncoder().encode(s);
 const features = ["/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA", "/AcroForm"];
 for (const feature of features) {
  const pdf = encode("%PDF-1.7\n1 0 obj\n<< "+feature+" 2 0 R >>\nendobj\n%%EOF\n");
  if (validatePdf(pdf)) throw new Error("Unexpectedly accepted "+feature);
 }
 const ordinary = encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
 if (!validatePdf(ordinary)) throw new Error("Ordinary PDF rejected");
});
