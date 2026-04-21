import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { formatOutput } from '../../output/formatter';
import { getInstallId } from '../../telemetry';

function disabledReason(): string {
  if (process.env.DO_NOT_TRACK && process.env.DO_NOT_TRACK !== '0' && process.env.DO_NOT_TRACK !== 'false') {
    return 'DO_NOT_TRACK env var';
  }
  const v = process.env.NOMINAL_TELEMETRY;
  if (v !== undefined && (v === '' || v === '0' || v === 'false' || v === 'no')) {
    return 'NOMINAL_TELEMETRY env var';
  }
  return 'config file (~/.nominal/config.json)';
}

export const telemetryStatusCommand: Command = {
  name: 'telemetry status',
  description: 'Show whether usage telemetry is enabled and what gets sent',
  async execute(config: Config): Promise<void> {
    formatOutput(config, {
      enabled: config.telemetry,
      ...(config.telemetry ? {} : { disabledBy: disabledReason() }),
      installId: getInstallId(),
      endpoint: process.env.NOMINAL_TELEMETRY_ENDPOINT ?? `https://${config.domain}/v1/telemetry/cli`,
      collects: {
        identity: [
          'anonymous install ID (UUID, generated once, not linked to user)',
          'per-process session ID (UUID, correlates events within one run)',
          'workspaceId (the tenant ID, never the user)',
          'auth method class only: oauth | api-key | unauthenticated',
        ],
        runtime: [
          'CLI version + install source (npm/brew/curl/bun/dev/unknown)',
          'Node version, OS + OS release, arch',
          'CI flag + CI provider name (GitHub Actions / CircleCI / ...) when applicable',
          'TTY flags (stdout, stderr)',
          'shell name (zsh/bash/fish/pwsh), terminal program (iTerm/vscode/...)',
          'language (2-letter from $LANG), IANA timezone',
          'CPU model + count + clock speed, total system memory (MB), process RSS',
        ],
        invocation: [
          'command name (e.g. "case investigate")',
          'flag names used (never flag values)',
          'positional argument COUNT (never the values)',
          'output format (text/json), quiet/verbose/dry-run/non-interactive flags',
          'duration, boot time, HTTP request count + total time',
        ],
        outcome: [
          'exit code',
          'error category (AUTH/NETWORK/...) and HTTP status code if applicable',
        ],
        sequence: [
          'total run count on this install',
          'days since first install',
          'previous command name (for funnel analysis)',
        ],
      },
      neverCollects: [
        'flag values, positional argument values, prompts',
        'credentials, tokens, passwords, OAuth scopes',
        'user IDs, emails, names',
        'file paths, stdin contents, command output',
        'full error messages or stack traces (only the category and HTTP status)',
      ],
      disable: 'nominal telemetry disable',
    });
  },
};
