import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempHome = mkdtempSync(join(tmpdir(), 'polylane-auth-status-test-'));
process.env.HOME = tempHome;
delete process.env.POLYLANE_API_KEY;

const configDir = join(tempHome, '.polylane');
const credentialsFile = join(configDir, 'credentials.json');
mkdirSync(configDir, { recursive: true });

const { authStatusCommand } = await import('../src/commands/auth/status');
const { ApiError } = await import('../src/errors/api');
const { CLIError } = await import('../src/errors/base');
const { ExitCode } = await import('../src/errors/codes');
const { mockConfig } = await import('./helpers/config');

function writeUnexpiredCredentials(): string {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    credentialsFile,
    JSON.stringify({
      access_token: 'prod-access-token',
      refresh_token: 'prod-refresh-token',
      expires_at: expiresAt,
      token_type: 'Bearer',
      scope: 'openid profile email',
      account: 'developer@example.test',
    }),
    { mode: 0o600 }
  );
  return expiresAt;
}

function apiResponse(result: unknown, status = 200, detail = 'Credential is not valid for this environment'): Response {
  return Response.json(
    {
      message: null,
      success: status >= 200 && status < 300,
      error: status >= 400 ? { message: 'Request failed', detail } : null,
      result,
    },
    { status }
  );
}

describe('auth status remote identity validation', () => {
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  let stdout = '';

  before(() => {
    process.stdout.write = ((chunk: unknown): boolean => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  beforeEach(() => {
    stdout = '';
    rmSync(credentialsFile, { force: true });
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('rejects an unexpired credential from another environment against the selected domain', async () => {
    writeUnexpiredCredentials();
    let requestedUrl = '';
    let authorization = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input instanceof Request ? input.url : input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return apiResponse(null, 401);
    }) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig({ domain: 'api.selected.test' })), ApiError);
    assert.equal(requestedUrl, 'https://api.selected.test/v1/auth/whoami');
    assert.equal(authorization, 'Bearer prod-access-token');
    assert.equal(stdout, '');
  });

  it('reports a selected-domain 401 with authentication exit semantics and a sign-in hint', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => apiResponse(null, 401)) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.exitCode, ExitCode.AUTH);
      assert.match(error.message, /not valid/i);
      assert.match(error.hint ?? '', /polylane auth login/);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('keeps a network failure distinct from invalid credentials', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof CLIError);
      assert.equal(error.exitCode, ExitCode.NETWORK);
      assert.match(error.message, /network error/i);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('keeps a timeout distinct from invalid credentials', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof CLIError);
      assert.equal(error.exitCode, ExitCode.TIMEOUT);
      assert.match(error.message, /timed out/i);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('keeps a malformed successful response distinct from invalid credentials', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof CLIError);
      assert.equal(error.exitCode, ExitCode.GENERAL);
      assert.match(error.message, /invalid json response/i);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('rejects a successful response with a null identity result', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => apiResponse(null)) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof CLIError);
      assert.equal(error.exitCode, ExitCode.GENERAL);
      assert.match(error.message, /invalid identity response/i);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('rejects a successful response with a structurally invalid identity result', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => apiResponse({ id: 'user_1', email: ['not-an-email'] })) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof CLIError);
      assert.equal(error.exitCode, ExitCode.GENERAL);
      assert.match(error.message, /invalid identity response/i);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('keeps a server failure distinct from invalid credentials', async () => {
    writeUnexpiredCredentials();
    globalThis.fetch = (async () => apiResponse(null, 503, 'Service temporarily unavailable')) as typeof fetch;

    await assert.rejects(authStatusCommand.execute(mockConfig()), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.exitCode, ExitCode.GENERAL);
      assert.match(error.message, /service temporarily unavailable/i);
      assert.doesNotMatch(error.message, /credential|sign in/i);
      return true;
    });
    assert.equal(stdout, '');
  });

  it('preserves status details after successful same-environment validation', async () => {
    const expiresAt = writeUnexpiredCredentials();
    globalThis.fetch = (async () =>
      apiResponse({
        id: 'user_1',
        forename: 'Dev',
        surname: 'Example',
        email: 'developer@example.test',
        username: 'developer',
      })) as typeof fetch;

    await authStatusCommand.execute(
      mockConfig({ domain: 'api.same.test', workspaceId: 'ws_' + 'a'.repeat(32) })
    );

    const result = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(result.authenticated, true);
    assert.equal(result.method, 'oauth');
    assert.equal(result.account, 'developer@example.test');
    assert.equal(result.scope, 'openid profile email');
    assert.equal(result.expiresAt, expiresAt);
    assert.equal(result.accessToken, 'prod...oken');
    assert.equal(result.domain, 'api.same.test');
    assert.equal(result.workspaceId, 'ws_' + 'a'.repeat(32));
    assert.deepEqual(result.user, {
      id: 'user_1',
      name: 'Dev Example',
      email: 'developer@example.test',
      username: 'developer',
    });
  });
});
