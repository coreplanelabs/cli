import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toIdentifier, toSafeName, schemaToTypescript } from '../codegen/type-utils';
import type { SchemaObject } from '../codegen/types';

describe('toIdentifier', () => {
  it('converts multi-word names to PascalCase', () => {
    assert.equal(toIdentifier('Api Key'), 'ApiKey');
    assert.equal(toIdentifier('cloud_account_repo'), 'CloudAccountRepo');
    assert.equal(toIdentifier('Public Workspace'), 'PublicWorkspace');
  });

  it('handles already-capitalized inputs', () => {
    assert.equal(toIdentifier('Workspace'), 'Workspace');
  });
});

describe('toSafeName', () => {
  it('passes through simple identifiers', () => {
    assert.equal(toSafeName('foo'), 'foo');
  });

  it('handles reserved words', () => {
    assert.equal(toSafeName('class'), 'class_');
    assert.equal(toSafeName('new'), 'new_');
  });

  it('quotes names with special characters', () => {
    assert.equal(toSafeName('a.b'), '"a.b"');
  });
});

describe('schemaToTypescript', () => {
  const schemas = new Map<string, SchemaObject>();

  it('converts primitives', () => {
    assert.equal(schemaToTypescript({ type: 'string' }, schemas), 'string');
    assert.equal(schemaToTypescript({ type: 'integer' }, schemas), 'number');
    assert.equal(schemaToTypescript({ type: 'boolean' }, schemas), 'boolean');
  });

  it('handles nullable', () => {
    assert.equal(
      schemaToTypescript({ type: 'string', nullable: true }, schemas),
      'string | null'
    );
  });

  it('handles enum', () => {
    assert.equal(
      schemaToTypescript({ type: 'string', enum: ['a', 'b'] }, schemas),
      '"a" | "b"'
    );
  });

  it('handles arrays', () => {
    assert.equal(
      schemaToTypescript({ type: 'array', items: { type: 'string' } }, schemas),
      'Array<string>'
    );
  });

  it('handles $ref with prefix option', () => {
    assert.equal(
      schemaToTypescript({ $ref: '#/components/schemas/Workspace' }, schemas, { refPrefix: 'T.' }),
      'T.Workspace'
    );
  });

  it('handles objects with required fields', () => {
    const out = schemaToTypescript(
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      },
      schemas
    );
    assert.ok(out.includes('id: string'));
    assert.ok(out.includes('name?: string'));
  });

  it('handles oneOf as union', () => {
    const out = schemaToTypescript(
      {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      },
      schemas
    );
    assert.equal(out, '(string | number)');
  });
});
