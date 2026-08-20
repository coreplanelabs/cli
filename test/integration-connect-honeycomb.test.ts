import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { honeycombManagementKeyFields } from '../src/commands/integration/connect';
import { CLIError } from '../src/errors/base';

describe('honeycombManagementKeyFields', () => {
  it('returns both fields when both are set', () => {
    assert.deepEqual(honeycombManagementKeyFields('hcxik_id', 'secret'), {
      managementApiKeyId: 'hcxik_id',
      managementApiKeySecret: 'secret',
    });
  });

  it('throws when both are empty', () => {
    assert.throws(
      () => honeycombManagementKeyFields('', ''),
      (err: unknown) => err instanceof CLIError && err.message.includes('--management-api-key-id')
    );
  });

  it('throws when only the ID is set', () => {
    assert.throws(
      () => honeycombManagementKeyFields('hcxik_id', ''),
      (err: unknown) => err instanceof CLIError && err.message.includes('--management-api-key-secret')
    );
  });

  it('throws when only the secret is set', () => {
    assert.throws(
      () => honeycombManagementKeyFields('', 'secret'),
      (err: unknown) => err instanceof CLIError && err.message.includes('--management-api-key-id')
    );
  });
});
