import { CONFIG_FILE, ensureConfigDir } from './paths';
import {
  type Config,
  type RawConfig,
  DEFAULT_DOMAIN,
  DEFAULT_TIMEOUT,
  validateDomain,
  validateOutput,
  validateTimeout,
  validateApiKey,
  validateWorkspaceId,
} from './schema';
import type { GlobalFlags, OutputFormat } from '../types/flags';
import { readJsonFile, writeJsonFile } from '../utils/fs';
import { isStdoutTTY } from '../utils/env';
import { isAgentId } from '../agents/registry';

export function loadConfigFile(): RawConfig | null {
  return readJsonFile<RawConfig>(CONFIG_FILE);
}

export function writeConfigFile(partial: Partial<RawConfig>): void {
  ensureConfigDir();
  const existing = loadConfigFile() ?? {};
  const next: RawConfig = { ...existing, ...partial };
  writeJsonFile(CONFIG_FILE, next, 0o600);
}

export function replaceConfigFile(next: RawConfig): void {
  ensureConfigDir();
  writeJsonFile(CONFIG_FILE, next, 0o600);
}

function parseEnvNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseEnvBoolean(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  // 'off' and case-insensitivity match what the README has always documented
  // for POLYLANE_TELEMETRY (and now POLYLANE_HINTS).
  const norm = v.toLowerCase();
  if (norm === '' || norm === '0' || norm === 'false' || norm === 'no' || norm === 'off') return false;
  return true;
}

function detectOutputFormat(
  flag: OutputFormat | undefined,
  envValue: string | undefined,
  fileValue: OutputFormat | undefined
): OutputFormat {
  if (flag !== undefined) return flag;
  if (envValue === 'text' || envValue === 'json') return envValue;
  if (fileValue !== undefined) return fileValue;
  return isStdoutTTY() ? 'text' : 'json';
}

export function loadConfig(flags: GlobalFlags): Config {
  const file = loadConfigFile() ?? {};
  const env = process.env;

  const domain =
    flags.domain ??
    env.POLYLANE_API_DOMAIN ??
    file.domain ??
    DEFAULT_DOMAIN;
  validateDomain(domain);

  const apiKey = flags.apiKey ?? env.POLYLANE_API_KEY ?? file.api_key;
  if (apiKey !== undefined) validateApiKey(apiKey);

  const workspaceId = flags.workspace ?? env.POLYLANE_WORKSPACE_ID ?? file.workspace_id;
  if (workspaceId !== undefined) validateWorkspaceId(workspaceId);

  // Primary coding agent. Unknown ids are dropped rather than thrown so a
  // stale stored value (e.g. an id removed from the registry) never bricks
  // every invocation; `config set --key agent` is where strict validation happens.
  const agentRaw = env.POLYLANE_AGENT ?? file.agent;
  const agent = agentRaw !== undefined && isAgentId(agentRaw) ? agentRaw : undefined;

  const timeout =
    flags.timeout ?? parseEnvNumber(env.POLYLANE_TIMEOUT) ?? file.timeout ?? DEFAULT_TIMEOUT;
  validateTimeout(timeout);

  const output = detectOutputFormat(flags.output, env.POLYLANE_OUTPUT, file.output);
  validateOutput(output);

  const verbose = flags.verbose ?? parseEnvBoolean(env.POLYLANE_VERBOSE) ?? false;
  const quiet = flags.quiet ?? false;
  const noColor = flags.noColor ?? Boolean(env.NO_COLOR);
  const dryRun = flags.dryRun ?? false;
  const nonInteractive = flags.nonInteractive ?? false;

  // Telemetry precedence: DO_NOT_TRACK (universal opt-out) → POLYLANE_TELEMETRY
  // env var → config file → default on. No CLI flag; telemetry is a per-install
  // choice, not a per-invocation one.
  const telemetry = ((): boolean => {
    if (parseEnvBoolean(env.DO_NOT_TRACK) === true) return false;
    const fromEnv = parseEnvBoolean(env.POLYLANE_TELEMETRY);
    if (fromEnv !== undefined) return fromEnv;
    if (file.telemetry !== undefined) return file.telemetry;
    return true;
  })();

  // Hints are next-step guidance for humans. An orchestrator that owns the
  // journey (e.g. the install script) sets POLYLANE_HINTS=0 so commands stay
  // composable inside its flow. Same boolean model as telemetry: env → config
  // file → default on. No CLI flag until a per-invocation need shows up.
  const hints = ((): boolean => {
    const fromEnv = parseEnvBoolean(env.POLYLANE_HINTS);
    if (fromEnv !== undefined) return fromEnv;
    if (file.hints !== undefined) return file.hints;
    return true;
  })();

  return {
    apiKey,
    domain,
    workspaceId,
    agent,
    output,
    timeout,
    verbose,
    quiet,
    noColor,
    dryRun,
    nonInteractive,
    telemetry,
    hints,
  };
}
