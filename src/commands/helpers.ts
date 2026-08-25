import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import {
  BACK,
  promptText,
  promptSelect,
  promptTextOrBack,
  promptSelectOrBack,
  promptPasswordOrBack,
  promptConfirmOrBack,
  note,
} from '../utils/prompt';
import { isInteractive } from '../utils/env';
import { openBrowser } from '../utils/browser';
import { Spinner } from '../output/progress';
import { consoleBaseUrl } from '../auth/oauth';

export async function requireWorkspace(config: Config): Promise<string> {
  if (config.workspaceId) return config.workspaceId;
  throw new CLIError(
    'No workspace set',
    ExitCode.USAGE,
    'polylane workspace use <id>                     (set default)\n' +
      '        --workspace <id>                              (one-shot)\n' +
      '        POLYLANE_WORKSPACE_ID=<id>                     (environment variable)\n' +
      'List workspaces with: polylane workspace list'
  );
}

export function getPositional(args: Record<string, unknown>, index: number): string | undefined {
  const positional = args._;
  if (!Array.isArray(positional)) return undefined;
  const v = positional[index];
  return typeof v === 'string' ? v : undefined;
}

export function getAllPositional(args: Record<string, unknown>): string[] {
  const positional = args._;
  if (!Array.isArray(positional)) return [];
  return positional.filter((v): v is string => typeof v === 'string');
}

export function requirePositional(
  args: Record<string, unknown>,
  index: number,
  name: string
): string {
  const v = getPositional(args, index);
  if (v === undefined || v === '') {
    throw new CLIError(`Missing required argument: <${name}>`, ExitCode.USAGE);
  }
  return v;
}

export function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*(ms|s|m|h|d|w)?$/i);
  if (!match) {
    throw new CLIError(
      `Invalid duration: "${value}"`,
      ExitCode.USAGE,
      'Use a duration like 30m, 1h, 24h, or 7d'
    );
  }
  const n = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return n * (multipliers[unit] ?? 1000);
}

export function requireArg(
  args: Record<string, unknown>,
  key: string,
  flag: string
): string {
  const value = args[key];
  if (typeof value === 'string' && value.length > 0) return value;
  throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
}

export async function promptIfMissing(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  message: string,
  flag: string
): Promise<string> {
  const v = args[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (!isInteractive(config.nonInteractive)) {
    throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
  }
  return promptText({ nonInteractive: config.nonInteractive }, message);
}

// Flag value wins; otherwise show a select. With `strict`, a flag value outside
// the options is a usage error (for closed API unions like regions).
export async function promptChoice<T extends string>(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  flag: string,
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>,
  opts: { strict?: boolean } = {}
): Promise<T> {
  const fromFlag = getArgString(args, key);
  if (fromFlag !== undefined) {
    if (opts.strict && !options.some((o) => o.value === fromFlag)) {
      throw new CLIError(
        `Invalid value for ${flag}: "${fromFlag}"`,
        ExitCode.USAGE,
        `Use one of: ${options.map((o) => o.value).join(', ')}`
      );
    }
    return fromFlag as T;
  }
  if (!isInteractive(config.nonInteractive)) {
    throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
  }
  return promptSelect<T>({ nonInteractive: config.nonInteractive }, message, options);
}

export const SKIPPED = Symbol('skipped');

export type WizardStep = () => Promise<typeof BACK | typeof SKIPPED | void>;

// Runs wizard steps in order. A step returns BACK when the user backs out of
// its prompt, and SKIPPED when it didn't prompt (value already provided by a
// flag), so walking backwards lands on the previous step that actually
// prompted. Returns false when the user backs out of the wizard entirely.
export async function runSteps(steps: WizardStep[]): Promise<boolean> {
  let i = 0;
  let direction: 1 | -1 = 1;
  while (i < steps.length) {
    const outcome = await steps[i]!();
    if (outcome === BACK) direction = -1;
    else if (outcome !== SKIPPED) direction = 1;
    i += direction;
    if (i < 0) return false;
  }
  return true;
}

export function textStep(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  message: string,
  flag: string,
  set: (value: string) => void
): WizardStep {
  return async () => {
    const fromFlag = args[key];
    if (typeof fromFlag === 'string' && fromFlag.length > 0) {
      set(fromFlag);
      return SKIPPED;
    }
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
    }
    const value = await promptTextOrBack({ nonInteractive: config.nonInteractive }, message);
    if (value === BACK) return BACK;
    set(value);
    return;
  };
}

export function choiceStep<T extends string>(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  flag: string,
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>,
  set: (value: T) => void,
  opts: { strict?: boolean } = {}
): WizardStep {
  return async () => {
    const fromFlag = getArgString(args, key);
    if (fromFlag !== undefined) {
      if (opts.strict && !options.some((o) => o.value === fromFlag)) {
        throw new CLIError(
          `Invalid value for ${flag}: "${fromFlag}"`,
          ExitCode.USAGE,
          `Use one of: ${options.map((o) => o.value).join(', ')}`
        );
      }
      set(fromFlag as T);
      return SKIPPED;
    }
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
    }
    const value = await promptSelectOrBack<T>({ nonInteractive: config.nonInteractive }, message, options);
    if (value === BACK) return BACK;
    set(value);
    return;
  };
}

export interface SecretPromptOptions {
  message: string;
  instructions: string;
  link: string;
  linkLabel: string;
}

