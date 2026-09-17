import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from '../src/command';
import type { GlobalFlags } from '../src/types/flags';

// HOME must point at a temp dir before any source module loads so the loader
// and the resolver read this test's files, not the developer's.
const tempHome = mkdtempSync(join(tmpdir(), 'polylane-api-key-collision-test-'));
process.env.HOME = tempHome;
after(() => rmSync(tempHome, { recursive: true, force: true }));

const { parseFlags, globalFlagsOf } = await import('../src/args');
const { GLOBAL_OPTIONS } = await import('../src/command');
const { loadConfig } = await import('../src/config/loader');
const { resolveCredential } = await import('../src/auth/resolver');
const { cloudConnectCommand } = await import('../src/commands/cloud/connect');
const { cloudListCommand } = await import('../src/commands/cloud/list');

const configDir = join(tempHome, '.polylane');
const credentialsFile = join(configDir, 'credentials.json');

// What `polylane auth login` leaves behind: a valid OAuth session.
function writeLoginCredentials(): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    credentialsFile,
    JSON.stringify({
      access_token: 'oauth-from-auth-login',
      refresh_token: 'refresh',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      token_type: 'Bearer',
      scope: '',
    }),
    { mode: 0o600 }
  );
}

// The same steps main.ts runs between the command lookup and the auth gate.
// `argv` is what follows the command path, and process.argv carries the whole
// invocation as it does in a real process.
async function resolveInvocation(command: Command, argv: string[]) {
  process.argv = ['node', 'polylane', ...command.name.split(' '), ...argv];
  const { flags } = parseFlags(argv, command.options ?? [], GLOBAL_OPTIONS);
  const config = loadConfig(globalFlagsOf(flags, command.options ?? []) as GlobalFlags);
  const credential = await resolveCredential(config);
  return { flags, config, credential };
}

describe('cloud connect --api-key is the provider key, not the Polylane key', () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.POLYLANE_API_KEY;
    rmSync(credentialsFile, { force: true });
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv, HOME: tempHome };
  });

  for (const [provider, key] of [
    ['triggerdev', 'tr_prod_sk_x'],
    ['render', 'rnd_x'],
  ] as const) {
    it(`${provider}: a signed-in user's OAuth session is used, and the ${provider} key reaches the command`, async () => {
      writeLoginCredentials();

      const { flags, config, credential } = await resolveInvocation(cloudConnectCommand, [
        '--provider',
        provider,
        '--api-key',
        key,
      ]);

      assert.equal(credential.type, 'oauth');
      assert.equal(credential.type === 'oauth' && credential.accessToken, 'oauth-from-auth-login');
      assert.equal(config.apiKey, undefined);
      assert.equal(flags.apiKey, key);
    });
  }

  it('the provider key is never tried as the Polylane credential when nothing else is set', async () => {
    await assert.rejects(
      resolveInvocation(cloudConnectCommand, ['--provider', 'triggerdev', '--api-key', 'tr_prod_sk_x']),
      /Not signed in/
    );
  });

  it('POLYLANE_API_KEY still authenticates connect while the provider key reaches the command', async () => {
    writeLoginCredentials();
    process.env.POLYLANE_API_KEY = 'sk_from_env';

    const { flags, credential } = await resolveInvocation(cloudConnectCommand, [
      '--provider',
      'triggerdev',
      '--api-key',
      'tr_prod_sk_x',
    ]);

    assert.equal(credential.type === 'api-key' && credential.key, 'sk_from_env');
    assert.equal(credential.type === 'api-key' && credential.source, 'env');
    assert.equal(flags.apiKey, 'tr_prod_sk_x');
  });

  it('the global --api-key still authenticates a command without its own --api-key', async () => {
    writeLoginCredentials();

    const { config, credential } = await resolveInvocation(cloudListCommand, ['--api-key', 'sk_from_flag']);

    assert.equal(config.apiKey, 'sk_from_flag');
    assert.equal(credential.type === 'api-key' && credential.key, 'sk_from_flag');
    assert.equal(credential.type === 'api-key' && credential.source, 'flag');
  });
});
