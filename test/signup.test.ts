import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlobalFlags } from '../src/types/flags';

const tempHome = mkdtempSync(join(tmpdir(), 'polylane-signup-test-'));
process.env.HOME = tempHome;

// The terms-notice tests drive interactive paths, which don't exist under
// node:test (no TTY): isInteractive is re-derived from the config flag alone,
// prompts that would block are stubbed, and note() writes its message plain —
// the clack box wraps long lines, which would break substring assertions.
// The real exports are pulled through `?real` query URLs: a plain import would
// warm the canonical module-cache entry, and Node 20's mock.module cannot
// override an already-loaded module (22+ re-links it; on 20 the mock stays
// silently inert and the real prompts run). Order matters for the same reason:
// the env mock must register before prompt.ts?real loads, because prompt.ts
// imports the canonical './env' as a child.
const realEnv = (await import('../src/utils/env.ts?real' as string)) as typeof import('../src/utils/env');
mock.module('../src/utils/env', {
  namedExports: {
    ...realEnv,
    isInteractive: (nonInteractive: boolean): boolean => !nonInteractive,
  },
});

const realPrompt = (await import('../src/utils/prompt.ts?real' as string)) as typeof import('../src/utils/prompt');
const promptEnterCalls: string[] = [];
mock.module('../src/utils/prompt', {
  namedExports: {
    ...realPrompt,
    note: (message: string, title?: string): void => {
      process.stderr.write(`${title ? `${title}\n` : ''}${message}\n`);
    },
    promptPassword: async (): Promise<string> => 'prompted-password',
    promptEnter: async (_ctx: unknown, message: string): Promise<void> => {
      promptEnterCalls.push(message);
    },
  },
});

const { authSignupCommand, nextSteps } = await import('../src/commands/auth/signup');
const { mockConfig } = await import('./helpers/config');

const CONFIG_FILE = join(tempHome, '.polylane', 'config.json');
const CREDENTIALS_FILE = join(tempHome, '.polylane', 'credentials.json');
const WORKSPACE_ID = 'ws_' + 'a'.repeat(32);

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

let output = '';

function captureOutput(): void {
  output = '';
  const capture = (chunk: unknown): boolean => {
    output += String(chunk);
    return true;
  };
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
}

function restoreOutput(): void {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function mockApi(routes: Record<string, () => Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [path, handler] of Object.entries(routes)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`Unexpected request in test: ${url}`);
  }) as typeof fetch;
}

function verifyEmailResponse(landing: unknown): Response {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
  return jsonResponse(
    { success: true, error: null, result: { token: 'tok_test', landing } },
    { 'set-cookie': `auth_session=tok_test; Expires=${expires}; Path=/; HttpOnly` }
  );
}

const TERMS_LINE = 'you agree to the Terms of Service and acknowledge the Privacy Policy';

function signupResponse(): Response {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
  return jsonResponse(
    {
      success: true,
      error: null,
      result: {
        user: { id: 'user_1', email: 'dev@acme.com', emailVerified: true },
        token: 'tok_signup',
      },
    },
    { 'set-cookie': `auth_session=tok_signup; Expires=${expires}; Path=/; HttpOnly` }
  );
}

