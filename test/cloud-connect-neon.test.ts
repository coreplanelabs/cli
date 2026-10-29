import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectNeon } from '../src/commands/cloud/connect';
import { ApiError, mapApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true } as Config;
const body = { workspaceId: 'ws_1', provider: 'neon', token: 'napi_x' } as const;
const MULTI_ORG = 'Multiple Neon organizations are reachable with this API key. Specify which organization to connect.';

function mockApi(connect: (body: unknown) => Promise<unknown>): PolylaneAPI {
  return { cloudAccountsConnect: connect } as unknown as PolylaneAPI;
}

function multiOrgError(): ApiError {
  return mapApiError(400, {
    message: 'Bad Request',
    detail: MULTI_ORG,
    metadata: {
      organizations: [
        { id: 'org-one', name: 'One' },
        { id: 'org-two', name: 'Two' },
      ],
    },
  });
}

describe('mapApiError', () => {
  it('keeps the error metadata on the ApiError', () => {
    const err = multiOrgError();
    assert.equal(err.message, MULTI_ORG);
    assert.deepEqual((err.metadata?.organizations as unknown[]).length, 2);
  });

  it('leaves metadata undefined when the API sends none', () => {
    assert.equal(mapApiError(400, { message: 'Bad Request', detail: 'x' }).metadata, undefined);
  });
});

describe('connectNeon', () => {
  it('sends the body without orgId and returns the result', async () => {
    const seen: unknown[] = [];
    const result = { provider: 'neon', accounts: [], failures: [] };
    const api = mockApi(async (b) => {
      seen.push(b);
      return result;
    });
    assert.equal(await connectNeon(config, api, body), result);
    assert.deepEqual(seen, [body]);
  });

  it('lists the reachable organizations in the --org-id hint when not interactive', async () => {
    const api = mockApi(async () => {
      throw multiOrgError();
    });
    await assert.rejects(
      () => connectNeon(config, api, body),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.USAGE &&
        err.message === MULTI_ORG &&
        (err.hint?.includes('--org-id') ?? false) &&
        (err.hint?.includes('org-one  One') ?? false) &&
        (err.hint?.includes('org-two  Two') ?? false)
    );
  });

  it('rethrows the multi-organization 400 when an orgId was already sent', async () => {
    const original = multiOrgError();
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectNeon(config, api, { ...body, orgId: 'org-one' }),
      (err: unknown) => err === original
    );
  });

  it('rethrows a 400 that lists no organizations', async () => {
    const original = new ApiError(400, 'Neon does not accept this API key', ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectNeon(config, api, body),
      (err: unknown) => err === original
    );
  });
});
