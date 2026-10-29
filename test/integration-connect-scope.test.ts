import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectPickingScope,
  parseIncidentIoSeverity,
  parseNewrelicAccountId,
} from '../src/commands/integration/connect';
import { ApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true } as Config;
const body = { type: 'newrelic', workspaceId: 'ws_1', apiKey: 'NRAK-x' } as const;
const MULTI_ACCOUNT = 'This key can read more than one New Relic account. Choose the account to connect.';
const retry = {
  pattern: /more than one New Relic account/i,
  flag: '--account-id',
  title: 'New Relic account',
  prompt: 'New Relic account ID',
  hint: 'The account ID is in the account switcher.',
  parse: (v: string) => ({ accountId: parseNewrelicAccountId(v) }),
};

function mockApi(connect: (body: unknown) => Promise<unknown>): PolylaneAPI {
  return { integrationsConnect: connect } as unknown as PolylaneAPI;
}

describe('parseNewrelicAccountId', () => {
  it('accepts a positive integer', () => {
    assert.equal(parseNewrelicAccountId(' 1234567 '), 1234567);
  });

  it('rejects zero, decimals and non-digits', () => {
    for (const bad of ['0', '1.5', '1e3', 'acme']) {
      assert.throws(() => parseNewrelicAccountId(bad), (err: unknown) => err instanceof CLIError && err.exitCode === ExitCode.USAGE, bad);
    }
  });
});

describe('parseIncidentIoSeverity', () => {
  it('accepts the four API severities', () => {
    for (const s of ['critical', 'high', 'medium', 'low']) assert.equal(parseIncidentIoSeverity(s), s);
  });

  it('rejects anything else with the list of values', () => {
    assert.throws(
      () => parseIncidentIoSeverity('High'),
      (err: unknown) => err instanceof CLIError && (err.hint?.includes('critical, high, medium, low') ?? false)
    );
  });
});

describe('connectPickingScope', () => {
  it('turns the several-accounts 400 into a usage error naming the flag when not interactive', async () => {
    const api = mockApi(async () => {
      throw new ApiError(400, MULTI_ACCOUNT, ExitCode.USAGE);
    });
    await assert.rejects(
      () => connectPickingScope(config, api, body, false, retry),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.USAGE &&
        err.message === MULTI_ACCOUNT &&
        (err.hint?.startsWith('Pass --account-id <id>.') ?? false)
    );
  });

  it('rethrows when the account was already chosen', async () => {
    const original = new ApiError(400, MULTI_ACCOUNT, ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectPickingScope(config, api, { ...body, accountId: 1 }, true, retry),
      (err: unknown) => err === original
    );
  });

  it('rethrows unrelated 400s untouched', async () => {
    const original = new ApiError(400, 'New Relic does not accept this key.', ExitCode.USAGE);
    const api = mockApi(async () => {
      throw original;
    });
    await assert.rejects(
      () => connectPickingScope(config, api, body, false, retry),
      (err: unknown) => err === original
    );
  });
});
