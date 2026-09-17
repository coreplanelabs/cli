import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// HOME must point at a temp dir before any source module loads so the
// resolver reads this test's credentials file, not the developer's.
const tempHome = mkdtempSync(join(tmpdir(), 'polylane-resolver-test-'));
process.env.HOME = tempHome;
after(() => rmSync(tempHome, { recursive: true, force: true }));

const { resolveCredential } = await import('../src/auth/resolver');
const { mockConfig } = await import('./helpers/config');

const configDir = join(tempHome, '.polylane');
const credentialsFile = join(configDir, 'credentials.json');

// A valid, non-expiring OAuth credential: what a runner is left with after
// someone ran `polylane auth login` on it months ago.
function writeStaleCredentials(): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    credentialsFile,
    JSON.stringify({
      access_token: 'stale-oauth-token',
      refresh_token: 'stale-refresh-token',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      token_type: 'Bearer',
      scope: '',
    }),
    { mode: 0o600 }
  );
}

describe('resolveCredential precedence', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.POLYLANE_API_KEY;
    rmSync(credentialsFile, { force: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv, HOME: tempHome };
  });

  it('an env key set in the process but not recorded by the loader is not a credential', async () => {
    writeStaleCredentials();
    process.env.POLYLANE_API_KEY = 'sk_from_env';

    const cred = await resolveCredential(mockConfig());
    assert.equal(cred.type, 'oauth');
  });

  it('POLYLANE_API_KEY wins over a stale credentials.json', async () => {
    writeStaleCredentials();
    process.env.POLYLANE_API_KEY = 'sk_from_env';

    const cred = await resolveCredential(mockConfig({ apiKey: 'sk_from_env', apiKeySource: 'env' }));
    assert.equal(cred.type, 'api-key');
    assert.equal(cred.type === 'api-key' && cred.key, 'sk_from_env');
    assert.equal(cred.type === 'api-key' && cred.source, 'env');
  });

  it('--api-key wins over POLYLANE_API_KEY and credentials.json', async () => {
    writeStaleCredentials();
    process.env.POLYLANE_API_KEY = 'sk_from_env';

    const cred = await resolveCredential(mockConfig({ apiKey: 'sk_from_flag', apiKeySource: 'flag' }));
    assert.equal(cred.type === 'api-key' && cred.key, 'sk_from_flag');
    assert.equal(cred.type === 'api-key' && cred.source, 'flag');
  });

  it('credentials.json wins over the config file api_key', async () => {
    writeStaleCredentials();

    const cred = await resolveCredential(mockConfig({ apiKey: 'sk_from_config', apiKeySource: 'config' }));
    assert.equal(cred.type, 'oauth');
    assert.equal(cred.type === 'oauth' && cred.accessToken, 'stale-oauth-token');
  });

  it('falls back to the config file api_key', async () => {
    const cred = await resolveCredential(mockConfig({ apiKey: 'sk_from_config', apiKeySource: 'config' }));
    assert.equal(cred.type === 'api-key' && cred.key, 'sk_from_config');
    assert.equal(cred.type === 'api-key' && cred.source, 'config');
  });

  it('fails with the sign-in hint when nothing is set', async () => {
    await assert.rejects(resolveCredential(mockConfig()), /Not signed in/);
  });
});
