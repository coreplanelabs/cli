import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECT_CATEGORIES,
  resolveTypeOptions,
  typeOptionsForCategory,
} from '../src/commands/integration/connect';
import { isCLIError } from '../src/errors/base';

describe('typeOptionsForCategory', () => {
  it('returns every option when no category is given', () => {
    const all = typeOptionsForCategory(undefined);
    assert.equal(all.length, 13);
  });

  it('narrows to exactly the observability integrations', () => {
    const types = typeOptionsForCategory('observability').map((o) => o.value);
    assert.deepEqual(types.sort(), ['axiom', 'betterstack', 'datadog', 'honeycomb', 'sentry']);
  });

  it('narrows to exactly the code agents', () => {
    const types = typeOptionsForCategory('code-agent').map((o) => o.value);
    assert.deepEqual(types.sort(), ['conductor', 'cursor', 'devin', 'factory']);
  });

  it('narrows to exactly the issue trackers', () => {
    const types = typeOptionsForCategory('issue-tracking').map((o) => o.value);
    assert.deepEqual(types, ['linear']);
  });

  it('covers every option with a known category', () => {
    for (const category of CONNECT_CATEGORIES) {
      assert.ok(typeOptionsForCategory(category).length > 0, `empty category: ${category}`);
    }
    const total = CONNECT_CATEGORIES.reduce(
      (n, category) => n + typeOptionsForCategory(category).length,
      0
    );
    assert.equal(total, typeOptionsForCategory(undefined).length);
  });

  it('rejects an unknown category with a usage error', () => {
    try {
      typeOptionsForCategory('nonsense');
      assert.fail('expected a CLIError');
    } catch (err) {
      assert.ok(isCLIError(err));
      assert.match((err as Error).message, /Unknown category/);
    }
  });
});

describe('resolveTypeOptions', () => {
  it('lets --type win over the filter', () => {
    assert.equal(resolveTypeOptions('observability', true).length, 13);
    assert.equal(resolveTypeOptions('observability', false).length, 5);
    assert.equal(resolveTypeOptions(undefined, false).length, 13);
  });

  it('rejects an unknown category even when --type is present', () => {
    try {
      resolveTypeOptions('observabilty', true);
      assert.fail('expected a CLIError');
    } catch (err) {
      assert.ok(isCLIError(err));
      assert.match((err as Error).message, /Unknown category/);
    }
  });
});
