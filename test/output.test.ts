import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { formatValue } from '../src/output/text';

describe('formatValue', () => {
  it('handles primitives', () => {
    assert.equal(formatValue('foo'), 'foo');
    assert.equal(formatValue(42), '42');
    assert.equal(formatValue(true), 'true');
  });

  it('handles null/undefined', () => {
    assert.equal(formatValue(null), '');
    assert.equal(formatValue(undefined), '');
  });

  it('joins arrays with comma', () => {
    assert.equal(formatValue(['a', 'b', 'c']), 'a, b, c');
  });

  it('pretty-prints objects as key-value', () => {
    assert.equal(formatValue({ a: 1 }), 'a  1');
  });

  it('indents nested objects', () => {
    const out = formatValue({ user: { name: 'Boris' } });
    assert.ok(out.includes('user'));
    assert.ok(out.includes('name  Boris'));
    assert.ok(!out.includes('{"'));
  });
});

describe('outputJson', () => {
  let output = '';
  let origWrite: typeof process.stdout.write;

  before(() => {
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  after(() => {
    process.stdout.write = origWrite;
  });

  it('pretty-prints JSON', async () => {
    const { outputJson } = await import('../src/output/json');
    output = '';
    outputJson({ a: 1, b: [2, 3] });
    assert.ok(output.includes('"a": 1'));
    assert.ok(output.endsWith('\n'));
  });
});
