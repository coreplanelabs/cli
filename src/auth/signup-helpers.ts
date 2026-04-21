// Parses the `Expires=...` attribute from a Set-Cookie header into an ISO date
// string. Returns null if the header is missing or unparseable. Used to record
// the actual server-side session lifetime instead of guessing a TTL.
export function parseSessionExpiresAt(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/Expires=([^;]+)/i);
  if (!match) return null;
  const d = new Date(match[1]!);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
