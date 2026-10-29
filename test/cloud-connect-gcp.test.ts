import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectGcp,
  gcpResumeCommand,
  parseGcpProjectId,
  parseGcpProjectNumber,
  parseGcpRequestId,
} from '../src/commands/cloud/gcp-connect';
import { connectExitCode } from '../src/commands/cloud/connect';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import type { Config } from '../src/config/schema';
import type { PolylaneAPI } from '../src/generated/client';

const config = { nonInteractive: true, quiet: true, output: 'text' } as Config;
const REQUEST_ID = 'gcpconn_abcdefghijklmnopqrstuvwx';

function isUsageError(err: unknown): boolean {
  return err instanceof CLIError && err.exitCode === ExitCode.USAGE;
}

describe('GCP connect parsers', () => {
  it('accepts a project ID and trims it', () => {
    assert.equal(parseGcpProjectId(' my-production-project '), 'my-production-project');
  });

  it('rejects a display name, an uppercase ID and a too-short ID', () => {
    for (const bad of ['My Production Project', 'My-project', 'abc', 'project-']) {
      assert.throws(() => parseGcpProjectId(bad), isUsageError, bad);
    }
  });

  it('accepts a numeric project number and rejects anything else', () => {
    assert.equal(parseGcpProjectNumber('123456789012'), '123456789012');
    for (const bad of ['12345', '1234567890a', 'my-project']) {
      assert.throws(() => parseGcpProjectNumber(bad), isUsageError, bad);
    }
  });

  it('accepts only gcpconn_ request IDs', () => {
    assert.equal(parseGcpRequestId(REQUEST_ID), REQUEST_ID);
    assert.throws(() => parseGcpRequestId('acc_abcdefghijklmnopqrstuvwx'), isUsageError);
  });
});

describe('connectExitCode', () => {
  it('exits PENDING when a setup was prepared but not verified', () => {
    assert.equal(connectExitCode('pending', null), ExitCode.PENDING);
  });
});

