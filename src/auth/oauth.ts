import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config/schema';
import { openBrowser } from '../utils/browser';
import type { OAuthTokenResponse, OIDCConfig } from './types';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const CALLBACK_PORT = 18991;
const CALLBACK_PATH = '/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const BROWSER_TIMEOUT_MS = 120_000;

export const DEFAULT_CLIENT_ID = process.env.NOMINAL_OAUTH_CLIENT_ID || 'nominal-cli';
export const DEFAULT_CLIENT_SECRET = process.env.NOMINAL_OAUTH_CLIENT_SECRET || '';

// Full set of permission scopes requested by the CLI.
export const DEFAULT_SCOPES = [
  'analytics:export',
  'analytics:read',
  'api_keys:delete',
  'api_keys:read',
  'api_keys:write',
  'audit_logs:export',
  'audit_logs:read',
  'automations:delete',
  'automations:read',
  'automations:write',
  'billing:read',
  'billing:write',
  'cases:delete',
  'cases:read',
  'cases:write',
  'cloud_accounts:delete',
  'cloud_accounts:read',
  'cloud_accounts:write',
  'cloud_infra:delete',
  'cloud_infra:read',
  'cloud_infra:write',
  'datasets:delete',
  'datasets:read',
  'datasets:write',
  'integrations:delete',
  'integrations:read',
  'integrations:write',
  'labels:delete',
  'labels:read',
  'labels:write',
  'memories:delete',
  'memories:read',
  'memories:write',
  'messages:delete',
  'messages:read',
  'messages:write',
  'oauth_clients:delete',
  'oauth_clients:read',
  'oauth_clients:write',
  'ratings:write',
  'repositories:delete',
  'repositories:read',
  'repositories:write',
  'subscriptions:read',
  'subscriptions:write',
  'teams:delete',
  'teams:read',
  'teams:write',
  'telemetry_tokens:delete',
  'telemetry_tokens:read',
  'telemetry_tokens:write',
  'threads:delete',
  'threads:read',
  'threads:write',
  'wikis:delete',
  'wikis:read',
  'wikis:write',
  'workspace_members:delete',
  'workspace_members:read',
  'workspace_members:write',
  'workspaces:delete',
  'workspaces:read',
  'workspaces:write',
].join(' ');

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return randomBytes(16).toString('hex');
}

async function fetchOIDCConfig(domain: string): Promise<OIDCConfig> {
  const url = `https://${domain}/v1/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new CLIError(
      `Failed to fetch OIDC config from ${url}: ${res.status}`,
      ExitCode.NETWORK
    );
  }
  return (await res.json()) as OIDCConfig;
}

// Brand styling: DM Sans, emerald primary, neutral-950 dark bg.
function renderShell(title: string, accent: string, headline: string, body: string, icon: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Nominal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #ffffff;
  --border: rgba(0, 0, 0, 0.08);
  --text: #171717;
  --text-muted: rgba(0, 0, 0, 0.55);
  --accent: ${accent};
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 24px -12px rgba(0, 0, 0, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0a0a;
    --surface: #121212;
    --border: rgba(255, 255, 255, 0.08);
    --text: #fafafa;
    --text-muted: rgba(255, 255, 255, 0.55);
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 24px -12px rgba(0, 0, 0, 0.6);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.wordmark {
  position: fixed;
  top: 24px;
  left: 32px;
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.wordmark::after {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: middle;
  transform: translateY(-1px);
}
.card {
  width: min(420px, calc(100% - 48px));
  padding: 40px 32px 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  text-align: center;
}
.icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.icon svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
h1 {
  margin: 0 0 8px;
  font-weight: 600;
  font-size: 20px;
  letter-spacing: -0.01em;
}
p {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.5;
}
.hint {
  margin-top: 20px;
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
</head>
<body>
  <div class="wordmark">Nominal</div>
  <main class="card">
    <div class="icon">${icon}</div>
    <h1>${headline}</h1>
    <p>${body}</p>
  </main>
</body>
</html>`;
}

const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7.5"/></svg>';
const ALERT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/><circle cx="12" cy="12" r="9"/></svg>';

function renderSuccessHtml(): string {
  return renderShell(
    'Authenticated',
    // Emerald-500 — primary brand accent
    '#10b981',
    'You\u2019re signed in',
    'You can close this tab and return to your terminal.',
    CHECK_ICON
  );
}

function renderErrorHtml(error: string): string {
  const safe = String(error).replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
  return renderShell(
    'Authentication failed',
    // Red-500 from Tailwind default — high-contrast destructive accent
    '#ef4444',
    'Authentication failed',
    safe,
    ALERT_ICON
  );
}

interface BrowserFlowResult {
  code: string;
}

