import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { integrationConnectCommand } from '../src/commands/integration/connect';
import { PolylaneAPI } from '../src/generated/client';
import type { Integration } from '../src/generated/types';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import { mockConfig } from './helpers/config';

const config = mockConfig({ workspaceId: 'ws_one', quiet: true });

describe('Blacksmith CLI connect', () => {
  it('links the token guide when the token is missing', async () => {
    await assert.rejects(
      () => integrationConnectCommand.execute(config, {}, { type: 'blacksmith' }),
      (err: unknown) => {
        assert.ok(err instanceof CLIError);
        assert.equal(err.exitCode, ExitCode.USAGE);
        assert.match(err.message, /--api-token/);
        assert.match(err.hint ?? '', /https:\/\/docs\.polylane\.com\/integrations\/blacksmith/);
        return true;
      }
    );
  });

  it('names the organization flag when the organization is missing', async () => {
    await assert.rejects(
      () => integrationConnectCommand.execute(config, {}, { type: 'blacksmith', apiToken: 'blacksmith-token' }),
      (err: unknown) => err instanceof CLIError
        && err.exitCode === ExitCode.USAGE
        && err.message.includes('--organization')
    );
  });

  it('connects the selected organization with its token', async (t) => {
    const seen: unknown[] = [];
    t.mock.method(PolylaneAPI.prototype, 'integrationsConnect', async (body) => {
      seen.push(body);
      return { id: 'int_blacksmith', type: 'blacksmith', name: 'Acme' } as Integration;
    });
    t.mock.method(process.stdout, 'write', () => true);
    await integrationConnectCommand.execute(config, {}, {
      type: 'blacksmith', apiToken: 'blacksmith-token', organization: 'acme',
    });
    assert.deepEqual(seen, [{ type: 'blacksmith', workspaceId: 'ws_one', apiToken: 'blacksmith-token', organization: 'acme' }]);
  });
});
