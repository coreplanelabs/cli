import type { Config } from '../config/schema';
import { isStderrTTY } from '../utils/env';

let shown = false;

// Diagnostic context line. Only shown with --verbose, and never includes any
// portion of a credential (truncated keys still leak via screenshots and
// scrollback) — just the auth method.
export function showStatusBar(config: Config): void {
  if (shown) return;
  if (!config.verbose) return;
  if (config.quiet) return;
  if (!isStderrTTY()) return;
  shown = true;

  const authSummary = config.apiKey ? 'api-key' : 'oauth';
  const workspace = config.workspaceId ?? '(none)';

  const parts = [
    `polylane`,
    `domain:${config.domain}`,
    `auth:${authSummary}`,
    `ws:${workspace}`,
  ];

  const dim = (s: string): string =>
    config.noColor ? s : `\x1B[2m${s}\x1B[0m`;

  process.stderr.write(dim(parts.join('  ')) + '\n');
}
