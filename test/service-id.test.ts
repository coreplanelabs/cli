import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceIdStrict, formatServiceId, resolveServiceId } from '../src/commands/service/id';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';

describe('parseServiceIdStrict', () => {
  it('parses full form', () => {
    const out = parseServiceIdStrict('aws/123456789/us-east-1/aws.lambda.function/payments');
    assert.deepEqual(out, {
      provider: 'aws',
      account: '123456789',
      region: 'us-east-1',
      type: 'aws.lambda.function',
      id: 'payments',
    });
  });

  it('handles slashes in the ID part', () => {
    const out = parseServiceIdStrict(
      'aws/123/us-east-1/aws.lambda.function/my/deeply/nested/name'
    );
    assert.equal(out?.id, 'my/deeply/nested/name');
  });

  it('returns null for invalid forms', () => {
    assert.equal(parseServiceIdStrict('just-a-name'), null);
    assert.equal(parseServiceIdStrict('aws/only/three/parts'), null);
  });

  it('rejects unknown providers', () => {
    assert.equal(parseServiceIdStrict('unknown-provider/a/b/c/d'), null);
  });
});

describe('formatServiceId', () => {
  it('round-trips', () => {
    const id = 'cloudflare/acct/global/cf.workers.script/my-worker';
    const parsed = parseServiceIdStrict(id);
    assert.ok(parsed);
    assert.equal(formatServiceId(parsed), id);
  });
});

describe('resolveServiceId', () => {
  it('accepts the full form', () => {
    assert.deepEqual(resolveServiceId('aws/123456789/us-east-1/aws.lambda.function/payments'), {
      provider: 'aws',
      account: '123456789',
      region: 'us-east-1',
      type: 'aws.lambda.function',
      id: 'payments',
    });
  });

  it('rejects a short name with the full form in the hint', () => {
    assert.throws(
      () => resolveServiceId('payments'),
      (err: unknown) => {
        assert.ok(err instanceof CLIError);
        assert.equal(err.exitCode, ExitCode.USAGE);
        assert.match(err.hint ?? '', /<provider>\/<account>\/<region>\/<type>\/<id>/);
        return true;
      }
    );
  });
});
