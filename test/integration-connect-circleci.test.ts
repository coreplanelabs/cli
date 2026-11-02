import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectCircleci } from '../src/commands/integration/connect';
import { ApiError, mapApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true } as Config;
const body = { type: 'circleci', workspaceId: 'ws_1', apiKey: 'circle_token' } as const;
const MULTI_ORG = 'This CircleCI token reaches more than one organization. Select the organization to connect.';

function mockApi(connect: (body: unknown) => Promise<unknown>): PolylaneAPI {
  return { integrationsConnect: connect } as unknown as PolylaneAPI;
}

function multiOrgError(): ApiError {
  return mapApiError(400, {
    message: 'Bad Request',
    detail: MULTI_ORG,
    metadata: {
      organizations: [
        { id: 'org-acme', name: 'acme', slug: 'gh/acme' },
        { id: 'org-beta', name: 'beta', slug: 'circleci/beta' },
      ],
    },
  });
}

describe('connectCircleci', () => {
  it('sends the body without organizationId and returns the integration', async () => {
    const seen: unknown[] = [];
    const integration = { id: 'int_1', type: 'circleci' };
    const api = mockApi(async (b) => {
      seen.push(b);
      return integration;
    });
    assert.equal(await connectCircleci(config, api, body), integration);
    assert.deepEqual(seen, [body]);
  });

  it('lists the reachable organizations in the --organization-id hint when not interactive', async () => {
    const api = mockApi(async () => {
      throw multiOrgError();
    });
    await assert.rejects(
      () => connectCircleci(config, api, body),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.USAGE &&
        err.message === MULTI_ORG &&
        (err.hint?.includes('--organization-id') ?? false) &&
        (err.hint?.includes('org-acme  acme (gh/acme)') ?? false) &&
        (err.hint?.includes('org-beta  beta (circleci/beta)') ?? false)
    );
  });

  it('rethrows the 400 when an organizationId was already sent', async () => {
    const original = multiOrgError();
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectCircleci(config, api, { ...body, organizationId: 'org-acme' }),
      (err: unknown) => err === original
    );
  });

  it('rethrows a 400 that lists no organizations', async () => {
    const original = new ApiError(400, 'CircleCI did not accept this API key.', ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectCircleci(config, api, body),
      (err: unknown) => err === original
    );
  });
});
