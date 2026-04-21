import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFlags, scanCommandPath } from './args';
import { GLOBAL_OPTIONS } from './command';
import type { GlobalFlags } from './types/flags';
import { loadConfig } from './config/loader';
import { handleError } from './errors/handler';
import { CLIError, isCLIError } from './errors/base';
import { ExitCode } from './errors/codes';
import { registerAllCommands } from './commands';
import {
  registry,
  renderRootHelp,
  renderGroupHelp,
  renderCommandHelp,
  buildStatusLine,
} from './registry';
import type { Config } from './config/schema';
import type { Credential } from './auth/types';
import { buildEvent, dispatch, hasShownFirstRunNotice, markFirstRunNoticeShown } from './telemetry';

const NO_AUTH_COMMANDS = new Set([
  'auth login',
  'auth logout',
  'auth status',
  'auth signup',
  'config show',
  'config set',
  'telemetry status',
  'telemetry enable',
  'telemetry disable',
  'integration catalog',
  'help',
  'update',
  'version',
  'api list',
  'api describe',
]);

function readVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function setupSignalHandlers(): void {
  process.on('SIGINT', () => {
    process.stderr.write('\n');
    process.exit(130);
  });

  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      process.exit(0);
    }
  });

  process.on('uncaughtException', (err) => {
    handleError(err, null);
  });
}

async function printRootHelp(noColor: boolean): Promise<void> {
  let status: string | null = null;
  try {
    const config = loadConfig({} as GlobalFlags);
    status = await buildStatusLine(config);
  } catch {
    status = 'Not logged in.';
  }
  process.stdout.write(renderRootHelp(noColor, status));
}

async function run(): Promise<void> {
  setupSignalHandlers();

  const argv = process.argv.slice(2);

  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`nominal ${readVersion()}\n`);
    return;
  }

  registerAllCommands();

  const commandPath = scanCommandPath(argv, GLOBAL_OPTIONS);

  if (commandPath.length === 0) {
    const { flags } = parseFlags(argv, [], GLOBAL_OPTIONS);
    const globalFlags = flags as GlobalFlags;
    const config = loadConfig(globalFlags);
    await printRootHelp(config.noColor);
    return;
  }

  const resolved = registry.resolve(commandPath);
  if (!resolved) {
    // Maybe it's a group path (e.g. `nominal case --help`)
    const node = registry.resolveNode(commandPath);
    if (node && node.children.size > 0) {
      const commands = registry.getSubcommands(node);
      const { flags } = parseFlags(argv, [], GLOBAL_OPTIONS);
      const config = loadConfig(flags as GlobalFlags);
      process.stdout.write(renderGroupHelp(commandPath, commands, config.noColor));
      return;
    }
    const { flags } = parseFlags(argv, [], GLOBAL_OPTIONS);
    const config = loadConfig(flags as GlobalFlags);
    process.stderr.write(`Unknown command: nominal ${commandPath.join(' ')}\n\n`);
    await printRootHelp(config.noColor);
    process.exit(ExitCode.USAGE);
  }

  const { command, consumed } = resolved;
  const filteredArgv = removeFirstNNonFlags(argv, consumed, GLOBAL_OPTIONS);

  const { flags, positional } = parseFlags(
    filteredArgv,
    command.options ?? [],
    GLOBAL_OPTIONS
  );
  const globalFlags = flags as GlobalFlags;
  const config = loadConfig(globalFlags);

  if (globalFlags.help) {
    process.stdout.write(renderCommandHelp(command, config.noColor));
    return;
  }

  const args: Record<string, unknown> = { ...flags, _: positional };

  // Capture flag names (NOT values) for telemetry. `_` holds positional args
  // which we also exclude — argument values are never shipped.
  const flagNames = Object.keys(flags).filter((k) => k !== '_' && k !== 'help' && k !== 'version');

  // Best-effort credential read — used for the telemetry event so we can report
  // the auth *class* (oauth vs api-key vs unauthenticated), and for the auth
  // gate below. tryResolveCredential never throws.
  const { tryResolveCredential } = await import('./auth/resolver');
  const credential: Credential | null = await tryResolveCredential(config);

  // Telemetry itself must never send telemetry. Avoids noise + avoids the ugly
  // case where `telemetry disable` is recorded after the user asked to stop.
  const isTelemetryCommand = command.name.startsWith('telemetry ');

  maybeShowTelemetryNotice(config, isTelemetryCommand);

  const started = Date.now();
  try {
    if (!NO_AUTH_COMMANDS.has(command.name)) {
      if (!credential) {
        throw new CLIError(
          'Not logged in.',
          ExitCode.AUTH,
          'nominal auth login --api-key sk_xxxxx         (API key)\n' +
            '        nominal auth login                            (OAuth browser flow)\n' +
            '        NOMINAL_API_KEY=sk_xxxxx                      (environment variable)'
        );
      }
    }
    await command.execute(config, globalFlags, args);
    if (!isTelemetryCommand) {
      await dispatch(
        config,
        buildEvent({
          config,
          command: command.name,
          flags: flagNames,
          positionalArgCount: positional.length,
          exitCode: ExitCode.SUCCESS,
          durationMs: Date.now() - started,
          credential,
          error: null,
        })
      );
    }
    process.exit(0);
  } catch (err) {
    const { exitCode, category, rawMessage } = classifyError(err);
    if (!isTelemetryCommand) {
      await dispatch(
        config,
        buildEvent({
          config,
          command: command.name,
          flags: flagNames,
          positionalArgCount: positional.length,
          exitCode,
          durationMs: Date.now() - started,
          credential,
          error: { code: exitCode, category, rawMessage },
        })
      );
    }
    handleError(err, config);
  }
}

