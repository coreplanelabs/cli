import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectAxiom } from '../src/commands/integration/connect';
import { ApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';
import type { Integration } from '../src/generated/types';

const config = { nonInteractive: true } as Config;
const body = { type: 'axiom', workspaceId: 'ws_1', apiToken: 'xaat-token' } as const;

function mockApi(connect: (body: unknown) => Promise<unknown>): PolylaneAPI {
  return { integrationsConnect: connect } as unknown as PolylaneAPI;
}

describe('connectAxiom', () => {
  it('sends the body without region and returns the integration', async () => {
    const seen: unknown[] = [];
    const integration = { id: 'int_1', type: 'axiom' } as Integration;
    const api = mockApi(async (b) => {
      seen.push(b);
      return integration;
    });
    assert.equal(await connectAxiom(config, api, body), integration);
    assert.deepEqual(seen, [body]);
  });

  it('turns a 422 into a usage error with a --region hint when not interactive', async () => {
    const api = mockApi(async () => {
      throw new ApiError(422, 'Could not detect the region from the token. Pass region.', ExitCode.USAGE);
    });
    await assert.rejects(
      () => connectAxiom(config, api, body),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.USAGE &&
        err.message.includes('Could not detect the region') &&
        (err.hint?.includes('--region us-east-1') ?? false) &&
        (err.hint?.includes('Settings > General > Edge deployment') ?? false)
    );
  });

  it('rethrows a 422 when a region was already sent', async () => {
    const original = new ApiError(422, 'Invalid region', ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectAxiom(config, api, { ...body, region: 'us-east-1' }),
      (err: unknown) => err === original
    );
  });

  it('rethrows non-422 errors untouched', async () => {
    const original = new ApiError(401, 'Not signed in.', ExitCode.AUTH);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectAxiom(config, api, body),
      (err: unknown) => err === original
    );
  });
});
