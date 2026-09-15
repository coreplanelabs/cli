import { randomInt } from 'node:crypto';

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

const PASSWORD_LENGTH = 32;
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
// No quotes, backslash, `$`, backtick, or whitespace: the value must survive
// being pasted into a shell inside single quotes, and into JSON verbatim.
const SYMBOLS = '!@#%^*-_=+.,:;?~';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

// A random password that clears leaked-credential checks at the edge (the
// API's WAF challenges weak or known-leaked values). Always carries at least
// one character from each class.
export function generatePassword(length = PASSWORD_LENGTH): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

// Cloudflare answers a request it wants to challenge with an HTML page and a
// `cf-mitigated: challenge` header instead of the API's JSON envelope. On the
// signup route that means the password value tripped the leaked-credentials
// rule, not that the API rejected the request.
export function isCloudflareChallenge(res: Response): boolean {
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  const contentType = res.headers.get('content-type') ?? '';
  return res.status === 403 && contentType.includes('text/html');
}
