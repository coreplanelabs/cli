import type { OutputFormat } from '../types/flags';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

export interface Config {
  apiKey?: string;
  domain: string;
  workspaceId?: string;
  output: OutputFormat;
  timeout: number;
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
  dryRun: boolean;
  nonInteractive: boolean;
  telemetry: boolean;
}

export interface RawConfig {
  api_key?: string;
  domain?: string;
  workspace_id?: string;
  output?: OutputFormat;
  timeout?: number;
  telemetry?: boolean;
}

// process.env.NOMINAL_API_DOMAIN is replaced at build time via esbuild define
// when a .env.local override is present; otherwise it's read at runtime.
export const DEFAULT_DOMAIN = process.env.NOMINAL_API_DOMAIN || 'api.nominal.dev';
export const DEFAULT_TIMEOUT = 300;

const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const WORKSPACE_ID_PATTERN = /^ws_[0-9a-z]{32}$/;

export function validateDomain(v: string): void {
  if (!v || v.trim().length === 0) {
    throw new CLIError('Domain cannot be empty', ExitCode.USAGE);
  }
  if (v.startsWith('http://') || v.startsWith('https://')) {
    throw new CLIError(
      `Domain must not include a protocol: got "${v}"`,
      ExitCode.USAGE,
      'Use the hostname only, e.g. "api.nominal.dev"'
    );
  }
  if (!HOSTNAME_PATTERN.test(v)) {
    throw new CLIError(`Invalid domain: "${v}"`, ExitCode.USAGE);
  }
}

export function validateOutput(v: string): asserts v is OutputFormat {
  if (v !== 'text' && v !== 'json') {
    throw new CLIError(
      `Invalid output format: "${v}"`,
      ExitCode.USAGE,
      'Must be "text" or "json"'
    );
  }
}

export function validateTimeout(v: number): void {
  if (!Number.isFinite(v) || v <= 0) {
    throw new CLIError(
      `Invalid timeout: ${v}`,
      ExitCode.USAGE,
      'Must be a positive number of seconds'
    );
  }
}

export function validateApiKey(v: string): void {
  if (!v || v.trim().length === 0) {
    throw new CLIError('API key cannot be empty', ExitCode.USAGE);
  }
}

export function validateWorkspaceId(v: string): void {
  if (!WORKSPACE_ID_PATTERN.test(v)) {
    throw new CLIError(
      `Invalid workspace ID: "${v}"`,
      ExitCode.USAGE,
      'Must match pattern ws_[0-9a-z]{32}'
    );
  }
}
