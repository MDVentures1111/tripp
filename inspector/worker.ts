/** Conservative isolated inspector worker. Not a full PDF or OPC parser.
 * Run with --no-net and explicit resource limits in a separate process.
 * Unsupported document constructs MUST return indeterminate, never safe.
 */
import { validatePdf, validateDocx } from "../supabase/functions/_shared/file-validation.ts";
export type WorkerVerdict = "safe" | "unsafe" | "indeterminate";
export function inspectBoundedDocument(bytes: Uint8Array, mime: string): WorkerVerdict {
  if (bytes.length === 0 || bytes.length > 20_971_520) return "unsafe";
  if (mime === "application/pdf") {
    if (!validatePdf(bytes)) return "unsafe";
    // Current validator cannot interpret compressed objects, incremental updates,
    // xref streams or active content in streams. Do not issue a safe attestation.
    return "indeterminate";
  }
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (!validateDocx(bytes)) return "unsafe";
    // ZIP central directory validation is not equivalent to OPC/XML inspection.
    return "indeterminate";
  }
  return "unsafe";
}
