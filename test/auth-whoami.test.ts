import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authWhoamiCommand } from '../src/commands/auth/whoami';
import { mockConfig } from './helpers/config';

const user = {
  id: 'user_123',
  email: 'dev@example.test',
  username: 'dev',
  scope: 'read write',
  _html_url: 'https://console.example.test/users/user_123',
};

describe('auth whoami', () => {
  const originalFetch = globalThis.fetch;
  const originalWrite = process.stdout.write;
  let stdout = '';

  before(() => {
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  beforeEach(() => {
    delete process.env.POLYLANE_API_KEY;
    stdout = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'https://api.example.test/v1/auth/whoami');
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'test-key');
      return Response.json({ success: true, error: null, result: user });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  });

  it('keeps the full identity in ordinary text output', async () => {
    await authWhoamiCommand.execute(mockConfig({ apiKey: 'test-key', apiKeySource: 'flag', output: 'text' }), {}, {});
    assert.match(stdout, /id\s+user_123/);
    assert.match(stdout, /email\s+dev@example\.test/);
    assert.match(stdout, /scope\s+read write/);
    assert.match(stdout, /Console:  https:\/\/console\.example\.test\/users\/user_123/);
  });

  it('prints only the email on one line in quiet text output', async () => {
    await authWhoamiCommand.execute(mockConfig({ apiKey: 'test-key', apiKeySource: 'flag', output: 'text', quiet: true }), {}, {});
    assert.equal(stdout, 'Signed in as dev@example.test\n');
  });

  it('preserves structured JSON even when quiet is set', async () => {
    await authWhoamiCommand.execute(mockConfig({ apiKey: 'test-key', apiKeySource: 'flag', output: 'json', quiet: true }), {}, {});
    assert.deepEqual(JSON.parse(stdout), user);
  });

  it('uses the user id when an email is unavailable', async () => {
    globalThis.fetch = (async () => Response.json({ success: true, error: null, result: { id: 'user_123', email: '' } })) as typeof fetch;
    await authWhoamiCommand.execute(mockConfig({ apiKey: 'test-key', apiKeySource: 'flag', output: 'text', quiet: true }), {}, {});
    assert.equal(stdout, 'Signed in as user_123\n');
  });
});
