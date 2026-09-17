import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectTriggerdev } from '../src/commands/cloud/connect';
import { ApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true } as Config;
const body = { workspaceId: 'ws_1', provider: 'triggerdev', apiKey: 'tr_key' } as const;
const REF_REQUIRED =
  'This API key is valid for multiple projects. Specify the project ref of the project to connect.';

function mockApi(connect: (body: unknown) => Promise<unknown>): PolylaneAPI {
  return { cloudAccountsConnect: connect } as unknown as PolylaneAPI;
}

describe('connectTriggerdev', () => {
  it('sends the body without projectRef and returns the result', async () => {
    const seen: unknown[] = [];
    const result = { provider: 'triggerdev', accounts: [], failures: [] };
    const api = mockApi(async (b) => {
      seen.push(b);
      return result;
    });
    assert.equal(await connectTriggerdev(config, api, body), result);
    assert.deepEqual(seen, [body]);
  });

  it('sends projectRef through when given', async () => {
    const seen: unknown[] = [];
    const withRef = { ...body, projectRef: 'proj_abc123' };
    const api = mockApi(async (b) => {
      seen.push(b);
      return { provider: 'triggerdev', accounts: [], failures: [] };
    });
    await connectTriggerdev(config, api, withRef);
    assert.deepEqual(seen, [withRef]);
  });

  it('turns the project-ref-required 400 into a usage error with a --project-ref hint when not interactive', async () => {
    const api = mockApi(async () => {
      throw new ApiError(400, REF_REQUIRED, ExitCode.USAGE);
    });
    await assert.rejects(
      () => connectTriggerdev(config, api, body),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.USAGE &&
        err.message.includes('project ref') &&
        (err.hint?.includes('--project-ref') ?? false) &&
        (err.hint?.includes('trigger.config.ts') ?? false)
    );
  });

  it('rethrows the project-ref-required 400 when a projectRef was already sent', async () => {
    const original = new ApiError(400, REF_REQUIRED, ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectTriggerdev(config, api, { ...body, projectRef: 'proj_abc123' }),
      (err: unknown) => err === original
    );
  });

  it('rethrows other 400s untouched, including a key that cannot read runs', async () => {
    const original = new ApiError(
      400,
      'This API key cannot read runs. Create a key with the No restrictions access preset, or a restricted key that includes run read access.',
      ExitCode.USAGE
    );
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectTriggerdev(config, api, body),
      (err: unknown) => err === original
    );
  });

  it('rethrows non-400 errors untouched', async () => {
    const original = new ApiError(401, 'Not signed in.', ExitCode.AUTH);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectTriggerdev(config, api, body),
      (err: unknown) => err === original
    );
  });
});
