import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { boundedReconcilerFetch, RECONCILER_REQUEST_TIMEOUT_MS } from "../_shared/reconciler-transport.ts";

Deno.test("reconciler transport imposes a bounded request deadline", async () => {
  let received: AbortSignal | undefined;
  const mock = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    received = init?.signal ?? undefined;
    return Promise.resolve(new Response("ok"));
  };
  const response = await boundedReconcilerFetch("https://example.invalid", undefined, mock);
  assertEquals(response.status, 200);
  assert(received);
  assertEquals(RECONCILER_REQUEST_TIMEOUT_MS, 10_000);
});

Deno.test("reconciler transport preserves caller cancellation", async () => {
  const controller = new AbortController();
  const mock = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  const pending = boundedReconcilerFetch("https://example.invalid", { signal: controller.signal }, mock);
  controller.abort(new Error("injected transport outage"));
  await assertRejects(() => pending, Error, "injected transport outage");
});

Deno.test("reconciler transport fails closed when a request never completes", async () => {
  const mock = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  const started = Date.now();
  await assertRejects(() => boundedReconcilerFetch("https://example.invalid", undefined, mock));
  assert(Date.now() - started < RECONCILER_REQUEST_TIMEOUT_MS + 2000);
});
