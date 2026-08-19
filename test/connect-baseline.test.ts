import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { integrationBaseline } from '../src/commands/integration/connect';
import { accountBaseline } from '../src/commands/cloud/connect';
import { waitForBrowserCompletion } from '../src/commands/helpers';
import { mockConfig } from './helpers/config';
import type { PolylaneAPI } from '../src/generated/client';
import type { Integration, CloudAccount } from '../src/generated/types';

function integrationApi(pages: Array<Array<Partial<Integration>>>): PolylaneAPI {
  let call = 0;
  return {
    integrationsList: async () => {
      const items = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return { items, count: items!.length };
    },
  } as unknown as PolylaneAPI;
}

function cloudApi(pages: Array<Array<Partial<CloudAccount>>>): PolylaneAPI {
  let call = 0;
  return {
    cloudAccountsList: async () => {
      const items = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return { items, count: items!.length };
    },
  } as unknown as PolylaneAPI;
}

describe('integrationBaseline', () => {
  it('surfaces already-connected integrations for the short-circuit', async () => {
    const api = integrationApi([[{ id: 'i1', name: 'Acme GitHub', updated: 't1' }]]);
    const baseline = await integrationBaseline(api, 'ws_1', 'github');
    assert.equal(baseline.existing.length, 1);
    assert.equal(baseline.existing[0]!.name, 'Acme GitHub');
  });

  it('check() stays null while nothing new arrives', async () => {
    const api = integrationApi([[{ id: 'i1', updated: 't1' }]]);
    const baseline = await integrationBaseline(api, 'ws_1', 'github');
    assert.equal(await baseline.check(), null);
    assert.equal(await baseline.check(), null);
  });

  it('check() spots a newly created integration', async () => {
    const api = integrationApi([
      [{ id: 'i1', updated: 't1' }],
      [{ id: 'i1', updated: 't1' }, { id: 'i2', name: 'New Slack', updated: 't2' }],
    ]);
    const baseline = await integrationBaseline(api, 'ws_1', 'slack');
    const found = await baseline.check();
    assert.equal(found?.id, 'i2');
  });

  it('check() spots a reconnect that only updates the existing integration', async () => {
    const api = integrationApi([
      [{ id: 'i1', updated: 't1' }],
      [{ id: 'i1', updated: 't2' }],
    ]);
    const baseline = await integrationBaseline(api, 'ws_1', 'github');
    const found = await baseline.check();
    assert.equal(found?.id, 'i1');
  });
});

describe('accountBaseline', () => {
  it('surfaces already-connected accounts for the short-circuit', async () => {
    const api = cloudApi([[{ id: 'a1', account: 'team-a', updated: 't1' }]]);
    const baseline = await accountBaseline(api, 'ws_1', 'vercel');
    assert.equal(baseline.existing.length, 1);
    assert.equal(baseline.existing[0]!.account, 'team-a');
  });

  it('check() stays null while nothing new arrives, then reports fresh accounts', async () => {
    const api = cloudApi([
      [{ id: 'a1', updated: 't1' }],
      [{ id: 'a1', updated: 't1' }],
      [{ id: 'a1', updated: 't1' }, { id: 'a2', account: '123456789012', updated: 't2' }],
    ]);
    const baseline = await accountBaseline(api, 'ws_1', 'aws');
    assert.equal(await baseline.check(), null);
    const found = await baseline.check();
    assert.equal(found?.length, 1);
    assert.equal(found?.[0]?.id, 'a2');
  });
});

describe('waitForBrowserCompletion', () => {
  const config = mockConfig({ quiet: true, output: 'text', nonInteractive: false });

  it('resolves with the arrival once the check finds it', async () => {
    let calls = 0;
    const found = await waitForBrowserCompletion(
      config,
      async () => (++calls >= 2 ? 'arrived' : null),
      { waitingFor: 'test', interruptHint: 'test', timeoutMs: 2_000, intervalMs: 5 }
    );
    assert.equal(found, 'arrived');
  });

  it('returns null on timeout so callers can report it truthfully', async () => {
    const found = await waitForBrowserCompletion(config, async () => null, {
      waitingFor: 'test',
      interruptHint: 'test',
      timeoutMs: 30,
      intervalMs: 5,
    });
    assert.equal(found, null);
  });
});
