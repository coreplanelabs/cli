import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceIdStrict, formatServiceId } from '../src/commands/service/id';

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
