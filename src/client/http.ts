import type { Config } from '../config/schema';
import { resolveCredential, getAuthHeader } from '../auth/resolver';
import { mapApiError, type ApiErrorPayload } from '../errors/api';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { maskToken } from '../utils/token';
import { showStatusBar } from '../output/status-bar';
import { recordHttpRequest } from '../telemetry/http-counter';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | string[] | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RequestOpts {
  url: string;
  method?: HttpMethod;
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  timeout?: number;
  noAuth?: boolean;
}

interface ApiEnvelope<T> {
  message: { message: string } | null;
  success: boolean;
  error: ApiErrorPayload | null;
  result: T;
}

let cachedVersion: string | null = null;

function getVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    cachedVersion = pkg.version;
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function buildQueryString(query: Query): string {
  const params: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        params.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    } else {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return params.length > 0 ? '?' + params.join('&') : '';
}

function logVerbose(config: Config, direction: '>' | '<', message: string): void {
  if (!config.verbose) return;
  const dim = config.noColor ? (s: string): string => s : (s: string): string => `\x1B[2m${s}\x1B[0m`;
  process.stderr.write(dim(`${direction} ${message}\n`));
}

export async function request(config: Config, opts: RequestOpts): Promise<Response> {
  showStatusBar(config);

  const method = opts.method ?? 'GET';
  const baseUrl = `https://${config.domain}`;
  const path = opts.url.startsWith('http') ? opts.url : baseUrl + opts.url;
  const query = opts.query ? buildQueryString(opts.query) : '';
  const fullUrl = path + query;

  const headers: Record<string, string> = {
    'User-Agent': `nominal-cli/${getVersion()}`,
    'x-nominal-client': 'cli',
    'x-nominal-client-version': getVersion(),
    ...opts.headers,
  };

  if (!opts.noAuth) {
    const cred = await resolveCredential(config);
    Object.assign(headers, getAuthHeader(cred));
  }

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

  logVerbose(config, '>', `${method} ${fullUrl}`);
  if (headers['x-api-key']) {
    logVerbose(config, '>', `x-api-key: ${maskToken(headers['x-api-key'])}`);
  }
  if (headers['Authorization']) {
    const token = headers['Authorization'].replace(/^Bearer\s+/i, '');
    logVerbose(config, '>', `Authorization: Bearer ${maskToken(token)}`);
  }

  if (config.dryRun) {
    logVerbose(config, '>', '[dry-run] skipping request');
    return new Response(JSON.stringify({ message: { message: 'dry-run' }, success: true, error: null, result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const timeout = (opts.timeout ?? config.timeout) * 1000;
  const signal = AbortSignal.timeout(timeout);

  let res: Response;
  const httpStart = Date.now();
  try {
    res = await fetch(fullUrl, { method, headers, body, signal });
    recordHttpRequest(Date.now() - httpStart);
  } catch (err) {
    recordHttpRequest(Date.now() - httpStart);
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new CLIError('Request timed out', ExitCode.TIMEOUT, 'Try increasing --timeout');
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CLIError('Request aborted', ExitCode.TIMEOUT);
    }
    if (err instanceof TypeError) {
      throw new CLIError(
        `Network error: ${err.message}`,
        ExitCode.NETWORK,
        `Check your network and --domain=${config.domain}`
      );
    }
    throw err;
  }

  logVerbose(config, '<', `${res.status} ${res.statusText}`);
  return res;
}

export async function requestJson<T>(config: Config, opts: RequestOpts): Promise<T> {
  const res = await request(config, opts);

  if (config.dryRun) {
    return {} as T;
  }

  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new CLIError(
      `Invalid JSON response from server (status ${res.status})`,
      ExitCode.GENERAL
    );
  }

  if (!res.ok || !json.success) {
    throw mapApiError(res.status, json.error);
  }

  return json.result;
}
