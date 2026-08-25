import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { settledExitCode } from '../src/exit-code';

describe('settledExitCode', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('is 0 when no command flagged a soft failure', () => {
    assert.equal(settledExitCode(), 0);
  });

  it('carries the code a command set on process.exitCode', () => {
    process.exitCode = 1;
    assert.equal(settledExitCode(), 1);
  });
});

describe('main honors process.exitCode after a command completes', () => {
  // Preload sets process.exitCode the way the connect commands do on a
  // browser-wait timeout; `config show` completes without throwing.
  function runConfigShow(preset: string): number | null {
    const home = mkdtempSync(join(tmpdir(), 'polylane-exit-code-test-'));
    try {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', './test/helpers/preset-exit-code.ts', 'src/main.ts', 'config', 'show'],
        {
          cwd: join(import.meta.dirname, '..'),
          env: { ...process.env, HOME: home, PRESET_EXIT_CODE: preset, POLYLANE_TELEMETRY: '0' },
          encoding: 'utf8',
        }
      );
      return result.status;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('exits 0 when nothing was flagged', () => {
    assert.equal(runConfigShow('0'), 0);
  });

  it('exits with the flagged code instead of 0', () => {
    assert.equal(runConfigShow('1'), 1);
  });
});
