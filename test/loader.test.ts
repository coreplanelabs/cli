import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlobalFlags } from '../src/types/flags';

// Point HOME at a temp dir before importing any source module, so the loader
// reads this test's config file instead of the developer's real
// ~/.polylane/config.json. Same pattern as signup.test.ts.
const tempHome = mkdtempSync(join(tmpdir(), 'polylane-loader-test-'));
process.env.HOME = tempHome;
after(() => rmSync(tempHome, { recursive: true, force: true }));

const { loadConfig } = await import('../src/config/loader');

const configDir = join(tempHome, '.polylane');
const configFile = join(configDir, 'config.json');

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.POLYLANE_API_DOMAIN;
    delete process.env.POLYLANE_API_KEY;
    delete process.env.POLYLANE_WORKSPACE_ID;
    delete process.env.POLYLANE_TIMEOUT;
    delete process.env.POLYLANE_OUTPUT;
    delete process.env.POLYLANE_VERBOSE;
    delete process.env.POLYLANE_HINTS;
    rmSync(configFile, { force: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses default domain when nothing is set', () => {
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.domain, 'api.polylane.com');
  });

  it('prefers env var over default', () => {
    process.env.POLYLANE_API_DOMAIN = 'api.staging.example.com';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.domain, 'api.staging.example.com');
  });

  it('prefers flag over env var', () => {
    process.env.POLYLANE_API_DOMAIN = 'api.staging.example.com';
    const config = loadConfig({ domain: 'api.prod.example.com' } as GlobalFlags);
    assert.equal(config.domain, 'api.prod.example.com');
  });

  it('parses timeout from env', () => {
    process.env.POLYLANE_TIMEOUT = '60';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.timeout, 60);
  });

  it('respects verbose flag', () => {
    const config = loadConfig({ verbose: true } as GlobalFlags);
    assert.equal(config.verbose, true);
  });

  it('silently tolerates unknown fields in the config file (e.g. a legacy agent key)', () => {
    // Older CLI versions persisted a primary coding agent choice; existing
    // config files still carry it. It must be ignored, never an error.
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ domain: 'api.legacy.example.com', agent: 'cursor', some_future_key: true })
    );
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.domain, 'api.legacy.example.com');
    assert.ok(!('agent' in config));
  });

  it('hints default on', () => {
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.hints, true);
  });

  it('POLYLANE_HINTS=0 disables hints', () => {
    process.env.POLYLANE_HINTS = '0';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.hints, false);
  });

  it('POLYLANE_HINTS=1 enables hints', () => {
    process.env.POLYLANE_HINTS = '1';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.hints, true);
  });
});
