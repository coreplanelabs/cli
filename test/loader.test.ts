import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/loader';
import type { GlobalFlags } from '../src/types/flags';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.POLYLANE_API_DOMAIN;
    delete process.env.POLYLANE_API_KEY;
    delete process.env.POLYLANE_WORKSPACE_ID;
    delete process.env.POLYLANE_TIMEOUT;
    delete process.env.POLYLANE_OUTPUT;
    delete process.env.POLYLANE_VERBOSE;
    delete process.env.POLYLANE_AGENT;
    delete process.env.POLYLANE_HINTS;
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

  it('reads the primary agent from env', () => {
    process.env.POLYLANE_AGENT = 'cursor';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.agent, 'cursor');
  });

  it('drops an unknown agent id instead of throwing', () => {
    process.env.POLYLANE_AGENT = 'not-an-agent';
    const config = loadConfig({} as GlobalFlags);
    assert.equal(config.agent, undefined);
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
