import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cliConnectUrl } from '../src/commands/helpers';
import { integrationConnectCommand, typeOptionsForCategory } from '../src/commands/integration/connect';
import { PolylaneAPI } from '../src/generated/client';
import type { Integration } from '../src/generated/types';
import { mockConfig } from './helpers/config';

describe('PostHog CLI connect', () => {
  it('offers PostHog as a browser-based product analytics integration', () => {
    const option = typeOptionsForCategory('product-analytics').find((item) => item.value === 'posthog');
    assert.deepEqual(option, {
      value: 'posthog',
      label: 'PostHog',
      hint: "choose one project on PostHog's consent screen",
      category: 'product-analytics',
    });
  });

  it('opens the selected workspace on the console connect page', () => {
    const url = new URL(cliConnectUrl(mockConfig({ domain: 'api.baseberry.cc' }), 'posthog', 'ws_one&two'));
    assert.equal(url.origin, 'https://console.baseberry.cc');
    assert.equal(url.pathname, '/cli/connect');
    assert.equal(url.searchParams.get('flow'), 'posthog');
    assert.equal(url.searchParams.get('workspace'), 'ws_one&two');
  });

  for (const existing of [[], [{ id: 'int_first', name: 'First project', updated: 't1' }]]) {
    it(`hands off to the browser with ${existing.length} existing PostHog project`, async (t) => {
      const writes: string[] = [];
      t.mock.method(PolylaneAPI.prototype, 'integrationsList', async (workspaceId, query) => {
        assert.equal(workspaceId, 'ws_one');
        assert.equal(query?.type, 'posthog');
        return { items: existing as Integration[], count: existing.length };
      });
      t.mock.method(process.stdout, 'write', (chunk) => {
        writes.push(String(chunk));
        return true;
      });
      await integrationConnectCommand.execute(
        mockConfig({ domain: 'api.baseberry.cc', workspaceId: 'ws_one', output: 'text', quiet: true }),
        {},
        { type: 'posthog', noBrowser: true }
      );
      const url = new URL(writes.join('').trim());
      assert.equal(url.origin, 'https://console.baseberry.cc');
      assert.equal(url.pathname, '/cli/connect');
      assert.equal(url.searchParams.get('flow'), 'posthog');
      assert.equal(url.searchParams.get('workspace'), 'ws_one');
    });
  }
});
