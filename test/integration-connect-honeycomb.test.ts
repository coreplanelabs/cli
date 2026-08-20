import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { honeycombManagementKeyFields, assertHoneycombManagementKeyStored } from '../src/commands/integration/connect';
import { CLIError } from '../src/errors/base';
import type { Integration } from '../src/generated/types';

describe('honeycombManagementKeyFields', () => {
  it('returns both fields when both are set', () => {
    assert.deepEqual(honeycombManagementKeyFields('hcxik_id', 'secret'), {
      managementApiKeyId: 'hcxik_id',
      managementApiKeySecret: 'secret',
    });
  });

  it('trims surrounding whitespace from both fields', () => {
    assert.deepEqual(honeycombManagementKeyFields('  hcxik_id\n', '\tsecret  '), {
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

  it('treats whitespace-only values as missing', () => {
    assert.throws(
      () => honeycombManagementKeyFields('  ', 'secret'),
      (err: unknown) => err instanceof CLIError && err.message.includes('--management-api-key-id')
    );
    assert.throws(
      () => honeycombManagementKeyFields('hcxik_id', ' \n'),
      (err: unknown) => err instanceof CLIError && err.message.includes('--management-api-key-secret')
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

type ConnectedIntegration = Pick<Integration, 'id' | 'metadata' | '_html_url'>;

function honeycombIntegration(extra: Record<string, unknown>, htmlUrl?: string): ConnectedIntegration {
  return {
    id: 'integration_test1',
    metadata: {
      type: 'honeycomb',
      region: 'us',
      apiKey: '',
      teamSlug: 'team',
      environmentSlug: 'env',
      ...extra,
    },
    ...(htmlUrl ? { _html_url: htmlUrl } : {}),
  };
}

describe('assertHoneycombManagementKeyStored', () => {
  it('passes when the response metadata carries the management key ID', () => {
    assert.doesNotThrow(() =>
      assertHoneycombManagementKeyStored(honeycombIntegration({ managementApiKeyId: 'hcxik_id' }))
    );
  });

  it('throws when the API dropped the management key fields', () => {
    assert.throws(
      () => assertHoneycombManagementKeyStored(honeycombIntegration({})),
      (err: unknown) =>
        err instanceof CLIError &&
        err.message ===
          'The Polylane API does not support the Honeycomb Management API key yet — the key was not stored' &&
        err.hint !== undefined &&
        err.hint.includes('polylane integration disconnect integration_test1 --yes')
    );
  });

  it('throws when the stored management key ID is empty', () => {
    assert.throws(
      () => assertHoneycombManagementKeyStored(honeycombIntegration({ managementApiKeyId: '' })),
      (err: unknown) => err instanceof CLIError
    );
  });

  it('throws when the response has no metadata', () => {
    assert.throws(
      () => assertHoneycombManagementKeyStored({ id: 'integration_test1', metadata: null }),
      (err: unknown) => err instanceof CLIError
    );
  });

  it('includes the console link in the hint when the response carries one', () => {
    assert.throws(
      () => assertHoneycombManagementKeyStored(honeycombIntegration({}, 'https://console.example/integration_test1')),
      (err: unknown) =>
        err instanceof CLIError &&
        err.hint !== undefined &&
        err.hint.includes('or reconnect from the console: https://console.example/integration_test1')
    );
  });
});
