// D04-B4-A.3: bounded HTTP transport for reconciliation.
// Each request receives a fresh deadline, including Storage operations.
export const RECONCILER_REQUEST_TIMEOUT_MS = 10_000;
export function boundedReconcilerFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  transport: typeof fetch = fetch,
): Promise<Response> {
  const timeout = AbortSignal.timeout(RECONCILER_REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return transport(input, { ...init, signal });
}
