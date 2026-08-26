import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { settledExitCode } from '../src/exit-code';
import { ExitCode } from '../src/errors/codes';
import { connectExitCode } from '../src/commands/cloud/connect';

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

  it('exits with the pending code when a connect left the CloudFormation stack still creating', () => {
    assert.equal(runConfigShow(String(ExitCode.PENDING)), 7);
  });
});

describe('cloud connect exit code', () => {
  it('is SUCCESS when every leg connected', () => {
    assert.equal(connectExitCode('connected', null), ExitCode.SUCCESS);
    assert.equal(connectExitCode('connected', 'connected'), ExitCode.SUCCESS);
    assert.equal(connectExitCode(null, 'connected'), ExitCode.SUCCESS);
  });

  it('is PENDING when the CloudFormation stack is still creating', () => {
    assert.equal(connectExitCode(null, 'pending'), ExitCode.PENDING);
    assert.equal(connectExitCode('connected', 'pending'), ExitCode.PENDING);
  });

  it('is GENERAL when a browser wait timed out, even if AWS is merely pending', () => {
    assert.equal(connectExitCode('timeout', null), ExitCode.GENERAL);
    assert.equal(connectExitCode('timeout', 'pending'), ExitCode.GENERAL);
    assert.equal(connectExitCode('timeout', 'connected'), ExitCode.GENERAL);
  });
});
