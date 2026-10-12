// Server-side structured operational events. Never log JWTs, signed URLs, filenames, or document bytes.
export function auditDocumentEvent(event: string, fields: {
  organizationId?: string; userId?: string; documentId?: string;
  outcome: string; status: number; reason?: string;
}): void {
  console.log(JSON.stringify({
    schema: "tripp.document.audit.v1",
    event, outcome: fields.outcome, status: fields.status,
    organization_id: fields.organizationId ?? null,
    user_id: fields.userId ?? null,
    document_id: fields.documentId ?? null,
    reason: fields.reason ?? null,
    at: new Date().toISOString(),
  }));
}
