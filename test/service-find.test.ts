import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findServiceNodes, resolveServiceId } from '../src/commands/service/id';
import { CLIError } from '../src/errors/base';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';
import type { InfrastructureNode } from '../src/generated/types';

type ListBody = Parameters<PolylaneAPI['cloudInfraNodesList']>[0];

const config = { nonInteractive: true } as Config;

function node(id: string, extra: Partial<InfrastructureNode> = {}): InfrastructureNode {
  return {
    workspaceId: 'ws_1',
    data: {},
    alternateNames: [],
    createdBy: 'u',
    lastEditedBy: 'u',
    updated: null,
    created: null,
    id,
    provider: 'cloudflare',
    account: 'acct',
    region: 'global',
    type: 'cf.workers.script',
    category: 'compute',
    _object: 'infra_node',
    ...extra,
  };
}

function mockApi(byField: Record<string, InfrastructureNode[]>, seen: ListBody[] = []) {
  return {
    async cloudInfraNodesList(body: ListBody) {
      seen.push(body);
      const field = body.clauses?.[0]?.field ?? '';
      const items = byField[field] ?? [];
      return { items, count: items.length };
    },
  } as unknown as Pick<PolylaneAPI, 'cloudInfraNodesList'>;
}

describe('findServiceNodes', () => {
  it('sends one scoped LIKE query per name field and merges without duplicates', async () => {
    const seen: ListBody[] = [];
    const api = mockApi(
      { id: [node('payments-api')], name: [node('payments-api'), node('worker-2')], alternate_names: [] },
      seen
    );
    const items = await findServiceNodes(api, 'ws_1', 'payments', { provider: 'cloudflare' });

    assert.deepEqual(
      items.map((n) => n.id),
      ['payments-api', 'worker-2']
    );
    assert.deepEqual(
      seen.map((b) => b.clauses),
      ['id', 'name', 'alternate_names'].map((field) => [{ field, value: 'payments', predicate: 'LIKE' }])
    );
    for (const b of seen) {
      assert.equal(b.workspaceId, 'ws_1');
      assert.deepEqual(b.filters, { provider: 'cloudflare' });
      assert.deepEqual(b.options, { limit: 50 });
    }
  });

  it('omits filters when none are given', async () => {
    const seen: ListBody[] = [];
    await findServiceNodes(mockApi({}, seen), 'ws_1', 'x');
    assert.ok(seen.every((b) => !('filters' in b)));
  });
});

describe('resolveServiceId', () => {
  it('returns the full form without calling the API', async () => {
    const seen: ListBody[] = [];
    const out = await resolveServiceId(config, 'aws/1/us-east-1/aws.lambda.function/pay', 'ws_1', mockApi({}, seen));
    assert.equal(out.id, 'pay');
    assert.equal(seen.length, 0);
  });

  it('picks the single exact match among substring matches', async () => {
    const api = mockApi({ name: [node('a', { data: { name: 'payments' } }), node('b', { data: { name: 'payments-v2' } })] });
    const out = await resolveServiceId(config, 'payments', 'ws_1', api);
    assert.equal(out.id, 'a');
  });

  it('returns the only match', async () => {
    const out = await resolveServiceId(config, 'pay', 'ws_1', mockApi({ id: [node('payments')] }));
    assert.equal(out.id, 'payments');
  });

  it('throws with candidates when several match', async () => {
    const api = mockApi({ id: [node('pay-1'), node('pay-2')] });
    await assert.rejects(
      () => resolveServiceId(config, 'pay', 'ws_1', api),
      (err: unknown) => err instanceof CLIError && err.message.includes('Multiple services') && (err.hint?.includes('pay-2') ?? false)
    );
  });

  it('throws when nothing matches', async () => {
    await assert.rejects(
      () => resolveServiceId(config, 'nope', 'ws_1', mockApi({})),
      (err: unknown) => err instanceof CLIError && err.message.includes('No service found')
    );
  });
});
