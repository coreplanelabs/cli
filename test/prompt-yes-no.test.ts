import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYesNo } from '../src/utils/prompt';

describe('parseYesNo (the installer [Y/n] shape)', () => {
  it('Enter keeps the default', () => {
    assert.equal(parseYesNo('', true), true);
    assert.equal(parseYesNo('   ', true), true);
    assert.equal(parseYesNo('', false), false);
  });

  it('anything starting with n says no, anything starting with y says yes, case-insensitively', () => {
    assert.equal(parseYesNo('n', true), false);
    assert.equal(parseYesNo('No thanks', true), false);
    assert.equal(parseYesNo('y', false), true);
    assert.equal(parseYesNo('YES', false), true);
  });

  it('an unrelated answer keeps the default, like install.sh', () => {
    assert.equal(parseYesNo('maybe', true), true);
    assert.equal(parseYesNo('maybe', false), false);
  });
});
