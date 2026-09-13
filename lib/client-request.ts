/** Bounded browser JSON request. Parent cancellation is distinct from a timeout. */
export async function requestJson<T>(url: string, options: { signal?: AbortSignal; timeoutMs?: number; message: string }): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const detail = response.status === 429 ? "Too many requests. Wait a moment, then retry." : response.status === 409 ? "The source changed. Restart to use its current revision." : `Request failed (${response.status}). Try again.`;
      throw new Error(`${options.message} ${detail}`);
    }
    try { return await response.json() as T; }
    catch (error) { if (controller.signal.aborted) throw error; throw new Error(`${options.message} The server returned an unreadable response. Try again.`); }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Cancelled", "AbortError");
    if (timedOut) throw new Error(`${options.message} The request took too long. Try again.`);
    if (error instanceof TypeError) throw new Error(`${options.message} Check that OpenEval is running, then retry.`);
    throw error;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
  }
}
