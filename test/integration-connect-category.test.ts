import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECT_CATEGORIES,
  typeOptionsForCategory,
} from '../src/commands/integration/connect';
import { isCLIError } from '../src/errors/base';

describe('typeOptionsForCategory', () => {
  it('returns every option when no category is given', () => {
    const all = typeOptionsForCategory(undefined);
    assert.equal(all.length, 11);
  });

  it('narrows to exactly the observability integrations', () => {
    const types = typeOptionsForCategory('observability').map((o) => o.value);
    assert.deepEqual(types.sort(), ['axiom', 'betterstack', 'datadog', 'honeycomb', 'sentry']);
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
