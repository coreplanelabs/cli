import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import { promptPassword, promptSelect, intro, outro } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';
import { oauthBrowserFlow, oauthDeviceCodeFlow } from '../../auth/oauth';
import { writeCredentials } from '../../auth/credentials';
import type { OAuthCredential } from '../../auth/types';
import { writeConfigFile } from '../../config/loader';
import { request, requestJson } from '../../client/http';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { Spinner } from '../../output/progress';

interface WhoamiResult {
  id: string;
  forename?: string;
  surname?: string | null;
  email?: string;
  username?: string;
}

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
}

async function validateApiKey(config: Config, key: string): Promise<WhoamiResult> {
  const spinner = new Spinner('Validating API key');
  spinner.start();
  try {
    const res = await request(
      { ...config, apiKey: key },
      {
        method: 'GET',
        url: '/v1/auth/whoami',
        headers: { 'x-api-key': key },
        noAuth: true,
      }
    );
    if (!res.ok) {
      spinner.stop();
      throw new CLIError(`API key validation failed: ${res.status}`, ExitCode.AUTH);
    }
    const json = (await res.json()) as {
      success: boolean;
      result: WhoamiResult;
      error: { message: string; detail?: string } | null;
    };
    if (!json.success) {
      spinner.stop();
      throw new CLIError(
        json.error?.detail || json.error?.message || 'Invalid API key',
        ExitCode.AUTH
      );
    }
    spinner.stop();
    return json.result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

async function selectWorkspace(config: Config, user: WhoamiResult): Promise<string | undefined> {
  const spinner = new Spinner('Fetching workspaces');
  spinner.start();
  try {
    const list = await requestJson<{ items: WorkspaceItem[]; count: number }>(
      config,
      { method: 'GET', url: '/v1/workspaces', query: { perPage: 100 } }
    );
    spinner.stop();
    if (list.items.length === 0) {
      process.stderr.write(`No workspaces found for ${user.email ?? user.id}\n`);
      return undefined;
    }
    if (list.items.length === 1) {
      const ws = list.items[0]!;
      process.stderr.write(`Using workspace: ${ws.name} (${ws.id})\n`);
      return ws.id;
    }
    if (!isInteractive(config.nonInteractive)) {
      return undefined;
    }
    const selected = await promptSelect<string>(
      { nonInteractive: config.nonInteractive },
      'Select default workspace',
      list.items.map((ws) => ({
        value: ws.id,
        label: ws.name,
        hint: ws.id,
      }))
    );
    return selected;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

async function apiKeyLogin(config: Config, key: string): Promise<void> {
  const user = await validateApiKey(config, key);

  const name = user.forename ? `${user.forename}${user.surname ? ' ' + user.surname : ''}` : user.email ?? user.id;
  process.stderr.write(`\nAuthenticated as ${name} (${user.email ?? user.id})\n`);

  const configWithKey: Config = { ...config, apiKey: key };
  const wsId = await selectWorkspace(configWithKey, user);

  writeConfigFile({
    api_key: key,
    ...(wsId ? { workspace_id: wsId } : {}),
  });

  outro(`API key saved to ~/.nominal/config.json`);
}

async function oauthLogin(config: Config, useBrowser: boolean): Promise<void> {
  const tokens = useBrowser ? await oauthBrowserFlow(config) : await oauthDeviceCodeFlow(config);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const userRes = await fetch(`https://${config.domain}/v1/oauth/userinfo`, {
    headers: { Authorization: `${tokens.token_type} ${tokens.access_token}` },
  });
  let account: string | undefined;
  if (userRes.ok) {
    const info = (await userRes.json()) as { email?: string; sub?: string; name?: string };
    account = info.email ?? info.name ?? info.sub;
  }

  const cred: OAuthCredential = {
    type: 'oauth',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    ...(account ? { account } : {}),
  };
  writeCredentials(cred);

  const configWithAuth: Config = { ...config };
  try {
    const user = await requestJson<WhoamiResult>(configWithAuth, {
      method: 'GET',
      url: '/v1/auth/whoami',
    });
    const name = user.forename ? `${user.forename}${user.surname ? ' ' + user.surname : ''}` : user.email ?? user.id;
    process.stderr.write(`\nAuthenticated as ${name} (${user.email ?? user.id})\n`);
    const wsId = await selectWorkspace(configWithAuth, user);
    if (wsId) {
      writeConfigFile({ workspace_id: wsId });
    }
  } catch {
    // non-fatal
  }

  outro(`Credentials saved to ~/.nominal/credentials.json`);
}

export const authLoginCommand: Command = {
  name: 'auth login',
  description: 'Authenticate with Nominal',
  operationId: 'auth.login',
  options: [
    { flag: '--api-key <key>', description: 'Authenticate with an API key directly', type: 'string' },
    { flag: '--no-browser', description: 'Use device code OAuth flow (for SSH/headless)', type: 'boolean' },
  ],
  examples: [
    'nominal auth login',
    'nominal auth login --api-key sk_...',
    'nominal auth login --no-browser',
  ],
  async execute(config: Config, flags: GlobalFlags, args: Record<string, unknown>): Promise<void> {
    intro('Nominal login');

    const apiKey = typeof args.apiKey === 'string' ? args.apiKey : config.apiKey;
    const noBrowser = args.noBrowser === true || flags.nonInteractive === true;

    if (apiKey) {
      await apiKeyLogin(config, apiKey);
      return;
    }

    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(
        'No API key provided and not running interactively',
        ExitCode.USAGE,
        'Pass --api-key or run in a TTY'
      );
    }

    const method = await promptSelect<'browser' | 'device' | 'api-key'>(
      { nonInteractive: config.nonInteractive },
      'How would you like to authenticate?',
      [
        { value: 'browser', label: 'OAuth (browser)', hint: 'Recommended' },
        { value: 'device', label: 'OAuth (device code)', hint: 'For SSH/headless' },
        { value: 'api-key', label: 'API key', hint: 'For scripts / CI' },
      ]
    );

    if (method === 'api-key') {
      const key = await promptPassword({ nonInteractive: config.nonInteractive }, 'Enter API key');
      await apiKeyLogin(config, key);
      return;
    }

    if (noBrowser || method === 'device') {
      await oauthLogin(config, false);
      return;
    }

    await oauthLogin(config, true);

    // Suppress unused-variable lint when we don't use args later
    void flags;
  },
};
