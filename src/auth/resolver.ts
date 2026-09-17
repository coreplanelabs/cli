import type { Config } from '../config/schema';
import type { Credential } from './types';
import { readCredentials } from './credentials';
import { isTokenExpiringSoon, refreshToken } from './refresh';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

// Precedence: --api-key flag > POLYLANE_API_KEY > ~/.polylane/credentials.json
// (OAuth) > ~/.polylane/config.json api_key. The env var sits above the
// credentials file on purpose: a CI runner exporting POLYLANE_API_KEY must not
// be silently overridden by a stale OAuth token left on disk. The loader
// records which layer supplied config.apiKey; argv is never consulted here,
// since a command's own `--api-key` (a provider key) is not the Polylane key.
export async function resolveCredential(config: Config): Promise<Credential> {
  // 1. Flag or env api key
  if (config.apiKey && (config.apiKeySource === 'flag' || config.apiKeySource === 'env')) {
    return { type: 'api-key', key: config.apiKey, source: config.apiKeySource };
  }

  // 2. OAuth credentials on disk
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

  // 3. Config file
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
