import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectTurso } from '../src/commands/cloud/connect';
import { ApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true } as Config;
const body = { workspaceId: 'ws_1', provider: 'turso', token: 'ts-token' } as const;
const MULTI_ORG =
  'Multiple Turso organizations are reachable with these credentials. Specify which organization to connect.';

function mockApi(connect: (body: unknown) => Promise<unknown>): PolylaneAPI {
  return { cloudAccountsConnect: connect } as unknown as PolylaneAPI;
}

describe('connectTurso', () => {
  it('sends the body without organization and returns the result', async () => {
    const seen: unknown[] = [];
    const result = { provider: 'turso', accounts: [], failures: [] };
    const api = mockApi(async (b) => {
      seen.push(b);
      return result;
    });
    assert.equal(await connectTurso(config, api, body), result);
    assert.deepEqual(seen, [body]);
  });

  it('turns the multi-organization 400 into a usage error with an --organization hint when not interactive', async () => {
    const api = mockApi(async () => {
      throw new ApiError(400, MULTI_ORG, ExitCode.USAGE);
    });
    await assert.rejects(
      () => connectTurso(config, api, body),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.USAGE &&
        err.message.includes('Multiple Turso organizations') &&
        (err.hint?.includes('--organization <slug>') ?? false) &&
        (err.hint?.includes('turso org list') ?? false)
    );
  });

  it('rethrows the multi-organization 400 when an organization was already sent', async () => {
    const original = new ApiError(400, MULTI_ORG, ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectTurso(config, api, { ...body, organization: 'acme' }),
      (err: unknown) => err === original
    );
  });

  it('rethrows other 400s untouched', async () => {
    const original = new ApiError(400, 'Invalid Turso API token', ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectTurso(config, api, body),
      (err: unknown) => err === original
    );
  });

  it('rethrows non-400 errors untouched', async () => {
    const original = new ApiError(401, 'Not signed in.', ExitCode.AUTH);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectTurso(config, api, body),
      (err: unknown) => err === original
    );
  });
});
