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

// A stand-in for the graph's node list: applies one clause per request the way the graph
// does ("=" on a field, LIKE with % and _ wildcards, case-insensitive), then the page limit.
function graphApi(nodes: InfrastructureNode[], seen: ListBody[] = []) {
  const fieldValues = (n: InfrastructureNode, field: string): unknown[] =>
    field === 'id' ? [n.id] : field === 'name' ? [n.data?.name] : field === 'alternate_names' ? n.alternateNames ?? [] : [];
  const likeToRegExp = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
  return {
    async cloudInfraNodesList(body: ListBody) {
      seen.push(body);
      const clause = body.clauses?.[0];
      const items = nodes
        .filter((n) => {
          if (!clause) return true;
          const values = fieldValues(n, clause.field);
          if (clause.predicate === 'LIKE') {
            // alternate_names is matched as its JSON text, as the graph stores it.
            const text = clause.field === 'alternate_names' ? [JSON.stringify(values)] : values;
            return text.some((v) => typeof v === 'string' && likeToRegExp(String(clause.value)).test(v));
          }
          return values.includes(clause.value);
        })
        .slice(0, body.options?.limit ?? 50);
      return { items, count: items.length };
    },
  } as unknown as Pick<PolylaneAPI, 'cloudInfraNodesList'>;
}

describe('findServiceNodes', () => {
  it('sends one scoped LIKE query per name field and merges without duplicates', async () => {
    const seen: ListBody[] = [];
    const api = graphApi([node('payments-api', { data: { name: 'payments-api' } }), node('worker-2', { data: { name: 'payments-worker' } })], seen);
    const items = await findServiceNodes(api, 'ws_1', 'payments', { provider: 'cloudflare' });

    assert.deepEqual(
      items.map((n) => n.id),
      ['payments-api', 'worker-2']
    );
    assert.deepEqual(
      seen.map((b) => b.clauses),
      ['id', 'name', 'alternate_names'].map((field) => [{ field, value: '%payments%', predicate: 'LIKE' }])
    );
    for (const b of seen) {
      assert.equal(b.workspaceId, 'ws_1');
      assert.deepEqual(b.filters, { provider: 'cloudflare' });
      assert.deepEqual(b.options, { limit: 50 });
    }
  });

  it('omits filters when none are given', async () => {
    const seen: ListBody[] = [];
    await findServiceNodes(graphApi([], seen), 'ws_1', 'x');
    assert.ok(seen.every((b) => !('filters' in b)));
  });

  it('keeps substring matching for a query with an underscore, in every name field', async () => {
    const api = graphApi([
      node('prod-payments_api-worker'),
      node('n2', { data: { name: 'prod-payments_api-cron' } }),
      node('n3', { alternateNames: ['payments_api'] }),
      node('payments-api-lookalike'),
    ]);
    const items = await findServiceNodes(api, 'ws_1', 'payments_api', { provider: 'cloudflare', type: 'cf.workers.script' });
    assert.deepEqual(items.map((n) => n.id).sort(), ['n2', 'n3', 'prod-payments_api-worker']);
  });
});

describe('resolveServiceId', () => {
  it('returns the full form without calling the API', async () => {
    const seen: ListBody[] = [];
    const out = await resolveServiceId(config, 'aws/1/us-east-1/aws.lambda.function/pay_api', 'ws_1', graphApi([], seen));
    assert.equal(out.id, 'pay_api');
    assert.equal(seen.length, 0);
  });

  it('picks the single exact match among substring matches', async () => {
    const api = graphApi([node('a', { data: { name: 'payments' } }), node('b', { data: { name: 'payments-v2' } })]);
    const out = await resolveServiceId(config, 'payments', 'ws_1', api);
    assert.equal(out.id, 'a');
  });

  it('finds an exact name or alias hidden behind a full page of partial matches', async () => {
    const filler = Array.from({ length: 60 }, (_, i) => node(`payments-${i}`));
    const byName = await resolveServiceId(config, 'payments', 'ws_1', graphApi([...filler, node('x', { data: { name: 'payments' } })]));
    assert.equal(byName.id, 'x');
    const byAlias = await resolveServiceId(config, 'payments', 'ws_1', graphApi([...filler, node('y', { alternateNames: ['payments'] })]));
    assert.equal(byAlias.id, 'y');
  });

  it('reports two exact matches as ambiguous, even when one sits behind partial matches', async () => {
    const filler = Array.from({ length: 60 }, (_, i) => node(`payments-${i}`));
    const api = graphApi([...filler, node('payments'), node('z', { data: { name: 'payments' } })]);
    await assert.rejects(
      () => resolveServiceId(config, 'payments', 'ws_1', api),
      (err: unknown) => err instanceof CLIError && err.message.includes('Multiple services') && (err.hint?.includes('/z') ?? false)
    );
  });

  it('resolves a short name with an underscore through its alias', async () => {
    const out = await resolveServiceId(config, 'payments_api', 'ws_1', graphApi([node('n3', { alternateNames: ['payments_api'] })]));
    assert.equal(out.id, 'n3');
  });

  it('returns the only match', async () => {
    const out = await resolveServiceId(config, 'pay', 'ws_1', graphApi([node('payments')]));
    assert.equal(out.id, 'payments');
  });

  it('treats a full page of partial matches as ambiguous', async () => {
    const api = graphApi(Array.from({ length: 50 }, (_, i) => node(`pay-${i}`)));
    await assert.rejects(
      () => resolveServiceId(config, 'pay', 'ws_1', api),
      (err: unknown) => err instanceof CLIError && err.message.includes('Multiple services')
    );
  });

  it('throws with candidates when several match', async () => {
    const api = graphApi([node('pay-1'), node('pay-2')]);
    await assert.rejects(
      () => resolveServiceId(config, 'pay', 'ws_1', api),
      (err: unknown) => err instanceof CLIError && err.message.includes('Multiple services') && (err.hint?.includes('pay-2') ?? false)
    );
  });

  it('throws when nothing matches', async () => {
    await assert.rejects(
      () => resolveServiceId(config, 'nope', 'ws_1', graphApi([])),
      (err: unknown) => err instanceof CLIError && err.message.includes('No service found')
    );
  });
});
