import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from '../src/utils/prompt';

describe('wrapText', () => {
  it('leaves short lines untouched', () => {
    assert.equal(wrapText('short line', 40), 'short line');
  });

  it('wraps long lines at word boundaries', () => {
    const wrapped = wrapText('one two three four five six seven', 12);
    assert.deepEqual(wrapped.split('\n'), ['one two', 'three four', 'five six', 'seven']);
    for (const line of wrapped.split('\n')) {
      assert.ok(line.length <= 12);
    }
  });

  it('preserves existing line breaks and blank lines', () => {
    assert.equal(wrapText('first\n\nsecond', 40), 'first\n\nsecond');
  });

  it('keeps the leading indentation on wrapped lines', () => {
    const wrapped = wrapText('  indented words that wrap around', 14);
    for (const line of wrapped.split('\n')) {
      assert.ok(line.startsWith('  '), `"${line}" keeps its indent`);
    }
  });

  it('never splits a word longer than the width, such as a URL', () => {
    const url = 'https://app.us5.datadoghq.com/organization-settings/application-keys';
    const wrapped = wrapText(`  ${url}`, 30);
    assert.ok(wrapped.includes(url));
  });
});
