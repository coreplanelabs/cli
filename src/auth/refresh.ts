import type { Config } from '../config/schema';
import type { OAuthCredential, OAuthTokenResponse } from './types';
import { DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from './oauth';
import { writeCredentials } from './credentials';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isTokenExpiringSoon(cred: OAuthCredential): boolean {
  const expiresAt = new Date(cred.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - Date.now() < EXPIRY_BUFFER_MS;
}

export async function refreshToken(
  config: Config,
  cred: OAuthCredential
): Promise<OAuthCredential> {
  const url = `https://${config.domain}/v1/oauth/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: cred.refreshToken,
      client_id: DEFAULT_CLIENT_ID,
      client_secret: DEFAULT_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new CLIError(
      `Token refresh failed: ${res.status}`,
      ExitCode.AUTH,
      'Run `nominal auth login` to re-authenticate'
    );
  }

  const data = (await res.json()) as OAuthTokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  const updated: OAuthCredential = {
    type: 'oauth',
    accessToken: data.access_token,
    refreshToken: data.refresh_token || cred.refreshToken,
    expiresAt,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || cred.scope,
    account: cred.account,
  };

  writeCredentials(updated);
  return updated;
}
