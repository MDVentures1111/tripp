// D04-C: realistic synthetic corpus (see fixtures/README.md). No real deal data.
import { checkDocument } from "../_shared/file-validation.ts";
const dir = new URL("./fixtures/", import.meta.url);
const expected: Record<string, string | null> = {
 "proposal-objstm.pdf": null, "proposal-acroform.pdf": null, "proposal-acroform-plain.pdf": null,
 "proposal-openaction.pdf": null, "proposal-binary-markers.pdf": null,
 "loi.docx": null, "loi-data-descriptor.docx": null, "loi-embedded-xlsx.docx": null,
 "reject-javascript.pdf": "pdf_active_content", "reject-encrypted.pdf": "pdf_encrypted",
 "reject-macro.docx": "docx_macros", "reject-ole.docx": "docx_macros",
};
for (const [name, reason] of Object.entries(expected)) {
 Deno.test(`fixture ${name} -> ${reason ?? "accepted"}`, async () => {
  const bytes = await Deno.readFile(new URL(name, dir));
  const r = checkDocument(name.endsWith(".pdf") ? "pdf" : "docx", bytes);
  if (reason === null && !r.ok) throw new Error(`${name} rejected: ${r.reason}`);
  if (reason !== null && (r.ok || r.reason !== reason)) throw new Error(`${name} expected ${reason}, got ${r.ok ? "accepted" : r.reason}`);
 });
}
