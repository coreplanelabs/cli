import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { axiomRegionFromEdgeDeployment, detectAxiomRegion } from '../src/commands/integration/connect';

describe('axiomRegionFromEdgeDeployment', () => {
  it('maps edge deployment identifiers to regions', () => {
    assert.equal(axiomRegionFromEdgeDeployment('cloud.eu-central-1.aws'), 'eu-central-1');
    assert.equal(axiomRegionFromEdgeDeployment('cloud.us-east-1.aws'), 'us-east-1');
    assert.equal(axiomRegionFromEdgeDeployment('eu-central-1.aws.edge.axiom.co'), 'eu-central-1');
    assert.equal(axiomRegionFromEdgeDeployment('us-east-1.aws.edge.axiom.co'), 'us-east-1');
  });

  it('returns null for unknown or non-string values', () => {
    assert.equal(axiomRegionFromEdgeDeployment('cloud.ap-south-1.aws'), null);
    assert.equal(axiomRegionFromEdgeDeployment(''), null);
    assert.equal(axiomRegionFromEdgeDeployment(undefined), null);
    assert.equal(axiomRegionFromEdgeDeployment(42), null);
  });
});

type Route = { status: number; body?: unknown } | 'error';

function mockFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    const route = routes[path];
    assert.ok(route, `unexpected fetch: ${path}`);
    if (route === 'error') throw new Error('network down');
    return new Response(JSON.stringify(route.body ?? null), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('detectAxiomRegion', () => {
  it('detects the region from the org default edge deployment', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': { status: 200, body: [{ id: 'org1', defaultEdgeDeployment: 'cloud.eu-central-1.aws' }] },
        '/v2/datasets': { status: 200, body: [] },
      })
    );
    assert.deepEqual(result, { outcome: 'detected', region: 'eu-central-1' });
  });

  it('falls back to dataset edge deployments when orgs is forbidden', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': { status: 403 },
        '/v2/datasets': {
          status: 200,
          body: [
            { id: 'logs', edgeDeployment: 'cloud.us-east-1.aws' },
            { id: 'traces', edgeDeployment: 'cloud.us-east-1.aws' },
          ],
        },
      })
    );
    assert.deepEqual(result, { outcome: 'detected', region: 'us-east-1' });
  });

  it('falls back to datasets when org regions are ambiguous', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': {
          status: 200,
          body: [
            { id: 'org1', defaultEdgeDeployment: 'cloud.us-east-1.aws' },
            { id: 'org2', defaultEdgeDeployment: 'cloud.eu-central-1.aws' },
          ],
        },
        '/v2/datasets': { status: 200, body: [{ id: 'logs', edgeDeployment: 'cloud.eu-central-1.aws' }] },
      })
    );
    assert.deepEqual(result, { outcome: 'detected', region: 'eu-central-1' });
  });

  it('is unknown when datasets span both regions', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': { status: 403 },
        '/v2/datasets': {
          status: 200,
          body: [
            { id: 'logs', edgeDeployment: 'cloud.us-east-1.aws' },
            { id: 'traces', edgeDeployment: 'cloud.eu-central-1.aws' },
          ],
        },
      })
    );
    assert.deepEqual(result, { outcome: 'unknown' });
  });

  it('is unknown when no response carries an edge deployment', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': { status: 200, body: [{ id: 'org1' }] },
        '/v2/datasets': { status: 200, body: [{ id: 'logs' }] },
      })
    );
    assert.deepEqual(result, { outcome: 'unknown' });
  });

  it('is unauthorized when every probe returns 401', async () => {
    const result = await detectAxiomRegion(
      'xaat-bad',
      mockFetch({
        '/v2/orgs': { status: 401 },
        '/v2/datasets': { status: 401 },
      })
    );
    assert.deepEqual(result, { outcome: 'unauthorized' });
  });

  it('is unauthorized on a single 401 even when the other probe fails on the network', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': 'error',
        '/v2/datasets': { status: 401 },
      })
    );
    assert.deepEqual(result, { outcome: 'unauthorized' });
  });

  it('is unknown when both probes fail on the network', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': 'error',
        '/v2/datasets': 'error',
      })
    );
    assert.deepEqual(result, { outcome: 'unknown' });
  });

  it('is unknown when a body is not the expected array', async () => {
    const result = await detectAxiomRegion(
      'xaat-token',
      mockFetch({
        '/v2/orgs': { status: 200, body: { defaultEdgeDeployment: 'cloud.us-east-1.aws' } },
        '/v2/datasets': { status: 200, body: 'nope' },
      })
    );
    assert.deepEqual(result, { outcome: 'unknown' });
  });

  it('sends the token as a bearer header to api.axiom.co', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      seen.push({ url, auth: headers.get('authorization') });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await detectAxiomRegion('xaat-secret', fetchFn);
    assert.equal(seen.length, 2);
    for (const req of seen) {
      assert.ok(req.url.startsWith('https://api.axiom.co/v2/'), req.url);
      assert.equal(req.auth, 'Bearer xaat-secret');
    }
  });
});
