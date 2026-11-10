import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  azureResumeCommand,
  cancelAzureRequest,
  connectAzure,
  isTransientAzurePollError,
  parseAzureRequestId,
  pollAzureRequest,
  type AzureConnectionRequest,
} from '../src/commands/cloud/azure-connect';
import { PROVIDER_OPTIONS, needsCloudAccountCapacity } from '../src/commands/cloud/connect';
import { CLIError } from '../src/errors/base';
import { ApiError } from '../src/errors/api';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true, quiet: true, output: 'text' } as Config;
const REQUEST_ID = 'azureconn_abcdefghijklmnopqrstuvwx';
const DEPLOY_URL = 'https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fapi.example.test';

function request(overrides: Partial<AzureConnectionRequest> = {}): AzureConnectionRequest {
  return {
    requestId: REQUEST_ID,
    workspaceId: 'ws_1',
    status: 'pending',
    registrationDefinitionName: 'Polylane',
    createMonitoringAlarms: true,
    subscriptionId: null,
    tenantId: null,
    cloudAccountId: null,
    createdBy: 'usr_1',
    createdAt: '2026-11-09T00:00:00Z',
    expiresAt: '2026-11-16T00:00:00Z',
    activatedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const connected = request({
  status: 'active',
  subscriptionId: '00000000-0000-0000-0000-000000000001',
  cloudAccountId: 'acc_1',
  activatedAt: '2026-11-09T00:05:00Z',
  completedAt: '2026-11-09T00:05:01Z',
});

function sequenceApi(responses: AzureConnectionRequest[]): { api: PolylaneAPI; reads: () => number } {
  let reads = 0;
  const api = {
    cloudAccountsAzureRequestsGet: async () => responses[Math.min(reads++, responses.length - 1)]!,
  } as unknown as PolylaneAPI;
  return { api, reads: () => reads };
}

describe('Azure connect', () => {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  let stdout = '';
  let stderr = '';

  before(() => {
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  beforeEach(() => {
    stdout = '';
    stderr = '';
  });

  after(() => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  });

  it('is offered in the provider picker', () => {
    assert.ok(PROVIDER_OPTIONS.some((o) => o.value === 'azure' && o.label === 'Azure'));
  });

  it('accepts only azureconn_ request IDs', () => {
    assert.equal(parseAzureRequestId(` ${REQUEST_ID} `), REQUEST_ID);
    assert.throws(
      () => parseAzureRequestId('gcpconn_abcdefghijklmnopqrstuvwx'),
      (err: unknown) => err instanceof CLIError && err.exitCode === ExitCode.USAGE
    );
  });

  it('polls until the request is active and completed', async () => {
    const pendingActive = request({ status: 'active', subscriptionId: connected.subscriptionId });
    const { api, reads } = sequenceApi([request(), pendingActive, connected]);
    const sleeps: number[] = [];
    const result = await pollAzureRequest(api, 'ws_1', REQUEST_ID, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.deepEqual(result, { kind: 'connected', request: connected });
    assert.equal(reads(), 3);
    assert.deepEqual(sleeps, [5_000, 5_000]);
  });

  it('times out when the deployment never connects', async () => {
    let clock = 0;
    const { api } = sequenceApi([request()]);
    const result = await pollAzureRequest(api, 'ws_1', REQUEST_ID, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    assert.deepEqual(result, { kind: 'timeout' });
    assert.equal(clock, 15 * 60_000);
  });

  it('stops with the start command when the request is cancelled or expired', async () => {
    for (const status of ['cancelled', 'expired'] as const) {
      const { api } = sequenceApi([request({ status })]);
      await assert.rejects(
        () => pollAzureRequest(api, 'ws_1', REQUEST_ID, { sleep: async () => {} }),
        (err: unknown) =>
          err instanceof CLIError &&
          err.message.includes(status) &&
          (err.hint ?? '').includes('polylane --workspace ws_1 cloud connect --provider azure')
      );
    }
  });

  it('starts the request with alert rules on by default and waits for the connection', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const api = {
      cloudAccountsConnect: async (body: Record<string, unknown>) => {
        bodies.push(body);
        return { provider: 'azure', request: request(), templateUrl: 'https://api.example.test/t', deployUrl: DEPLOY_URL };
      },
      cloudAccountsAzureRequestsGet: async () => connected,
    } as unknown as PolylaneAPI;

    const outcome = await connectAzure(config, api, {}, 'ws_1', false);

    assert.equal(outcome, 'connected');
    assert.deepEqual(bodies, [{ workspaceId: 'ws_1', provider: 'azure', createMonitoringAlarms: true }]);
    assert.equal(stdout, DEPLOY_URL + '\n');
    assert.ok(stderr.includes('✓ Connected: Azure subscription 00000000-0000-0000-0000-000000000001 (acc_1)'));
  });

  it('prints the URL and the check command with --no-wait, and turns alert rules off', async () => {
    let createMonitoringAlarms: unknown;
    const api = {
      cloudAccountsConnect: async (body: Record<string, unknown>) => {
        createMonitoringAlarms = body.createMonitoringAlarms;
        return {
          provider: 'azure',
          request: request({ createMonitoringAlarms: false }),
          templateUrl: 'https://api.example.test/t',
          deployUrl: DEPLOY_URL,
        };
      },
    } as unknown as PolylaneAPI;

    const outcome = await connectAzure(config, api, { noAlertRules: true, noWait: true }, 'ws_1', true);

    assert.equal(outcome, 'pending');
    assert.equal(createMonitoringAlarms, false);
    assert.equal(stdout, DEPLOY_URL + '\n');
    assert.ok(stderr.includes(REQUEST_ID));
    assert.ok(stderr.includes(azureResumeCommand('ws_1', REQUEST_ID)));
  });

  it('returns the request as JSON without waiting', async () => {
    const api = {
      cloudAccountsConnect: async () => ({
        provider: 'azure',
        request: request(),
        templateUrl: 'https://api.example.test/t',
        deployUrl: DEPLOY_URL,
      }),
    } as unknown as PolylaneAPI;

    const outcome = await connectAzure({ ...config, output: 'json' } as Config, api, {}, 'ws_1', false);

    assert.equal(outcome, 'pending');
    const printed = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(printed.requestId, REQUEST_ID);
    assert.equal(printed.deployUrl, DEPLOY_URL);
    assert.equal(printed.next, azureResumeCommand('ws_1', REQUEST_ID));
  });

  it('resumes a connected request without starting a new one', async () => {
    const api = { cloudAccountsAzureRequestsGet: async () => connected } as unknown as PolylaneAPI;
    const outcome = await connectAzure(config, api, { request: REQUEST_ID }, 'ws_1', false);
    assert.equal(outcome, 'connected');
    assert.equal(stdout, '');
  });

  it('cancels the request and names the start command', async () => {
    const cancelled: string[] = [];
    const api = {
      cloudAccountsAzureRequestsCancel: async (_ws: string, id: string) => {
        cancelled.push(id);
        return request({ status: 'cancelled' });
      },
    } as unknown as PolylaneAPI;
    assert.equal(await cancelAzureRequest(api, 'ws_1', REQUEST_ID), true);
    assert.deepEqual(cancelled, [REQUEST_ID]);
    assert.ok(stderr.includes('polylane --workspace ws_1 cloud connect --provider azure'));
  });
  it('checks a started Azure request without the plan capacity gate', () => {
    assert.equal(needsCloudAccountCapacity({ provider: 'azure', request: REQUEST_ID }), false);
    assert.equal(needsCloudAccountCapacity({ provider: 'azure' }), true);
    assert.equal(needsCloudAccountCapacity({ provider: 'gcp', request: 'gcpconn_1' }), true);
    assert.equal(needsCloudAccountCapacity({ provider: 'aws', reconnect: true }), false);
  });

  it('keeps waiting through a network error or a server error', async () => {
    let reads = 0;
    const failures: unknown[] = [new TypeError('fetch failed'), new ApiError(503, 'Service unavailable'), new CLIError('Network error', ExitCode.NETWORK)];
    const api = {
      cloudAccountsAzureRequestsGet: async () => {
        const failure = failures[reads++];
        if (failure) throw failure;
        return connected;
      },
    } as unknown as PolylaneAPI;
    const result = await pollAzureRequest(api, 'ws_1', REQUEST_ID, { sleep: async () => {} });
    assert.equal(result.kind, 'connected');
    assert.equal(reads, 4);
  });

  it('stops on an error that a retry cannot fix', async () => {
    const api = {
      cloudAccountsAzureRequestsGet: async () => {
        throw new ApiError(403, 'Forbidden', ExitCode.AUTH);
      },
    } as unknown as PolylaneAPI;
    await assert.rejects(() => pollAzureRequest(api, 'ws_1', REQUEST_ID, { sleep: async () => {} }), /Forbidden/);
    assert.equal(isTransientAzurePollError(new ApiError(404, 'Not found')), false);
  });

  it('reports a request that connected before the cancel instead of cancelling it', async () => {
    const api = { cloudAccountsAzureRequestsCancel: async () => connected } as unknown as PolylaneAPI;
    assert.equal(await cancelAzureRequest(api, 'ws_1', REQUEST_ID), false);
    assert.ok(!stderr.includes('Cancelled.'));
    assert.ok(stderr.includes(`--request ${REQUEST_ID}`));
  });
});
