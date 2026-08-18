import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config/schema';
import { openBrowser } from '../utils/browser';
import { readInstallRef } from '../telemetry/environment';
import { ONBOARDING_RUN_QUERY_PARAM, resolveOnboardingRunId, withOnboardingRun } from './onboarding-run';
import type { OAuthTokenResponse, OIDCConfig } from './types';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const CALLBACK_PORT = 18991;
const CALLBACK_PATH = '/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const BROWSER_TIMEOUT_MS = 120_000;
// Creating an account (provider round-trip + consent) takes longer than a sign-in.
const SIGNUP_BROWSER_TIMEOUT_MS = 300_000;

// The dotted process.env reads below are frozen into the bundle by build.ts's
// esbuild define sweep — they carry the per-release first-party client (CI
// injects the prod id/secret). The reads through the `env` alias are invisible
// to that sweep (esbuild only rewrites syntactic `process.env.X` accesses, the
// same reason loadConfig's env overrides work), so POLYLANE_OAUTH_CLIENT_ID /
// _SECRET set at runtime still override the baked values — required to sign in
// against non-prod environments without a rebuild.
const BAKED_CLIENT_ID = process.env.POLYLANE_OAUTH_CLIENT_ID || 'polylane-cli';
const BAKED_CLIENT_SECRET = process.env.POLYLANE_OAUTH_CLIENT_SECRET || '';
const env = process.env;

export function oauthClientId(): string {
  return env.POLYLANE_OAUTH_CLIENT_ID || BAKED_CLIENT_ID;
}

export function oauthClientSecret(): string {
  return env.POLYLANE_OAUTH_CLIENT_SECRET || BAKED_CLIENT_SECRET;
}

// Full set of permission scopes requested by the CLI.
export const DEFAULT_SCOPES = [
  'analytics:export',
  'analytics:read',
  'api_keys:delete',
  'api_keys:read',
  'api_keys:write',
  'audit_logs:export',
  'audit_logs:read',
  'autofixes:delete',
  'autofixes:read',
  'autofixes:write',
  'automations:delete',
  'automations:read',
  'automations:write',
  'billing:read',
  'billing:write',
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
  'skills:delete',
  'skills:read',
  'skills:write',
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
      `Couldn't fetch the sign-in configuration from ${url} (${res.status})`,
      ExitCode.NETWORK,
      'Check your network and the --domain flag, then try again'
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
<title>${title} | Polylane</title>
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
  <div class="wordmark">Polylane</div>
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
    'Sign-in did not complete',
    // Red-500 from Tailwind default — high-contrast destructive accent
    '#ef4444',
    'Sign-in did not complete',
    `Close this tab and run <code>polylane auth login</code> again from your terminal. (${safe})`,
    ALERT_ICON
  );
}

interface BrowserFlowResult {
  code: string;
}

async function startCallbackServer(expectedState: string, timeoutMs: number): Promise<BrowserFlowResult> {
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
      reject(
        new CLIError(
          `Couldn't start the local sign-in listener: ${err.message}`,
          ExitCode.GENERAL,
          `Check that port ${CALLBACK_PORT} is free, then run \`polylane auth login\` again`
        )
      );
    });

    setTimeout(() => {
      server.close();
      reject(
        new CLIError('Sign-in timed out', ExitCode.TIMEOUT, 'Run `polylane auth login` to try again')
      );
    }, timeoutMs);
  });
}

// The OIDC discovery document points `authorization_endpoint` at the API's
// POST /v1/oauth/authorize (used for consent submission). Browsers need to land
// on the console's Vue page which hosts the consent UI, logs the user in if
// necessary, and then POSTs to that API endpoint on their behalf.
//
// Convention: API lives at api.<root>, console at console.<root>. Override with
// POLYLANE_CONSOLE_DOMAIN if that ever diverges.
export function consoleBaseUrl(config: Config): string {
  const override = process.env.POLYLANE_CONSOLE_DOMAIN;
  if (override) return `https://${override}`;
  const host = config.domain.replace(/^api\./, 'console.');
  return `https://${host}`;
}