async function startCallbackServer(expectedState: string): Promise<BrowserFlowResult> {
  return new Promise<BrowserFlowResult>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(renderErrorHtml(error));
        server.close();
        reject(new CLIError(`OAuth error: ${error}`, ExitCode.AUTH));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(renderErrorHtml('Missing code or state'));
        server.close();
        reject(new CLIError('OAuth callback missing code or state', ExitCode.AUTH));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(renderErrorHtml('State mismatch'));
        server.close();
        reject(new CLIError('OAuth state mismatch', ExitCode.AUTH));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderSuccessHtml());
      server.close();
      resolve({ code });
    });

    server.listen(CALLBACK_PORT, 'localhost', () => {
      // Server is listening
    });

    server.on('error', (err) => {
      reject(new CLIError(`Failed to start callback server: ${err.message}`, ExitCode.GENERAL));
    });

    setTimeout(() => {
      server.close();
      reject(new CLIError('OAuth flow timed out', ExitCode.TIMEOUT));
    }, BROWSER_TIMEOUT_MS);
  });
}

// The OIDC discovery document points `authorization_endpoint` at the API's
// POST /v1/oauth/authorize (used for consent submission). Browsers need to land
// on the console's Vue page which hosts the consent UI, logs the user in if
// necessary, and then POSTs to that API endpoint on their behalf.
//
// Convention: API lives at api.<root>, console at console.<root>. Override with
// NOMINAL_CONSOLE_DOMAIN if that ever diverges.
function consoleBaseUrl(config: Config): string {
  const override = process.env.NOMINAL_CONSOLE_DOMAIN;
  if (override) return `https://${override}`;
  const host = config.domain.replace(/^api\./, 'console.');
  return `https://${host}`;
}

export async function oauthBrowserFlow(config: Config): Promise<OAuthTokenResponse> {
  const oidc = await fetchOIDCConfig(config.domain);
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  const authUrl = new URL(`${consoleBaseUrl(config)}/oauth/${encodeURIComponent(DEFAULT_CLIENT_ID)}`);
  authUrl.searchParams.set('client_id', DEFAULT_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', DEFAULT_SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('response_type', 'code');

  process.stderr.write(`Opening browser to authenticate...\n`);
  process.stderr.write(`If the browser does not open, visit:\n  ${authUrl.toString()}\n\n`);

  const serverPromise = startCallbackServer(state);
  openBrowser(authUrl.toString());
  const { code } = await serverPromise;

  const tokenRes = await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: DEFAULT_CLIENT_ID,
      client_secret: DEFAULT_CLIENT_SECRET,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new CLIError(`Token exchange failed: ${tokenRes.status} ${body}`, ExitCode.AUTH);
  }
  return (await tokenRes.json()) as OAuthTokenResponse;
}

export async function oauthDeviceCodeFlow(config: Config): Promise<OAuthTokenResponse> {
  const oidc = await fetchOIDCConfig(config.domain);

  // Device authorization endpoint is not in the spec explicitly - we'll use a best-effort approach
  const deviceEndpoint = `https://${config.domain}/v1/oauth/device/code`;
  const initRes = await fetch(deviceEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: DEFAULT_CLIENT_ID,
      scope: DEFAULT_SCOPES,
    }),
  });

  if (!initRes.ok) {
    throw new CLIError(
      `Device code flow not supported by this API (${initRes.status})`,
      ExitCode.AUTH,
      'Use the browser flow instead'
    );
  }

  const deviceData = (await initRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  };

  process.stderr.write(`\nTo authenticate, visit:\n`);
  process.stderr.write(`  ${deviceData.verification_uri}\n\n`);
  process.stderr.write(`And enter the code: ${deviceData.user_code}\n\n`);
  process.stderr.write(`Waiting for authorization...\n`);

  let interval = deviceData.interval * 1000;
  const deadline = Date.now() + deviceData.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const pollRes = await fetch(oidc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceData.device_code,
        client_id: DEFAULT_CLIENT_ID,
        client_secret: DEFAULT_CLIENT_SECRET,
      }),
    });

    if (pollRes.ok) {
      return (await pollRes.json()) as OAuthTokenResponse;
    }

    const errBody = (await pollRes.json().catch(() => ({}))) as { error?: string };
    if (errBody.error === 'authorization_pending') continue;
    if (errBody.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (errBody.error === 'expired_token') {
      throw new CLIError('Device code expired', ExitCode.AUTH, 'Try again');
    }
    throw new CLIError(
      `Device code flow failed: ${errBody.error ?? 'unknown error'}`,
      ExitCode.AUTH
    );
  }

  throw new CLIError('Device code timed out', ExitCode.TIMEOUT);
}

export async function revokeToken(config: Config, token: string): Promise<void> {
  const oidc = await fetchOIDCConfig(config.domain).catch(() => null);
  if (!oidc?.revocation_endpoint) return;
  await fetch(oidc.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      client_id: DEFAULT_CLIENT_ID,
      client_secret: DEFAULT_CLIENT_SECRET,
    }),
  }).catch(() => {
    // Best effort
  });
}
