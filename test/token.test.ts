import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskToken } from '../src/utils/token';

describe('maskToken', () => {
  it('returns (none) for null/empty', () => {
    assert.equal(maskToken(null), '(none)');
    assert.equal(maskToken(undefined), '(none)');
    assert.equal(maskToken(''), '(none)');
  });

  it('shows first 4 and last 4 for long tokens', () => {
    assert.equal(maskToken('sk_abc1234567defg8901'), 'sk_a...8901');
  });

  it('handles short tokens', () => {
    assert.equal(maskToken('short'), 'sh...rt');
  });

  it('handles very short tokens', () => {
    assert.equal(maskToken('abc'), '***');
  });
});
