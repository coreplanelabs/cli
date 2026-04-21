import { platform, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config/schema';
import type { Credential } from '../auth/types';
import { isCI, getCIName, isStdoutTTY, isStderrTTY } from '../utils/env';
import { getInstallId, recordRun } from './state';
import { detectInstallSource, detectEnvironment, type InstallSource } from './environment';
import { getHttpStats } from './http-counter';

// The set of fields shipped to the telemetry endpoint. Everything here is
// intentionally non-sensitive — see PRIVACY.md for the full inventory.
//
// Hard rules:
//   - Argument values are never shipped (positional args, flag values, prompts).
//   - Credentials, tokens, passwords are never shipped.
//   - User identity (id, email, name) is never shipped.
//   - File paths, stdin contents are never shipped.
//   - Error message bodies and stack traces are never shipped.
export interface CliTelemetryEvent {
  event: 'cli.command';
  timestamp: string;
  installId: string;
  sessionId: string;

  cli: {
    version: string;
    clientKind: 'cli';
    installSource: InstallSource;
  };

  runtime: {
    node: string;
    os: NodeJS.Platform;
    osRelease: string;          // os.release(), e.g. "23.5.0"
    arch: string;
    ci: boolean;
    ciName: string | null;      // "GitHub Actions", "GitLab CI", ... or null
    tty: boolean;
    stderrTty: boolean;
    shell: string | null;       // basename only ("zsh", "bash", "pwsh", ...)
    terminal: string | null;    // TERM_PROGRAM ("iTerm.app", "vscode", ...)
    language: string | null;    // 2-letter from $LANG ("en", "fr"); never the full locale
    timezone: string | null;    // IANA tz, e.g. "America/New_York"
    cpuCount: number;
    cpuModel: string | null;    // first CPU model string ("Apple M1 Pro", ...)
    cpuSpeedMhz: number | null;
    totalMemoryMb: number;
    memoryRssBytes: number;     // process RSS at event time
  };

  command: string;
  flags: string[];               // names only
  positionalArgCount: number;    // count, not values
  outputFormat: 'text' | 'json';
  modes: {
    quiet: boolean;
    verbose: boolean;
    dryRun: boolean;
    nonInteractive: boolean;
  };

  exitCode: number;
  durationMs: number;
  bootMs: number;                // process.uptime() at event time

  http: {
    requestCount: number;        // # of API calls this command made
    totalMs: number;             // sum of API call durations
  };

  workspaceId: string | null;
  authMethod: 'oauth' | 'api-key' | null;

  error: { code: number; category: string; httpStatus: number | null } | null;

  sequence: {
    runCount: number;            // total invocations on this install (incl. this one)
    daysSinceInstall: number | null;
    previousCommand: string | null;
  };
}

const SESSION_ID = randomUUID();

function getCliVersion(): string {
  return process.env.NOMINAL_CLI_VERSION ?? '0.0.0';
}

function authMethodOf(cred: Credential | null): CliTelemetryEvent['authMethod'] {
  if (!cred) return null;
  return cred.type === 'oauth' ? 'oauth' : 'api-key';
}

// Best-effort: pull an HTTP status out of an API error message like
// "Token exchange failed: 403 …" or "WebSocket upgrade rejected (401): …".
// Used only for telemetry — never exposed to the user.
function extractHttpStatus(message: string): number | null {
  const m =
    message.match(/\b(\d{3})\b\s*$/) ?? // trailing "... 404"
    message.match(/\((\d{3})\)/) ??     // "(401)"
    message.match(/HTTP (\d{3})/i) ??   // "HTTP 503"
    null;
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 100 && n < 600 ? n : null;
}

export interface BuildEventInput {
  config: Config;
  command: string;
  flags: string[];
  positionalArgCount: number;
  exitCode: number;
  durationMs: number;
  credential: Credential | null;
  error: { code: number; category: string; rawMessage?: string } | null;
}

export function buildEvent(input: BuildEventInput): CliTelemetryEvent {
  const env = detectEnvironment();
  const http = getHttpStats();
  const sequence = recordRun(input.command);

  return {
    event: 'cli.command',
    timestamp: new Date().toISOString(),
    installId: getInstallId(),
    sessionId: SESSION_ID,
    cli: {
      version: getCliVersion(),
      clientKind: 'cli',
      installSource: detectInstallSource(),
    },
    runtime: {
      node: process.versions.node,
      os: platform(),
      osRelease: env.osRelease,
      arch: arch(),
      ci: isCI(),
      ciName: getCIName(),
      tty: isStdoutTTY(),
      stderrTty: isStderrTTY(),
      shell: env.shell,
      terminal: env.terminal,
      language: env.language,
      timezone: env.timezone,
      cpuCount: env.cpuCount,
      cpuModel: env.cpuModel,
      cpuSpeedMhz: env.cpuSpeedMhz,
      totalMemoryMb: env.totalMemoryMb,
      memoryRssBytes: env.memoryRssBytes,
    },
    command: input.command,
    flags: [...input.flags].sort(),
    positionalArgCount: input.positionalArgCount,
    outputFormat: input.config.output,
    modes: {
      quiet: input.config.quiet,
      verbose: input.config.verbose,
      dryRun: input.config.dryRun,
      nonInteractive: input.config.nonInteractive,
    },
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    bootMs: Math.round(process.uptime() * 1000),
    http: {
      requestCount: http.count,
      totalMs: http.totalMs,
    },
    workspaceId: input.config.workspaceId ?? null,
    authMethod: authMethodOf(input.credential),
    error: input.error
      ? {
          code: input.error.code,
          category: input.error.category,
          httpStatus: input.error.rawMessage ? extractHttpStatus(input.error.rawMessage) : null,
        }
      : null,
    sequence,
  };
}
