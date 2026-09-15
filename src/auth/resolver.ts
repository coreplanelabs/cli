import type { Config } from '../config/schema';
import type { Credential } from './types';
import { readCredentials } from './credentials';
import { isTokenExpiringSoon, refreshToken } from './refresh';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

// Precedence: --api-key flag > POLYLANE_API_KEY > ~/.polylane/credentials.json
// (OAuth) > ~/.polylane/config.json api_key. The env var sits above the
// credentials file on purpose: a CI runner exporting POLYLANE_API_KEY must not
// be silently overridden by a stale OAuth token left on disk.
export async function resolveCredential(config: Config): Promise<Credential> {
  // 1. Flag-provided api key
  if (process.argv.includes('--api-key') || process.argv.some((a) => a.startsWith('--api-key='))) {
    if (config.apiKey) {
      return { type: 'api-key', key: config.apiKey, source: 'flag' };
    }
  }

  // 2. Env var
  if (process.env.POLYLANE_API_KEY) {
    return { type: 'api-key', key: process.env.POLYLANE_API_KEY, source: 'env' };
  }

  // 3. OAuth credentials on disk
  const stored = readCredentials();
  if (stored) {
    if (isTokenExpiringSoon(stored)) {
      try {
        return await refreshToken(config, stored);
      } catch {
        // Fall through
      }
    } else {
      return stored;
    }
  }

  // 4. Config file
  if (config.apiKey) {
    return { type: 'api-key', key: config.apiKey, source: 'config' };
  }

  throw new CLIError(
    'Not signed in.',
    ExitCode.AUTH,
    'Run `polylane auth login`'
  );
}

export function getAuthHeader(cred: Credential): Record<string, string> {
  if (cred.type === 'api-key') {
    return { 'x-api-key': cred.key };
  }
  return { Authorization: `${cred.tokenType} ${cred.accessToken}` };
}

export async function tryResolveCredential(config: Config): Promise<Credential | null> {
  try {
    return await resolveCredential(config);
  } catch {
    return null;
  }
}
