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
  if (v === '' || v === '0' || v === 'false' || v === 'no') return false;
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
    env.NOMINAL_API_DOMAIN ??
    file.domain ??
    DEFAULT_DOMAIN;
  validateDomain(domain);

  const apiKey = flags.apiKey ?? env.NOMINAL_API_KEY ?? file.api_key;
  if (apiKey !== undefined) validateApiKey(apiKey);

  const workspaceId = flags.workspace ?? env.NOMINAL_WORKSPACE_ID ?? file.workspace_id;
  if (workspaceId !== undefined) validateWorkspaceId(workspaceId);

  const timeout =
    flags.timeout ?? parseEnvNumber(env.NOMINAL_TIMEOUT) ?? file.timeout ?? DEFAULT_TIMEOUT;
  validateTimeout(timeout);

  const output = detectOutputFormat(flags.output, env.NOMINAL_OUTPUT, file.output);
  validateOutput(output);

  const verbose = flags.verbose ?? parseEnvBoolean(env.NOMINAL_VERBOSE) ?? false;
  const quiet = flags.quiet ?? false;
  const noColor = flags.noColor ?? Boolean(env.NO_COLOR);
  const dryRun = flags.dryRun ?? false;
  const nonInteractive = flags.nonInteractive ?? false;

  // Telemetry precedence: DO_NOT_TRACK (universal opt-out) → NOMINAL_TELEMETRY
  // env var → config file → default on. No CLI flag; telemetry is a per-install
  // choice, not a per-invocation one.
  const telemetry = ((): boolean => {
    if (parseEnvBoolean(env.DO_NOT_TRACK) === true) return false;
    const fromEnv = parseEnvBoolean(env.NOMINAL_TELEMETRY);
    if (fromEnv !== undefined) return fromEnv;
    if (file.telemetry !== undefined) return file.telemetry;
    return true;
  })();

  return {
    apiKey,
    domain,
    workspaceId,
    output,
    timeout,
    verbose,
    quiet,
    noColor,
    dryRun,
    nonInteractive,
    telemetry,
  };
}
