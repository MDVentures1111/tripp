export function extractAnalysis(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const value = choices?.[0]?.message?.content;
  return typeof value === 'string' && value.trim() ? value.slice(0, 7000) : null;
}
