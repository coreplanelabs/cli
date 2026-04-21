import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { tryResolveCredential } from '../../auth/resolver';
import { requestJson } from '../../client/http';
import { formatSingle } from '../../output/formatter';
import { maskToken } from '../../utils/token';

interface WhoamiResult {
  id: string;
  forename?: string;
  surname?: string | null;
  email?: string;
  username?: string;
}

export const authStatusCommand: Command = {
  name: 'auth status',
  description: 'Show current authentication status',
  operationId: 'auth.status',
  async execute(config: Config): Promise<void> {
    const cred = await tryResolveCredential(config);

    if (!cred) {
      const result = {
        authenticated: false,
        domain: config.domain,
        workspaceId: config.workspaceId ?? null,
      };
      formatSingle(config, result);
      return;
    }

    let user: WhoamiResult | null = null;
    try {
      user = await requestJson<WhoamiResult>(config, {
        method: 'GET',
        url: '/v1/auth/whoami',
      });
    } catch {
      // Ignore - we'll report what we know
    }

    if (cred.type === 'api-key') {
      const result = {
        authenticated: true,
        method: 'api-key',
        source: cred.source,
        key: maskToken(cred.key),
        domain: config.domain,
        workspaceId: config.workspaceId ?? null,
        user: user
          ? {
              id: user.id,
              name: [user.forename, user.surname].filter(Boolean).join(' ') || user.username || null,
              email: user.email ?? null,
              username: user.username ?? null,
            }
          : null,
      };
      formatSingle(config, result);
      return;
    }

    const expiresAt = new Date(cred.expiresAt).getTime();
    const minutesLeft = Math.max(0, Math.floor((expiresAt - Date.now()) / 60_000));

    const result = {
      authenticated: true,
      method: 'oauth',
      account: cred.account ?? null,
      scope: cred.scope,
      expiresAt: cred.expiresAt,
      minutesLeft,
      accessToken: maskToken(cred.accessToken),
      domain: config.domain,
      workspaceId: config.workspaceId ?? null,
      user: user
        ? {
            id: user.id,
            name: [user.forename, user.surname].filter(Boolean).join(' ') || user.username || null,
            email: user.email ?? null,
            username: user.username ?? null,
          }
        : null,
    };
    formatSingle(config, result);
  },
};
