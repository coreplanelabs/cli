import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/loader';
import type { GlobalFlags } from '../src/types/flags';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NOMINAL_API_DOMAIN;
    delete process.env.NOMINAL_API_KEY;
    delete process.env.NOMINAL_WORKSPACE_ID;
    delete process.env.NOMINAL_TIMEOUT;
    delete process.env.NOMINAL_OUTPUT;
    delete process.env.NOMINAL_VERBOSE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses default domain when nothing is set', () => {
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.domain, 'api.nominal.dev');
  });

  it('prefers env var over default', () => {
    process.env.NOMINAL_API_DOMAIN = 'api.staging.example.com';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.domain, 'api.staging.example.com');
  });

  it('prefers flag over env var', () => {
    process.env.NOMINAL_API_DOMAIN = 'api.staging.example.com';
    const config = loadConfig({ domain: 'api.prod.example.com' } as GlobalFlags);
    assert.equal(config.domain, 'api.prod.example.com');
  });

  it('parses timeout from env', () => {
    process.env.NOMINAL_TIMEOUT = '60';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.timeout, 60);
  });

  it('respects verbose flag', () => {
    const config = loadConfig({ verbose: true } as GlobalFlags);
    assert.equal(config.verbose, true);
  });
});
