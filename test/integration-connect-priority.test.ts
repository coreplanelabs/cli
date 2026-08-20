import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeCodeAgent, typeOptionsForCategory } from '../src/commands/integration/connect';

describe('prioritizeCodeAgent', () => {
  it('moves the local agent to the front of the code-agent group', () => {
    const { options, initialValue } = prioritizeCodeAgent(typeOptionsForCategory(undefined), 'cursor');
    const values = options.map((o) => o.value);
    assert.equal(initialValue, 'cursor');
    assert.equal(values.indexOf('cursor'), values.indexOf('devin') - 1);
    assert.equal(values[0], 'github');
    assert.equal(options.find((o) => o.value === 'cursor')?.hint, 'API key · your coding agent');
  });

  it('pre-highlights the local agent in a narrowed picker', () => {
    const { options, initialValue } = prioritizeCodeAgent(typeOptionsForCategory('code-agent'), 'cursor');
    assert.equal(options[0]?.value, 'cursor');
    assert.equal(initialValue, 'cursor');
  });

  it('keeps grouping intact', () => {
    const { options } = prioritizeCodeAgent(typeOptionsForCategory(undefined), 'cursor');
    const categories = options.map((o) => o.category);
    assert.deepEqual([...new Set(categories)], ['git', 'communication', 'observability', 'code-agent', 'protocol']);
    assert.equal(options.length, typeOptionsForCategory(undefined).length);
  });

  it('is a no-op when the local agent has no cloud counterpart', () => {
    const all = typeOptionsForCategory(undefined);
    for (const agent of [undefined, 'claude', 'zed']) {
      const { options, initialValue } = prioritizeCodeAgent(all, agent);
      assert.deepEqual(options, all);
      assert.equal(initialValue, undefined);
    }
  });
});