describe('auth signup terms notice', () => {
  before(() => {
    delete process.env.POLYLANE_API_KEY;
    delete process.env.POLYLANE_WORKSPACE_ID;
    delete process.env.POLYLANE_API_DOMAIN;
    delete process.env.POLYLANE_ONBOARDING_RUN;
  });

  beforeEach(() => {
    rmSync(CONFIG_FILE, { force: true });
    rmSync(CREDENTIALS_FILE, { force: true });
    promptEnterCalls.length = 0;
  });

  it('shows the notice once and gates on Enter on the interactive email path', async () => {
    mockApi({ '/v1/auth/signup': signupResponse });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false, nonInteractive: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com' }
      );
    } finally {
      restoreOutput();
    }

    assert.equal(output.split(TERMS_LINE).length - 1, 1);
    assert.ok(output.includes('https://polylane.com/terms/'));
    assert.ok(output.includes('https://polylane.com/privacy/'));
    assert.deepEqual(promptEnterCalls, ['Continue?']);
  });

  it('prints the notice without gating on a non-interactive scripted signup', async () => {
    mockApi({ '/v1/auth/signup': signupResponse });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', password: 'hunter2-hunter2' }
      );
    } finally {
      restoreOutput();
    }

    assert.equal(output.split(TERMS_LINE).length - 1, 1);
    assert.deepEqual(promptEnterCalls, []);
  });

  it('keeps the notice but skips the gate when --password is passed interactively', async () => {
    mockApi({ '/v1/auth/signup': signupResponse });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false, nonInteractive: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', password: 'hunter2-hunter2' }
      );
    } finally {
      restoreOutput();
    }

    assert.equal(output.split(TERMS_LINE).length - 1, 1);
    assert.deepEqual(promptEnterCalls, []);
  });

  it('does not show the notice on the --code completion path', async () => {
    mockApi({
      '/v1/auth/verify_email': () => verifyEmailResponse({ kind: 'none' }),
      '/v1/auth/whoami': () =>
        jsonResponse({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } }),
      '/v1/workspaces': () =>
        jsonResponse({ success: true, error: null, result: { items: [], count: 0 } }),
    });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', code: '123456' }
      );
    } finally {
      restoreOutput();
    }

    assert.ok(!output.includes(TERMS_LINE));
  });
});

// The existing-verified-account (re-auth) path: the signup POST returns a
// verified user plus a session token immediately, no --code round-trip.
describe('auth signup existing-account re-auth', () => {
  const reauthRoutes = {
    '/v1/auth/signup': signupResponse,
    '/v1/auth/whoami': (): Response =>
      jsonResponse({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } }),
    '/v1/workspaces': (): Response =>
      jsonResponse({
        success: true,
        error: null,
        result: { items: [{ id: WORKSPACE_ID, name: 'Acme', slug: 'acme' }], count: 1 },
      }),
  };

  before(() => {
    delete process.env.POLYLANE_API_KEY;
    delete process.env.POLYLANE_WORKSPACE_ID;
    delete process.env.POLYLANE_API_DOMAIN;
  });

  beforeEach(() => {
    rmSync(CONFIG_FILE, { force: true });
    rmSync(CREDENTIALS_FILE, { force: true });
    delete process.env.POLYLANE_ONBOARDING_RUN;
  });

  async function run(overrides: Parameters<typeof mockConfig>[0] = {}): Promise<void> {
    mockApi(reauthRoutes);
    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false, ...overrides }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', password: 'hunter2-hunter2' }
      );
    } finally {
      restoreOutput();
    }
  }

  it('text mode never prints the token, the raw user object, or "undefined"', async () => {
    await run({ output: 'text' });
    assert.ok(!output.includes('tok_signup'), 'session token leaked to text output');
    assert.ok(!output.includes('emailVerified'), 'raw user object dumped to text output');
    assert.ok(!output.includes('undefined'));
    assert.ok(output.includes('Signed in as dev@acme.com.'));
  });

  it('JSON mode still emits the full envelope for scripts', async () => {
    await run({ output: 'json' });
    assert.ok(output.includes('tok_signup'));
    assert.ok(output.includes('emailVerified'));
  });

  it('persists workspace_id to config.json on re-auth', async () => {
    await run({ output: 'text' });
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as { workspace_id?: string };
    assert.equal(config.workspace_id, WORKSPACE_ID);
  });

  it('prints next steps by default but not with hints disabled', async () => {
    await run({ output: 'text' });
    assert.ok(output.includes('Onboarding (in order)'));

    await run({ output: 'text', hints: false });
    assert.ok(!output.includes('Onboarding (in order)'));
    assert.ok(output.includes('Signed in as dev@acme.com.'));
  });
});