function classifyError(err: unknown): { exitCode: number; category: string; rawMessage: string } {
  if (isCLIError(err)) {
    return {
      exitCode: err.exitCode,
      category: ExitCode[err.exitCode] ?? 'UNKNOWN',
      rawMessage: err.message,
    };
  }
  const rawMessage = err instanceof Error ? err.message : String(err);
  return { exitCode: ExitCode.GENERAL, category: 'GENERAL', rawMessage };
}

function maybeShowTelemetryNotice(config: Config, isTelemetryCommand: boolean): void {
  if (!config.telemetry) return;
  if (config.quiet || config.output === 'json') return;
  if (isTelemetryCommand) return;
  if (hasShownFirstRunNotice()) return;
  process.stderr.write(
    'Anonymous usage telemetry is enabled. Run `nominal telemetry status` to see what\n' +
      'gets sent, or `nominal telemetry disable` to opt out.\n\n'
  );
  markFirstRunNoticeShown();
}

function removeFirstNNonFlags(
  argv: string[],
  n: number,
  globalOptions: typeof GLOBAL_OPTIONS
): string[] {
  const result: string[] = [];
  let skipped = 0;
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === '--') {
      result.push(...argv.slice(i));
      break;
    }
    if (token.startsWith('-')) {
      const hasInlineValue = token.includes('=');
      result.push(token);
      if (!hasInlineValue) {
        const isBool = isBooleanFlag(token, globalOptions);
        if (!isBool && i + 1 < argv.length) {
          const next = argv[i + 1]!;
          if (!next.startsWith('-') || /^-\d/.test(next)) {
            result.push(next);
            i++;
          }
        }
      }
      i++;
      continue;
    }
    if (skipped < n) {
      skipped++;
      i++;
      continue;
    }
    result.push(token);
    i++;
  }
  return result;
}

function isBooleanFlag(token: string, options: typeof GLOBAL_OPTIONS): boolean {
  const name = token.split('=')[0]!;
  for (const opt of options) {
    const match = opt.flag.match(/--([a-z0-9-]+)/i);
    if (!match) continue;
    const fullName = `--${match[1]}`;
    if (fullName === name || opt.short === name) {
      const type = opt.type ?? (opt.flag.includes('<') ? 'string' : 'boolean');
      return type === 'boolean';
    }
  }
  return false;
}

run().catch((err) => {
  try {
    const config = loadConfig({} as GlobalFlags);
    handleError(err, config);
  } catch {
    if (err instanceof CLIError) {
      process.stderr.write(`Error: ${err.message}\n`);
      if (err.hint) process.stderr.write(`Hint: ${err.hint}\n`);
      process.exit(err.exitCode);
    } else {
      process.stderr.write(`Error: ${String(err)}\n`);
      process.exit(1);
    }
  }
});
