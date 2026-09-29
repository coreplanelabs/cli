import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cloudConnectCommand } from '../src/commands/cloud/connect';
import { cliConnectUrl } from '../src/commands/helpers';
import { integrationConnectCommand } from '../src/commands/integration/connect';
import { mockConfig } from './helpers/config';

describe('browser reconnect handoff', () => {
  it('encodes explicit reconnect without changing an ordinary connect URL', () => {
    const config = mockConfig({ domain: 'api.baseberry.cc' });
    const normal = new URL(cliConnectUrl(config, 'posthog', 'ws_one&two'));
    const reconnect = new URL(cliConnectUrl(config, 'posthog', 'ws_one&two', true));
    assert.equal(normal.searchParams.has('reconnect'), false);
    assert.equal(reconnect.searchParams.get('workspace'), 'ws_one&two');
    assert.equal(reconnect.searchParams.get('reconnect'), '1');
  });

  for (const type of ['github', 'slack', 'sentry', 'posthog']) {
    it(`forwards --reconnect through ${type} integration connect`, async (t) => {
      const writes: string[] = [];
      t.mock.method(process.stdout, 'write', (chunk) => {
        writes.push(String(chunk));
        return true;
      });
      await integrationConnectCommand.execute(
        mockConfig({ domain: 'api.baseberry.cc', workspaceId: 'ws_one', dryRun: true, output: 'text', quiet: true }),
        {},
        { type, reconnect: true, noBrowser: true }
      );
      const url = new URL(writes.join('').trim());
      assert.equal(url.searchParams.get('flow'), type);
      assert.equal(url.searchParams.get('reconnect'), '1');
    });
  }

  for (const provider of ['vercel', 'planetscale', 'supabase']) {
    it(`forwards --reconnect through ${provider} cloud connect`, async (t) => {
      const writes: string[] = [];
      t.mock.method(process.stdout, 'write', (chunk) => {
        writes.push(String(chunk));
        return true;
      });
      await cloudConnectCommand.execute(
        mockConfig({ domain: 'api.baseberry.cc', workspaceId: 'ws_one', dryRun: true, output: 'text', quiet: true }),
        {},
        { provider, reconnect: true, noBrowser: true }
      );
      const url = new URL(writes.join('').trim());
      assert.equal(url.searchParams.get('flow'), provider);
      assert.equal(url.searchParams.get('reconnect'), '1');
    });
  }
});