// Mirrors the console connect flows: short instructions and a direct link to
// the page where the credential is created — with an offer to open it in the
// browser — then a hidden input to paste the credential. Options can be a
// thunk when they depend on values from earlier steps.
export function secretStep(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  flag: string,
  opts: SecretPromptOptions | (() => SecretPromptOptions),
  set: (value: string) => void
): WizardStep {
  return async () => {
    const fromFlag = getArgString(args, key);
    if (fromFlag !== undefined) {
      set(fromFlag);
      return SKIPPED;
    }
    if (!isInteractive(config.nonInteractive)) {
      const resolved = typeof opts === 'function' ? opts() : opts;
      throw new CLIError(
        `Missing required flag: ${flag}`,
        ExitCode.USAGE,
        `${resolved.linkLabel}: ${resolved.link}`
      );
    }
    const resolved = typeof opts === 'function' ? opts() : opts;
    note(
      `You need to create a credential and paste it here.\n\n${resolved.instructions}\n\n${resolved.linkLabel}:\n  ${resolved.link}`,
      resolved.message
    );
    const open = await promptConfirmOrBack(
      { nonInteractive: config.nonInteractive },
      `Open ${resolved.link} in your browser?`,
      true
    );
    if (open === BACK) return BACK;
    if (open) openBrowser(resolved.link);
    const value = await promptPasswordOrBack(
      { nonInteractive: config.nonInteractive },
      `${resolved.message} (paste it here)`
    );
    if (value === BACK) return BACK;
    set(value);
    return;
  };
}

// Browser connect flows enter through the console's /cli/connect page: it
// marks the browser session as CLI-initiated (cookie), generates the provider
// install URL, and forwards to it — so the flow ends on the console's
// "go back to your terminal" page instead of the workspace dashboard.
export function cliConnectUrl(config: Config, flow: string, workspaceId: string): string {
  return `${consoleBaseUrl(config)}/cli/connect?flow=${encodeURIComponent(flow)}&workspace=${encodeURIComponent(workspaceId)}`;
}

// After a connect flow hands off to the browser, the terminal session should
// not just end — keep it alive and poll until the connection shows up
// server-side, so the user comes back to a confirmation instead of a dead
// prompt.
// A step that wants Ctrl+C to mean "stop this step" instead of "kill the CLI" has to displace
// main.ts's global SIGINT handler for its duration: Node runs same-event listeners in
// registration order, so a later process.once() never gets a turn before the global exit(130).
export function scopedSigint(onSigint: () => void): () => void {
  const prior = process.listeners('SIGINT');
  process.removeAllListeners('SIGINT');
  process.once('SIGINT', onSigint);
  return () => {
    process.removeListener('SIGINT', onSigint);
    for (const listener of prior) process.on('SIGINT', listener as (...args: unknown[]) => void);
  };
}

export function canWaitForBrowser(config: Config): boolean {
  return !config.dryRun && config.output !== 'json' && isInteractive(config.nonInteractive);
}

export async function waitForBrowserCompletion<T>(
  config: Config,
  check: () => Promise<T | null>,
  opts: { waitingFor: string; interruptHint: string; startHint?: string; timeoutMs?: number; intervalMs?: number }
): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  if (!config.quiet) {
    process.stderr.write(`\n${opts.startHint ?? 'Finish in the browser, then come back to this terminal.'}\n`);
  }
  const spinner = new Spinner(`Waiting for ${opts.waitingFor}… (Ctrl+C to stop waiting)`);
  const onSigint = (): void => {
    spinner.stop(`Stopped waiting. The browser setup continues on its own. ${opts.interruptHint}`);
    process.exit(0);
  };
  spinner.start();
  const restoreSigint = scopedSigint(onSigint);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
      let found: T | null = null;
      try {
        found = await check();
      } catch {
        // Transient poll failures (e.g. 404 until the resource exists) are
        // expected — keep waiting.
      }
      if (found) {
        spinner.stop();
        return found;
      }
    }
    spinner.stop();
    return null;
  } catch (err) {
    spinner.fail();
    throw err;
  } finally {
    restoreSigint();
  }
}

export interface BackgroundCompletion<T> {
  peek: () => T | null;
  stop: () => void;
}

// Poll a check in the background without holding the terminal: nothing is
// written while a prompt may be active — callers read progress with peek()
// between prompts. Timers are unref'd so a finished command never waits on
// the poller; stop() before any foreground wait takes over the same check.
export function startBackgroundCompletion<T>(
  check: () => Promise<T | null>,
  intervalMs: number
): BackgroundCompletion<T> {
  let found: T | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async (): Promise<void> => {
    timer = null;
    let result: T | null = null;
    try {
      result = await check();
    } catch {
      // Transient poll failures are expected — keep polling.
    }
    if (stopped || found) return;
    if (result) {
      found = result;
      return;
    }
    schedule();
  };
  const schedule = (): void => {
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref();
  };
  schedule();
  return {
    peek: () => found,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function getArgString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function getArgNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

export function getArgBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function getArgArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (Array.isArray(v)) {
    return v.filter((item): item is string => typeof item === 'string');
  }
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

export function buildListQuery(flags: GlobalFlags): {
  perPage?: number;
  page?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
} {
  const q: {
    perPage?: number;
    page?: number;
    orderBy?: string;
    order?: 'asc' | 'desc';
  } = {};
  if (flags.perPage !== undefined) q.perPage = flags.perPage;
  if (flags.page !== undefined) q.page = flags.page;
  if (flags.orderBy !== undefined) q.orderBy = flags.orderBy;
  if (flags.order !== undefined) q.order = flags.order;
  return q;
}

export function parseJsonArg(raw: string | undefined, flag: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CLIError(`Invalid JSON in ${flag}: ${msg}`, ExitCode.USAGE);
  }
}
