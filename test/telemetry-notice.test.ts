import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CONFIG_DIR is derived from the home directory at import time, so the temp
// home must be in place before anything under src/ is imported.
const tempHome = mkdtempSync(join(tmpdir(), 'polylane-telemetry-notice-test-'));
process.env.HOME = tempHome;
delete process.env.POLYLANE_TELEMETRY_NOTICE_ACK;

const { maybeShowTelemetryNotice, TELEMETRY_NOTICE_ACK_ENV } = await import('../src/telemetry/notice');
const { hasShownFirstRunNotice } = await import('../src/telemetry/state');
const { TELEMETRY_STATE_FILE } = await import('../src/config/paths');
const { mockConfig } = await import('./helpers/config');

function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return writes.join('');
}

describe('maybeShowTelemetryNotice', () => {
  beforeEach(() => {
    delete process.env[TELEMETRY_NOTICE_ACK_ENV];
    rmSync(TELEMETRY_STATE_FILE, { force: true });
  });

  it('prints the notice once and marks it shown', () => {
    const config = mockConfig({ telemetry: true, output: 'text' });
    const out = captureStderr(() => maybeShowTelemetryNotice(config, false));
    assert.match(out, /Anonymous usage telemetry is enabled/);
    assert.equal(hasShownFirstRunNotice(), true);
    const again = captureStderr(() => maybeShowTelemetryNotice(config, false));
    assert.equal(again, '');
  });

  it('POLYLANE_TELEMETRY_NOTICE_ACK=1 marks the notice shown without printing it', () => {
    process.env[TELEMETRY_NOTICE_ACK_ENV] = '1';
    const out = captureStderr(() => maybeShowTelemetryNotice(mockConfig({ telemetry: true, output: 'text' }), false));
    assert.equal(out, '');
    assert.equal(hasShownFirstRunNotice(), true);
  });

  it('honors the ack even on quiet or json runs', () => {
    process.env[TELEMETRY_NOTICE_ACK_ENV] = '1';
    maybeShowTelemetryNotice(mockConfig({ telemetry: true, quiet: true, output: 'text' }), false);
    assert.equal(hasShownFirstRunNotice(), true);
  });

  it('neither prints nor marks on quiet or json runs without the ack', () => {
    const out = captureStderr(() => {
      maybeShowTelemetryNotice(mockConfig({ telemetry: true, quiet: true, output: 'text' }), false);
      maybeShowTelemetryNotice(mockConfig({ telemetry: true, output: 'json' }), false);
    });
    assert.equal(out, '');
    assert.equal(hasShownFirstRunNotice(), false);
  });

  it('ignores the ack when telemetry is disabled', () => {
    process.env[TELEMETRY_NOTICE_ACK_ENV] = '1';
    maybeShowTelemetryNotice(mockConfig({ telemetry: false, output: 'text' }), false);
    assert.equal(hasShownFirstRunNotice(), false);
  });

  it('does nothing for telemetry commands', () => {
    const out = captureStderr(() => maybeShowTelemetryNotice(mockConfig({ telemetry: true, output: 'text' }), true));
    assert.equal(out, '');
    assert.equal(hasShownFirstRunNotice(), false);
  });
});
