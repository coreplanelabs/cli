import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlobalFlags } from '../src/types/flags';

const tempHome = mkdtempSync(join(tmpdir(), 'polylane-bind-run-test-'));
process.env.HOME = tempHome;
delete process.env.POLYLANE_ONBOARDING_RUN;
delete process.env.POLYLANE_API_KEY;

const configDir = join(tempHome, '.polylane');
mkdirSync(configDir, { recursive: true });

const RUN_FILE = join(configDir, 'onboarding-run');
const CREDENTIALS_FILE = join(configDir, 'credentials.json');
const ENV_RUN = '11111111-2222-3333-4444-555555555555';
const FILE_RUN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// `auth login` prints clack chrome (outro) to stdout; stub it so the JSON
// assertions only see command output. ?real keeps Node 20's mock.module from
// being inert against an already-loaded canonical module.
const realPrompt = (await import('../src/utils/prompt.ts?real' as string)) as typeof import('../src/utils/prompt');
mock.module('../src/utils/prompt', {
  namedExports: { ...realPrompt, outro: (): void => {} },
});

const { authBindRunCommand } = await import('../src/commands/auth/bind-run');
const { authLoginCommand } = await import('../src/commands/auth/login');
const { mockConfig } = await import('./helpers/config');
const { ApiError } = await import('../src/errors/api');
const { ExitCode } = await import('../src/errors/codes');

function writeCredentialsFile(): void {
  writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify({
      access_token: 'tok_access',
      refresh_token: 'tok_refresh',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      token_type: 'Bearer',
      scope: 'read',
    }),
    { mode: 0o600 }
  );
}

