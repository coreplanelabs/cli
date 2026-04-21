import type { Config } from '../config/schema';
import { maskToken } from '../utils/token';
import { isStderrTTY } from '../utils/env';

let shown = false;

export function showStatusBar(config: Config): void {
  if (shown) return;
  if (config.quiet) return;
  if (!isStderrTTY()) return;
  shown = true;

  const authSummary = config.apiKey ? `key:${maskToken(config.apiKey)}` : 'oauth';
  const workspace = config.workspaceId ?? '(none)';

  const parts = [
    `nominal`,
    `domain:${config.domain}`,
    `auth:${authSummary}`,
    `ws:${workspace}`,
  ];

  const dim = (s: string): string =>
    config.noColor ? s : `\x1B[2m${s}\x1B[0m`;

  process.stderr.write(dim(parts.join('  ')) + '\n');
}

export function resetStatusBar(): void {
  shown = false;
}
