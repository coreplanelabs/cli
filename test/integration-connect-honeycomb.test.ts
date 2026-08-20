import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { honeycombManagementKeyFields } from '../src/commands/integration/connect';

describe('honeycombManagementKeyFields', () => {
  it('returns both fields when both are set', () => {
    assert.deepEqual(honeycombManagementKeyFields('hcxik_id', 'secret'), {
      managementApiKeyId: 'hcxik_id',
      managementApiKeySecret: 'secret',
    });
  });

  it('returns nothing when both are empty', () => {
    assert.deepEqual(honeycombManagementKeyFields('', ''), {});
  });

  it('returns nothing when only the ID is set', () => {
    assert.deepEqual(honeycombManagementKeyFields('hcxik_id', ''), {});
  });

  it('returns nothing when only the secret is set', () => {
    assert.deepEqual(honeycombManagementKeyFields('', 'secret'), {});
  });
});
