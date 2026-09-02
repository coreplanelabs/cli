import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRailwayConnectBody, PROVIDER_OPTIONS } from '../src/commands/cloud/connect';

describe('buildRailwayConnectBody', () => {
  it('builds workspace, provider and token only when no Railway workspace is given', () => {
    const body = buildRailwayConnectBody('ws_1', 'rw-token');
    assert.deepEqual(body, {
      workspaceId: 'ws_1',
      provider: 'railway',
      token: 'rw-token',
    });
    assert.ok(!('railwayWorkspaceId' in body));
  });

  it('carries the Railway workspace under exactly the railwayWorkspaceId key', () => {
    const body = buildRailwayConnectBody('ws_1', 'rw-token', 'railway-ws-9');
    assert.deepEqual(body, {
      workspaceId: 'ws_1',
      provider: 'railway',
      token: 'rw-token',
      railwayWorkspaceId: 'railway-ws-9',
    });
    assert.deepEqual(Object.keys(body).sort(), ['provider', 'railwayWorkspaceId', 'token', 'workspaceId']);
  });
});

describe('PROVIDER_OPTIONS', () => {
  it('offers railway with its full label and hint', () => {
    const railway = PROVIDER_OPTIONS.find((o) => o.value === 'railway');
    assert.deepEqual(railway, { value: 'railway', label: 'Railway', hint: 'workspace or account token' });
  });
});
