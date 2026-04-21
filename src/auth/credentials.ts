import { CREDENTIALS_FILE, ensureConfigDir } from '../config/paths';
import type { OAuthCredential, StoredOAuthCredential } from './types';
import { readJsonFile, writeJsonFile, deleteFile, getFileMode } from '../utils/fs';

export function readCredentials(): OAuthCredential | null {
  const stored = readJsonFile<StoredOAuthCredential>(CREDENTIALS_FILE);
  if (!stored) return null;
  if (
    typeof stored.access_token !== 'string' ||
    typeof stored.refresh_token !== 'string' ||
    typeof stored.expires_at !== 'string'
  ) {
    return null;
  }
  const mode = getFileMode(CREDENTIALS_FILE);
  if (mode !== null && mode !== 0o600) {
    process.stderr.write(
      `Warning: ${CREDENTIALS_FILE} has loose permissions (${mode.toString(8)}). Expected 600.\n`
    );
  }
  return {
    type: 'oauth',
    accessToken: stored.access_token,
    refreshToken: stored.refresh_token,
    expiresAt: stored.expires_at,
    tokenType: stored.token_type || 'Bearer',
    scope: stored.scope || '',
    account: stored.account,
  };
}

export function writeCredentials(cred: OAuthCredential): void {
  ensureConfigDir();
  const stored: StoredOAuthCredential = {
    access_token: cred.accessToken,
    refresh_token: cred.refreshToken,
    expires_at: cred.expiresAt,
    token_type: cred.tokenType,
    scope: cred.scope,
    ...(cred.account ? { account: cred.account } : {}),
  };
  writeJsonFile(CREDENTIALS_FILE, stored, 0o600);
}

export function deleteCredentials(): boolean {
  return deleteFile(CREDENTIALS_FILE);
}
