export function maskToken(token: string | null | undefined): string {
  if (!token) return '(none)';
  if (token.length < 12) {
    if (token.length < 4) return '***';
    return token.slice(0, 2) + '...' + token.slice(-2);
  }
  return token.slice(0, 4) + '...' + token.slice(-4);
}
