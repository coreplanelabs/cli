import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logfireKeyFields, typeOptionsForCategory } from '../src/commands/integration/connect';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';

describe('logfireKeyFields', () => {
  it('returns both keys when both are set', () => {
    assert.deepEqual(logfireKeyFields('pylf_v1_us_project', 'pylf_v1_us_org'), {
      apiKey: 'pylf_v1_us_project',
      organizationApiKey: 'pylf_v1_us_org',
    });
  });

  it('trims surrounding whitespace from both keys', () => {
    assert.deepEqual(logfireKeyFields('  pylf_v1_us_project\n', '\tpylf_v1_us_org  '), {
      apiKey: 'pylf_v1_us_project',
      organizationApiKey: 'pylf_v1_us_org',
    });
  });

  it('names --api-key when the project key is missing', () => {
    assert.throws(
      () => logfireKeyFields('', 'pylf_v1_us_org'),
      (err: unknown) =>
        err instanceof CLIError && err.exitCode === ExitCode.USAGE && err.message.includes('--api-key')
    );
    assert.throws(
      () => logfireKeyFields('   ', 'pylf_v1_us_org'),
      (err: unknown) => err instanceof CLIError && err.message.includes('--api-key')
    );
  });

  it('names --organization-api-key when the organization key is missing', () => {
    assert.throws(
      () => logfireKeyFields('pylf_v1_us_project', ''),
      (err: unknown) =>
        err instanceof CLIError && err.exitCode === ExitCode.USAGE && err.message.includes('--organization-api-key')
    );
    assert.throws(
      () => logfireKeyFields('pylf_v1_us_project', ' \n'),
      (err: unknown) => err instanceof CLIError && err.message.includes('--organization-api-key')
    );
  });

  it('reports the project key first when both are missing', () => {
    assert.throws(
      () => logfireKeyFields('', ''),
      (err: unknown) => err instanceof CLIError && err.message.includes('--api-key')
    );
  });
});

describe('Logfire type option', () => {
  it('is offered under the observability category', () => {
    const logfire = typeOptionsForCategory('observability').find((o) => o.value === 'logfire');
    assert.ok(logfire);
    assert.equal(logfire.label, 'Logfire');
  });

  it('is not offered under other categories', () => {
    for (const category of ['git', 'communication', 'product-analytics', 'code-agent', 'issue-tracking', 'protocol']) {
      assert.equal(typeOptionsForCategory(category).some((o) => o.value === 'logfire'), false, category);
    }
  });
});
