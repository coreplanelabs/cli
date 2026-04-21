import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';

describe('CLIError', () => {
  it('has correct exit code and message', () => {
    const err = new CLIError('oops', ExitCode.USAGE, 'try --help');
    assert.equal(err.message, 'oops');
    assert.equal(err.exitCode, ExitCode.USAGE);
    assert.equal(err.hint, 'try --help');
  });

  it('toJSON produces correct shape', () => {
    const err = new CLIError('oops', ExitCode.AUTH, 'login');
    assert.deepEqual(err.toJSON(), {
      error: { code: ExitCode.AUTH, message: 'oops', hint: 'login' },
    });
  });
});

describe('mapApiError', () => {
  it('maps 400 -> USAGE', () => {
    const err = mapApiError(400, { message: 'Bad Request', detail: 'bad foo' });
    assert.equal(err.exitCode, ExitCode.USAGE);
    assert.equal(err.message, 'bad foo');
  });

  it('maps 401 -> AUTH with hint', () => {
    const err = mapApiError(401, { message: 'Unauthorized' });
    assert.equal(err.exitCode, ExitCode.AUTH);
    assert.ok(err.hint?.includes('nominal auth login'));
  });

  it('maps 403 -> AUTH', () => {
    const err = mapApiError(403, { message: 'Forbidden' });
    assert.equal(err.exitCode, ExitCode.AUTH);
  });

  it('maps 404 -> GENERAL', () => {
    const err = mapApiError(404, { message: 'Not found', detail: 'workspace xyz missing' });
    assert.equal(err.exitCode, ExitCode.GENERAL);
    assert.equal(err.message, 'workspace xyz missing');
  });

  it('maps 426 -> QUOTA', () => {
    const err = mapApiError(426, { message: 'Upgrade Required' });
    assert.equal(err.exitCode, ExitCode.QUOTA);
  });

  it('maps 429 -> QUOTA', () => {
    const err = mapApiError(429, { message: 'Slow down' });
    assert.equal(err.exitCode, ExitCode.QUOTA);
  });

  it('maps 500 -> GENERAL', () => {
    const err = mapApiError(500, { message: 'Internal error' });
    assert.equal(err.exitCode, ExitCode.GENERAL);
  });

  it('handles null error payload', () => {
    const err = mapApiError(500, null);
    assert.equal(err.exitCode, ExitCode.GENERAL);
  });
});