export interface BrowserFlowOptions {
  // Open the console signup page first, carrying the consent URL in ?redirect=
  // (the console keeps it alive across the provider round-trip), so a brand-new
  // user creates the account and lands on the consent screen in one browser trip.
  signupEntry?: boolean;
  // Which provider the user picked in the CLI. The signup page ignores it today;
  // sent so the console can auto-start that provider without another click.
  provider?: 'google' | 'github';
}

export interface BrowserFlowUrls {
  authUrl: URL;
  openUrl: URL;
  timeoutMs: number;
}

export function buildBrowserFlowUrls(
  config: Config,
  state: string,
  challenge: string,
  options: BrowserFlowOptions = {}
): BrowserFlowUrls {
  const runId = resolveOnboardingRunId();

  const authUrl = new URL(`${consoleBaseUrl(config)}/oauth/${encodeURIComponent(oauthClientId())}`);
  authUrl.searchParams.set('client_id', oauthClientId());
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', DEFAULT_SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('response_type', 'code');
  // The onboarding run identifier rides the console URLs so the sign-in the
  // browser completes there can bind the pre-auth funnel to the account.
  if (runId) authUrl.searchParams.set(ONBOARDING_RUN_QUERY_PARAM, runId);

  let openUrl = authUrl;
  let timeoutMs = BROWSER_TIMEOUT_MS;
  if (options.signupEntry) {
    openUrl = new URL(`${consoleBaseUrl(config)}/signup`);
    openUrl.searchParams.set('redirect', `${authUrl.pathname}${authUrl.search}`);
    if (options.provider) openUrl.searchParams.set('provider', options.provider);
    // The console captures ?ref= into its first-touch cookie and forwards it to
    // the signup routes, so the install referral survives the browser hop.
    const ref = readInstallRef();
    if (ref) openUrl.searchParams.set('ref', ref);
    if (runId) openUrl.searchParams.set(ONBOARDING_RUN_QUERY_PARAM, runId);
    timeoutMs = SIGNUP_BROWSER_TIMEOUT_MS;
  }

  return { authUrl, openUrl, timeoutMs };
}

export async function oauthBrowserFlow(
  config: Config,
  options: BrowserFlowOptions = {}
): Promise<OAuthTokenResponse> {
  const oidc = await fetchOIDCConfig(config.domain);
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  const { openUrl, timeoutMs } = buildBrowserFlowUrls(config, state, challenge, options);

  const verb = options.signupEntry ? 'create your account' : 'sign in';
  process.stderr.write(`Opening your browser to ${verb}…\n`);
  process.stderr.write(`If it doesn't open, visit:\n  ${openUrl.toString()}\n\n`);

  const serverPromise = startCallbackServer(state, timeoutMs);
  openBrowser(openUrl.toString());
  const { code } = await serverPromise;

  const tokenRes = await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new CLIError(
      `Sign-in did not complete: the token exchange returned ${tokenRes.status} ${body}`,
      ExitCode.AUTH,
      'Run `polylane auth login` to try again'
    );
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
      client_id: oauthClientId(),
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

  // The consent page reads ?run= off the verification link and carries it into
  // the approval, binding the pre-auth onboarding funnel to the account.
  const runId = resolveOnboardingRunId();
  const verificationUri = withOnboardingRun(deviceData.verification_uri, runId);

  process.stderr.write(`\nTo sign in, visit:\n`);
  process.stderr.write(`  ${verificationUri}\n\n`);
  process.stderr.write(`And enter the code: ${deviceData.user_code}\n\n`);
  process.stderr.write(`Waiting for authorization…\n`);

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
        client_id: oauthClientId(),
        client_secret: oauthClientSecret(),
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
      throw new CLIError('Device code expired', ExitCode.AUTH, 'Run `polylane auth login` again');
    }
    throw new CLIError(
      `Device code sign-in did not complete (${errBody.error ?? 'no error detail'})`,
      ExitCode.AUTH,
      'Run `polylane auth login` to try again'
    );
  }

  throw new CLIError('Device code timed out', ExitCode.TIMEOUT, 'Run `polylane auth login` to try again');
}

export async function revokeToken(config: Config, token: string): Promise<void> {
  const oidc = await fetchOIDCConfig(config.domain).catch(() => null);
  if (!oidc?.revocation_endpoint) return;
  await fetch(oidc.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
    }),
  }).catch(() => {
    // Best effort
  });
}
