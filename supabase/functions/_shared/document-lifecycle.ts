/**
 * D04-C terminal rejection that is honest about persistence.
 * FAILED is reported only when the database confirms the document is failed.
 * If the write did not persist (RPC error, lost lease, network), the document is
 * reported as still processing, quarantine bytes are kept, and the scheduled
 * reconciler re-evaluates it (bounded by the 24h processing timeout).
 */
export type RejectionDeps = {
  reject: () => PromiseLike<{ data: unknown; error: unknown }>;
  readStatus: () => PromiseLike<{ status: string | null; reason: string | null }>;
  removeQuarantine: () => PromiseLike<unknown>;
};
export type RejectionOutcome =
  | { persisted: true; uploadStatus: "failed"; failureReason: string }
  | { persisted: false; uploadStatus: string };

export async function persistRejection(reason: string, deps: RejectionDeps): Promise<RejectionOutcome> {
  let written = false;
  try {
    const { data, error } = await deps.reject();
    written = !error && data === true;
  } catch { written = false; }
  if (written) {
    // Quarantine removal is best-effort cleanup; the reconciler also removes it for failed rows.
    try { await deps.removeQuarantine(); } catch { /* cleaned up later */ }
    return { persisted: true, uploadStatus: "failed", failureReason: reason };
  }
  // Not confirmed: report only what the database says now.
  try {
    const current = await deps.readStatus();
    if (current.status === "failed") return { persisted: true, uploadStatus: "failed", failureReason: current.reason ?? reason };
    return { persisted: false, uploadStatus: current.status ?? "processing" };
  } catch {
    return { persisted: false, uploadStatus: "processing" };
  }
}