describe('auth bind-run', () => {
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = '';
  let stderr = '';
  let bindCalls: { url: string; auth: string | undefined; contentType: string | null; body: string }[] = [];
  let bindStatus = 200;

  before(() => {
    process.stdout.write = ((chunk: unknown): boolean => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown): boolean => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  beforeEach(() => {
    stdout = '';
    stderr = '';
    bindCalls = [];
    bindStatus = 200;
    delete process.env.POLYLANE_ONBOARDING_RUN;
    rmSync(RUN_FILE, { force: true });
    rmSync(CREDENTIALS_FILE, { force: true });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/v1/auth/whoami')) {
        return Response.json({ success: true, error: null, result: { id: 'user_1', email: 'dev@acme.com' } });
      }
      if (url.includes('/v1/workspaces')) {
        return Response.json({ success: true, error: null, result: { items: [], count: 0 } });
      }
      if (url.includes('/v1/auth/onboarding_runs/')) {
        const headers = new Headers(init?.headers);
        bindCalls.push({
          url,
          auth: headers.get('authorization') ?? headers.get('x-api-key') ?? undefined,
          contentType: headers.get('content-type'),
          body: String(init?.body ?? ''),
        });
        if (bindStatus === 401) {
          return Response.json(
            { success: false, error: { message: 'Unauthorized', detail: 'Session expired' }, result: null },
            { status: 401 }
          );
        }
        return Response.json({ success: true, error: null, result: { bound: true } });
      }
      throw new Error(`Unexpected request in test: ${url}`);
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function run(args: Record<string, unknown> = {}, config = mockConfig()): Promise<void> {
    await authBindRunCommand.execute(config, {} as GlobalFlags, args);
  }

  it('binds the env run id with the stored credential and consumes the file', async () => {
    writeCredentialsFile();
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    writeFileSync(RUN_FILE, FILE_RUN);
    await run();
    assert.equal(bindCalls.length, 1);
    assert.ok(bindCalls[0]!.url.endsWith(`/v1/auth/onboarding_runs/${ENV_RUN}/bind`));
    assert.equal(bindCalls[0]!.auth, 'Bearer tok_access');
    assert.equal(existsSync(RUN_FILE), false);
    assert.deepEqual(JSON.parse(stdout), { bound: true, runId: ENV_RUN });
  });

  // The API edge rejects a body-less POST without a JSON content type with a
  // bare 403 before the worker runs (nominal#1575), which a fetch mock cannot
  // reproduce — so pin the wire shape the edge needs.
  it('sends a JSON content type and an empty object body so the API edge lets it through', async () => {
    writeCredentialsFile();
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    await run();
    assert.equal(bindCalls[0]!.contentType, 'application/json');
    assert.equal(bindCalls[0]!.body, '{}');
  });

  it('binds the file run id when the env var is unset', async () => {
    writeCredentialsFile();
    writeFileSync(RUN_FILE, `${FILE_RUN}\n`);
    await run();
    assert.equal(bindCalls.length, 1);
    assert.ok(bindCalls[0]!.url.endsWith(`/v1/auth/onboarding_runs/${FILE_RUN}/bind`));
    assert.equal(existsSync(RUN_FILE), false);
    assert.deepEqual(JSON.parse(stdout), { bound: true, runId: FILE_RUN });
  });

  it('prefers an explicit positional run id over env and file', async () => {
    writeCredentialsFile();
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    const explicit = '99999999-8888-7777-6666-555555555555';
    await run({ _: [explicit.toUpperCase()] });
    assert.ok(bindCalls[0]!.url.endsWith(`/v1/auth/onboarding_runs/${explicit}/bind`));
  });

  it('is a no-op that exits 0 when no run id resolves', async () => {
    writeCredentialsFile();
    await run();
    assert.equal(bindCalls.length, 0);
    assert.deepEqual(JSON.parse(stdout), { bound: false, runId: null });
    assert.match(stderr, /no onboarding run/i);
  });

  it('is a no-op that exits 0 and leaves the file when there are no credentials', async () => {
    writeFileSync(RUN_FILE, FILE_RUN);
    await run();
    assert.equal(bindCalls.length, 0);
    assert.equal(existsSync(RUN_FILE), true);
    assert.deepEqual(JSON.parse(stdout), { bound: false, runId: FILE_RUN });
    assert.match(stderr, /not signed in/i);
  });

  it('surfaces a server 401 and keeps the file', async () => {
    writeCredentialsFile();
    writeFileSync(RUN_FILE, FILE_RUN);
    bindStatus = 401;
    await assert.rejects(run(), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.exitCode, ExitCode.AUTH);
      return true;
    });
    assert.equal(bindCalls.length, 1);
    assert.equal(existsSync(RUN_FILE), true);
    assert.equal(stdout, '');
  });

  it('rejects a malformed positional run id', async () => {
    writeCredentialsFile();
    await assert.rejects(run({ _: ['not-a-uuid'] }), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /uuid/i);
      return true;
    });
    assert.equal(bindCalls.length, 0);
  });

  it('prints a text line instead of JSON in text mode', async () => {
    writeCredentialsFile();
    process.env.POLYLANE_ONBOARDING_RUN = ENV_RUN;
    await run({}, mockConfig({ output: 'text' }));
    assert.match(stdout, new RegExp(`Bound onboarding run ${ENV_RUN}`));
  });

  describe('via auth login --api-key', () => {
    it('binds the resolved run with the key and consumes the file', async () => {
      writeFileSync(RUN_FILE, FILE_RUN);
      await authLoginCommand.execute(mockConfig(), {} as GlobalFlags, { apiKey: 'sk_test' });
      assert.equal(bindCalls.length, 1);
      assert.ok(bindCalls[0]!.url.endsWith(`/v1/auth/onboarding_runs/${FILE_RUN}/bind`));
      assert.equal(bindCalls[0]!.auth, 'sk_test');
      assert.equal(existsSync(RUN_FILE), false);
    });

    it('binds with the key even when stored OAuth credentials would outrank it', async () => {
      writeCredentialsFile();
      writeFileSync(RUN_FILE, FILE_RUN);
      await authLoginCommand.execute(mockConfig(), {} as GlobalFlags, { apiKey: 'sk_test' });
      assert.equal(bindCalls.length, 1);
      assert.equal(bindCalls[0]!.auth, 'sk_test');
      assert.equal(existsSync(RUN_FILE), false);
    });

    it('skips the bind call when no run resolves', async () => {
      await authLoginCommand.execute(mockConfig(), {} as GlobalFlags, { apiKey: 'sk_test' });
      assert.equal(bindCalls.length, 0);
    });

    it('still signs in when the bind is rejected, and keeps the file', async () => {
      writeFileSync(RUN_FILE, FILE_RUN);
      bindStatus = 401;
      await authLoginCommand.execute(mockConfig(), {} as GlobalFlags, { apiKey: 'sk_test' });
      assert.equal(bindCalls.length, 1);
      assert.equal(existsSync(RUN_FILE), true);
      assert.equal(existsSync(join(configDir, 'config.json')), true);
    });
  });
});
