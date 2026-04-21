// Module-level counter incremented on each outbound HTTP request from the CLI.
// Telemetry reads it once per invocation; reset between processes (no need to
// persist).
//
// Telemetry's own dispatch must NOT call `count()` — otherwise we'd loop. The
// dispatch path uses `fetch` directly from `src/telemetry/dispatch.ts` rather
// than `src/client/http.ts`, so it's already excluded.
let count = 0;
let totalMs = 0;

export function recordHttpRequest(durationMs: number): void {
  count += 1;
  totalMs += durationMs;
}

export function getHttpStats(): { count: number; totalMs: number } {
  return { count, totalMs };
}