describe('connectGcp', () => {
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

  it('prepares the request, prints the setup script and hands back the resume command', async () => {
    const created: Array<Record<string, unknown>> = [];
    const api = {
      cloudAccountsGcpRequestsCreate: async (body: Record<string, unknown>) => {
        created.push(body);
        return { requestId: REQUEST_ID, projectId: 'my-production-project', status: 'pending', expiresAt: '2026-11-05' };
      },
      cloudAccountsGcpRequestsSetup: async () => ({
        terraform: 'terraform {}',
        commands: 'gcloud infra-manager deployments apply ...\n',
        consoleUrl: 'https://console.cloud.google.com/infra-manager/deployments?project=my-production-project',
      }),
    } as unknown as PolylaneAPI;

    const outcome = await connectGcp(config, api, { projectId: 'my-production-project', projectNumber: '123456789012' }, 'ws_1');

    assert.equal(outcome, 'pending');
    assert.equal(created.length, 1);
    assert.equal(created[0]!.projectId, 'my-production-project');
    assert.equal(created[0]!.investigateAlerts, true);
    assert.match(String(created[0]!.idempotencyKey), /^[A-Za-z0-9._:-]{1,128}$/);
    assert.equal(stdout, 'gcloud infra-manager deployments apply ...\n');
    assert.ok(stderr.includes(gcpResumeCommand('ws_1', REQUEST_ID, '123456789012')));
    assert.ok(stderr.includes('polylane --workspace ws_1 cloud connect --provider gcp --request'));
  });

  it('turns alert investigation off with --no-investigate-alerts', async () => {
    let investigateAlerts: unknown;
    const api = {
      cloudAccountsGcpRequestsCreate: async (body: Record<string, unknown>) => {
        investigateAlerts = body.investigateAlerts;
        return { requestId: REQUEST_ID, projectId: 'my-production-project', status: 'pending', expiresAt: '' };
      },
      cloudAccountsGcpRequestsSetup: async () => ({ terraform: '', commands: 'x', consoleUrl: 'https://example.test' }),
    } as unknown as PolylaneAPI;
    await connectGcp(
      config,
      api,
      { projectId: 'my-production-project', projectNumber: '123456789012', noInvestigateAlerts: true },
      'ws_1'
    );
    assert.equal(investigateAlerts, false);
  });

  it('asks for the missing project ID with a usage error when not interactive', async () => {
    await assert.rejects(
      () => connectGcp(config, {} as PolylaneAPI, { projectNumber: '123456789012' }, 'ws_1'),
      (err: unknown) => isUsageError(err) && (err as Error).message.includes('--project-id')
    );
  });

  it('resumes a prepared request and activates it in poll mode', async () => {
    const activations: Array<Record<string, unknown>> = [];
    const api = {
      cloudAccountsGcpRequestsGet: async () => ({
        requestId: REQUEST_ID,
        projectId: 'my-production-project',
        status: 'pending',
        projectNumber: null,
      }),
      cloudAccountsGcpActivate: async (body: Record<string, unknown>) => {
        activations.push(body);
        return { requestId: REQUEST_ID, cloudAccountId: 'acc_1', provisioningStatus: 'registered' };
      },
    } as unknown as PolylaneAPI;

    const outcome = await connectGcp(config, api, { request: REQUEST_ID, projectNumber: '123456789012' }, 'ws_1');

    assert.equal(outcome, 'connected');
    assert.deepEqual(activations, [
      { workspaceId: 'ws_1', requestId: REQUEST_ID, projectNumber: '123456789012', verificationMode: 'poll' },
    ]);
    assert.match(stderr, /Connected: my-production-project/);
  });

  it('makes one attempt and exits pending when a non-interactive resume is still verifying', async () => {
    let calls = 0;
    const api = {
      cloudAccountsGcpRequestsGet: async () => ({
        requestId: REQUEST_ID,
        projectId: 'my-production-project',
        status: 'pending',
        projectNumber: null,
      }),
      cloudAccountsGcpActivate: async () => {
        calls += 1;
        return { requestId: REQUEST_ID, provisioningStatus: 'verifying' };
      },
    } as unknown as PolylaneAPI;

    const outcome = await connectGcp(
      { ...config, output: 'json' } as Config,
      api,
      { request: REQUEST_ID, projectNumber: '123456789012' },
      'ws_2'
    );

    assert.equal(outcome, 'pending');
    assert.equal(calls, 1);
    const printed = JSON.parse(stdout) as { status: string; next: string };
    assert.equal(printed.status, 'verifying');
    assert.equal(printed.next, gcpResumeCommand('ws_2', REQUEST_ID, '123456789012'));
  });

  it('reuses the project number a request already recorded', async () => {
    let sent: unknown;
    const api = {
      cloudAccountsGcpRequestsGet: async () => ({
        requestId: REQUEST_ID,
        projectId: 'my-production-project',
        status: 'active',
        projectNumber: '987654321098',
      }),
      cloudAccountsGcpActivate: async (body: Record<string, unknown>) => {
        sent = body.projectNumber;
        return { requestId: REQUEST_ID, cloudAccountId: 'acc_1', provisioningStatus: 'registered' };
      },
    } as unknown as PolylaneAPI;
    assert.equal(await connectGcp(config, api, { request: REQUEST_ID }, 'ws_1'), 'connected');
    assert.equal(sent, '987654321098');
  });

  it('refuses to resume an expired request and points at a new one', async () => {
    const api = {
      cloudAccountsGcpRequestsGet: async () => ({
        requestId: REQUEST_ID,
        projectId: 'my-production-project',
        status: 'expired',
        projectNumber: null,
      }),
    } as unknown as PolylaneAPI;
    await assert.rejects(
      () => connectGcp(config, api, { request: REQUEST_ID, projectNumber: '123456789012' }, 'ws_1'),
      (err: unknown) =>
        isUsageError(err) &&
        ((err as CLIError).hint?.includes('polylane --workspace ws_1 cloud connect --provider gcp --project-id my-production-project') ?? false)
    );
  });
});