describe('auth signup --code (email verification)', () => {
  before(() => {
    delete process.env.POLYLANE_API_KEY;
    delete process.env.POLYLANE_WORKSPACE_ID;
    delete process.env.POLYLANE_API_DOMAIN;
  });

  beforeEach(() => {
    rmSync(CONFIG_FILE, { force: true });
    rmSync(CREDENTIALS_FILE, { force: true });
  });

  after(() => {
    globalThis.fetch = originalFetch;
    restoreOutput();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('persists workspace_id to config.json after verification', async () => {
    mockApi({
      '/v1/auth/verify_email': () => verifyEmailResponse({ kind: 'created', workspaceSlug: 'acme' }),
      '/v1/auth/whoami': () =>
        jsonResponse({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } }),
      '/v1/workspaces': () =>
        jsonResponse({
          success: true,
          error: null,
          result: { items: [{ id: WORKSPACE_ID, name: 'Acme', slug: 'acme' }], count: 1 },
        }),
    });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', code: '123456' }
      );
    } finally {
      restoreOutput();
    }

    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as { workspace_id?: string };
    assert.equal(config.workspace_id, WORKSPACE_ID);
    const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')) as { access_token?: string };
    assert.equal(creds.access_token, 'tok_test');
  });

  it('parses the landing shape and names the workspace in next steps', async () => {
    mockApi({
      '/v1/auth/verify_email': () => verifyEmailResponse({ kind: 'joined', workspaceSlug: 'acme' }),
      '/v1/auth/whoami': () =>
        jsonResponse({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } }),
      '/v1/workspaces': () =>
        jsonResponse({
          success: true,
          error: null,
          result: { items: [{ id: WORKSPACE_ID, name: 'Acme', slug: 'acme' }], count: 1 },
        }),
    });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', code: '123456' }
      );
    } finally {
      restoreOutput();
    }

    assert.ok(output.includes('You joined the "acme" workspace'));
    assert.ok(!output.includes('polylane workspace create'));
  });

  it('completes without a workspace when the landing kind carries none and whoami fails', async () => {
    mockApi({
      '/v1/auth/verify_email': () => verifyEmailResponse({ kind: 'none' }),
      '/v1/auth/whoami': () =>
        new Response(JSON.stringify({ success: false, error: { message: 'boom' }, result: null }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    });

    captureOutput();
    try {
      await authSignupCommand.execute(
        mockConfig({ telemetry: false }),
        {} as GlobalFlags,
        { email: 'dev@acme.com', code: '123456' }
      );
    } finally {
      restoreOutput();
    }

    assert.ok(!existsSync(CONFIG_FILE));
    const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')) as { access_token?: string };
    assert.equal(creds.access_token, 'tok_test');
    assert.ok(output.includes('polylane workspace create'));
  });
});

describe('nextSteps', () => {
  it('names a created workspace and does not suggest creating one', () => {
    const text = nextSteps({ kind: 'created', workspaceSlug: 'acme' });
    assert.ok(text.includes('Your first workspace ("acme") was created'));
    assert.ok(!text.includes('polylane workspace create'));
  });

  it('names a joined workspace and does not suggest creating one', () => {
    const text = nextSteps({ kind: 'joined', workspaceSlug: 'inviter' });
    assert.ok(text.includes('You joined the "inviter" workspace'));
    assert.ok(!text.includes('polylane workspace create'));
  });

  it('points existing members at picking a default workspace', () => {
    const text = nextSteps({ kind: 'existing' });
    assert.ok(text.includes('Set your default workspace'));
    assert.ok(!text.includes('polylane workspace create'));
  });

  it('suggests creating a workspace when the landing kind is none', () => {
    const text = nextSteps({ kind: 'none' });
    assert.ok(text.includes('polylane workspace create'));
  });

  it('suggests creating a workspace when no landing is present', () => {
    const text = nextSteps();
    assert.ok(text.includes('polylane workspace create'));
  });

  it('does not crash when a created landing has no workspaceSlug', () => {
    const text = nextSteps({ kind: 'created' });
    assert.ok(text.includes('Your first workspace was created'));
    assert.ok(!text.includes('polylane workspace create'));
  });

  it('suggests creating a workspace for an invite at capacity', () => {
    const text = nextSteps({
      kind: 'invite_at_capacity',
      workspace: { id: 'ws_1', name: 'Inviter' },
    });
    assert.ok(text.includes('polylane workspace create'));
  });
});
