import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getByPath, pickFields, projectItems } from '../src/output/project';

describe('getByPath', () => {
  it('reads top-level properties', () => {
    assert.equal(getByPath({ a: 1 }, 'a'), 1);
  });

  it('reads nested properties', () => {
    assert.equal(getByPath({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
  });

  it('returns undefined for missing paths', () => {
    assert.equal(getByPath({ a: 1 }, 'a.b.c'), undefined);
    assert.equal(getByPath({}, 'x'), undefined);
  });
});

describe('pickFields', () => {
  it('picks specified fields', () => {
    const out = pickFields({ a: 1, b: 2, c: 3 }, ['a', 'c']);
    assert.deepEqual(out, { a: 1, c: 3 });
  });

  it('supports nested paths', () => {
    const out = pickFields({ a: { b: 1 }, c: 2 }, ['a.b', 'c']);
    assert.deepEqual(out, { 'a.b': 1, c: 2 });
  });

  it('supports renaming', () => {
    const out = pickFields({ id: 'x', verbose_name: 'Foo' }, [
      'id',
      { from: 'verbose_name', to: 'name' },
    ]);
    assert.deepEqual(out, { id: 'x', name: 'Foo' });
  });
});

describe('projectItems', () => {
  it('projects an array of items', () => {
    const out = projectItems(
      [
        { id: 1, name: 'a', extra: 'x' },
        { id: 2, name: 'b', extra: 'y' },
      ],
      ['id', 'name']
    );
    assert.deepEqual(out, [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
  });
});
