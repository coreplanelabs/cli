import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/commands/helpers';
import { CLIError } from '../src/errors/base';

describe('parseDuration', () => {
  it('parses seconds', () => {
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('30'), 30_000);
  });

  it('parses minutes', () => {
    assert.equal(parseDuration('15m'), 15 * 60 * 1000);
  });

  it('parses hours', () => {
    assert.equal(parseDuration('1h'), 60 * 60 * 1000);
    assert.equal(parseDuration('24h'), 24 * 60 * 60 * 1000);
  });

  it('parses days and weeks', () => {
    assert.equal(parseDuration('7d'), 7 * 24 * 60 * 60 * 1000);
    assert.equal(parseDuration('2w'), 2 * 7 * 24 * 60 * 60 * 1000);
  });

  it('throws on invalid input', () => {
    assert.throws(() => parseDuration('banana'), CLIError);
    assert.throws(() => parseDuration('1y'), CLIError);
  });
});
