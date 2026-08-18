import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempHome = mkdtempSync(join(tmpdir(), 'polylane-onboarding-run-test-'));
process.env.HOME = tempHome;
delete process.env.POLYLANE_ONBOARDING_RUN;
delete process.env.POLYLANE_CONSOLE_DOMAIN;
delete process.env.POLYLANE_OAUTH_CLIENT_ID;

const configDir = join(tempHome, '.polylane');
mkdirSync(configDir, { recursive: true });

// readInstallRef caches on first read, so the ref fixture must exist before
// anything under src/ is imported.
writeFileSync(join(configDir, 'ref'), 'gh.readme\n');

const RUN_FILE = join(configDir, 'onboarding-run');
const ENV_RUN = '11111111-2222-3333-4444-555555555555';
const FILE_RUN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const { resolveOnboardingRunId, withOnboardingRun } = await import('../src/auth/onboarding-run');
const { buildBrowserFlowUrls, oauthDeviceCodeFlow } = await import('../src/auth/oauth');
const { authSignupCommand } = await import('../src/commands/auth/signup');
const { oauthLogin } = await import('../src/commands/auth/login');
const { mockConfig } = await import('./helpers/config');

import type { GlobalFlags } from '../src/types/flags';

describe('resolveOnboardingRunId', () => {
  beforeEach(() => {
    delete process.env.POLYLANE_ONBOARDING_RUN;
    rmSync(RUN_FILE, { force: true });
  });

  it('prefers the environment variable over the file', () => {
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    writeFileSync(RUN_FILE, FILE_RUN);
    assert.equal(resolveOnboardingRunId(), ENV_RUN);
  });

  it('falls back to ~/.polylane/onboarding-run when the env var is unset', () => {
    writeFileSync(RUN_FILE, `${FILE_RUN}\n`);
    assert.equal(resolveOnboardingRunId(), FILE_RUN);
  });

  it('returns null when neither source exists', () => {
    assert.equal(resolveOnboardingRunId(), null);
  });

  it('drops an invalid env value silently and falls back to the file', () => {
    process.env.POLYLANE_ONBOARDING_RUN = 'not-a-uuid';
    writeFileSync(RUN_FILE, FILE_RUN);
    assert.equal(resolveOnboardingRunId(), FILE_RUN);
  });

  it('drops an invalid file value silently', () => {
    writeFileSync(RUN_FILE, 'definitely; not a uuid');
    assert.equal(resolveOnboardingRunId(), null);
  });

  it('trims whitespace and lowercases the identifier', () => {
    process.env.POLYLANE_ONBOARDING_RUN = '  AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE  ';
    assert.equal(resolveOnboardingRunId(), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('rejects a uuid with trailing garbage', () => {
    process.env.POLYLANE_ONBOARDING_RUN = `${ENV_RUN}x`;
    assert.equal(resolveOnboardingRunId(), null);
  });
});

describe('withOnboardingRun', () => {
  it('appends the run param to a bare url', () => {
    assert.equal(
      withOnboardingRun('https://console.example.test/activate', FILE_RUN),
      `https://console.example.test/activate?run=${FILE_RUN}`
    );
  });

  it('preserves existing query params', () => {
    assert.equal(
      withOnboardingRun('https://console.example.test/activate?user_code=BDFG2345', FILE_RUN),
      `https://console.example.test/activate?user_code=BDFG2345&run=${FILE_RUN}`
    );
  });

  it('returns the url unchanged when there is no run', () => {
    assert.equal(withOnboardingRun('https://console.example.test/activate', null), 'https://console.example.test/activate');
  });

  it('returns an unparseable url unchanged', () => {
    assert.equal(withOnboardingRun('not a url', FILE_RUN), 'not a url');
  });
});

describe('buildBrowserFlowUrls', () => {
  beforeEach(() => {
    delete process.env.POLYLANE_ONBOARDING_RUN;
    rmSync(RUN_FILE, { force: true });
  });

  it('stamps the run on the authorize url', () => {
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    const { authUrl, openUrl } = buildBrowserFlowUrls(mockConfig(), 'state123', 'challenge123');
    assert.equal(authUrl.searchParams.get('run'), ENV_RUN);
    assert.equal(openUrl, authUrl);
  });

  it('omits the run param when none resolves', () => {
    const { authUrl } = buildBrowserFlowUrls(mockConfig(), 'state123', 'challenge123');
    assert.equal(authUrl.searchParams.get('run'), null);
  });

  it('carries run and ref on the signup entry url and run inside the redirect', () => {
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    const { openUrl } = buildBrowserFlowUrls(mockConfig(), 'state123', 'challenge123', {
      signupEntry: true,
      provider: 'github',
    });
    assert.equal(openUrl.pathname, '/signup');
    assert.equal(openUrl.searchParams.get('run'), ENV_RUN);
    assert.equal(openUrl.searchParams.get('ref'), 'gh.readme');
    assert.equal(openUrl.searchParams.get('provider'), 'github');
    assert.ok(openUrl.searchParams.get('redirect')!.includes(`run=${ENV_RUN}`));
  });
});

describe('auth signup attribution forwarding', () => {
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let signupBody: Record<string, unknown> | null = null;

  before(() => {
    const swallow = ((_chunk: unknown): boolean => true) as typeof process.stdout.write;
    process.stdout.write = swallow;
    process.stderr.write = swallow;
  });

  beforeEach(() => {
    signupBody = null;
    delete process.env.POLYLANE_ONBOARDING_RUN;
    rmSync(RUN_FILE, { force: true });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/v1/auth/signup')) {
        signupBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          success: true,
          error: null,
          result: {
            user: { id: 'user_1', email: 'dev@acme.com', emailVerified: true },
            token: 'tok_test',
          },
        });
      }
      if (url.includes('/v1/auth/whoami')) {
        return Response.json({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } });
      }
      if (url.includes('/v1/workspaces')) {
        return Response.json({ success: true, error: null, result: { items: [], count: 0 } });
      }
      throw new Error(`Unexpected request in test: ${url}`);
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  async function runSignup(): Promise<void> {
    await authSignupCommand.execute(mockConfig({ telemetry: false }), {} as GlobalFlags, {
      email: 'dev@acme.com',
      password: 'Sup3r$ecret!',
    });
  }

  it('sends run and ref in the signup body', async () => {
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    await runSignup();
    assert.equal(signupBody?.run, ENV_RUN);
    assert.equal(signupBody?.ref, 'gh.readme');
    assert.equal(signupBody?.email, 'dev@acme.com');
  });

  it('sends the file run when the env var is unset', async () => {
    writeFileSync(RUN_FILE, FILE_RUN);
    await runSignup();
    assert.equal(signupBody?.run, FILE_RUN);
  });

  it('omits run when the resolved value is not a uuid', async () => {
    process.env.POLYLANE_ONBOARDING_RUN = 'not-a-uuid';
    await runSignup();
    assert.equal('run' in (signupBody ?? {}), false);
  });

  it('consumes the onboarding-run file once signup carries it to the bind', async () => {
    writeFileSync(RUN_FILE, FILE_RUN);
    assert.equal(resolveOnboardingRunId(), FILE_RUN);
    await runSignup();
    // The run rode the signup request, and the file is spent afterwards.
    assert.equal(signupBody?.run, FILE_RUN);
    assert.equal(existsSync(RUN_FILE), false);
    assert.equal(resolveOnboardingRunId(), null);
  });
});

describe('oauthDeviceCodeFlow verification link', () => {
  const originalFetch = globalThis.fetch;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stderr = '';

  before(() => {
    process.stderr.write = ((chunk: unknown): boolean => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  beforeEach(() => {
    stderr = '';
    delete process.env.POLYLANE_ONBOARDING_RUN;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
  });

  function mockDeviceApi(): void {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/.well-known/openid-configuration')) {
        return Response.json({ token_endpoint: 'https://api.example.test/v1/oauth/token' });
      }
      if (url.includes('/v1/oauth/device/code')) {
        return Response.json({
          device_code: 'dev_code',
          user_code: 'BDFG2345',
          verification_uri: 'https://console.example.test/activate',
          verification_uri_complete: 'https://console.example.test/activate?user_code=BDFG2345',
          expires_in: 60,
          interval: 0,
        });
      }
      if (url.includes('/v1/oauth/token')) {
        return Response.json({
          access_token: 'at',
          refresh_token: 'rt',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: '',
        });
      }
      throw new Error(`Unexpected request in test: ${url}`);
    }) as typeof fetch;
  }

  it('appends ?run= to the printed verification link', async () => {
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    mockDeviceApi();
    await oauthDeviceCodeFlow(mockConfig());
    assert.ok(stderr.includes(`https://console.example.test/activate?run=${ENV_RUN}`));
  });

  it('leaves the verification link untouched without a run', async () => {
    mockDeviceApi();
    await oauthDeviceCodeFlow(mockConfig());
    assert.ok(stderr.includes('https://console.example.test/activate\n'));
    assert.ok(!stderr.includes('run='));
  });
});

describe('oauthLogin one-shot run cleanup', () => {
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  before(() => {
    const swallow = ((_chunk: unknown): boolean => true) as typeof process.stdout.write;
    process.stdout.write = swallow;
    process.stderr.write = swallow;
  });

  beforeEach(() => {
    delete process.env.POLYLANE_ONBOARDING_RUN;
    rmSync(RUN_FILE, { force: true });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/.well-known/openid-configuration')) {
        return Response.json({ token_endpoint: 'https://api.example.test/v1/oauth/token' });
      }
      if (url.includes('/v1/oauth/device/code')) {
        return Response.json({
          device_code: 'dev_code',
          user_code: 'BDFG2345',
          verification_uri: 'https://console.example.test/activate',
          expires_in: 60,
          interval: 0,
        });
      }
      if (url.includes('/v1/oauth/token')) {
        return Response.json({
          access_token: 'at',
          refresh_token: 'rt',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: '',
        });
      }
      if (url.includes('/v1/oauth/userinfo')) {
        return Response.json({ email: 'dev@acme.com', sub: 'user_1' });
      }
      if (url.includes('/v1/auth/whoami')) {
        return Response.json({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } });
      }
      if (url.includes('/v1/workspaces')) {
        return Response.json({ success: true, error: null, result: { items: [], count: 0 } });
      }
      throw new Error(`Unexpected request in test: ${url}`);
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it('removes the run file after a device-code login completes', async () => {
    writeFileSync(RUN_FILE, FILE_RUN);
    assert.equal(resolveOnboardingRunId(), FILE_RUN);
    await oauthLogin(mockConfig(), false);
    assert.equal(existsSync(RUN_FILE), false);
    assert.equal(resolveOnboardingRunId(), null);
  });
});
