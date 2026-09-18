import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { printConnectSuccess, cloudConnectCommand } from '../src/commands/cloud/connect';
import type { Config } from '../src/config/schema';

const config = { output: 'text' } as Config;

type ConnectResult = Parameters<typeof printConnectSuccess>[1];

// The refusal copy comes from the API verbatim (nominal
// apps/apis/api-cloud-accounts/src/routers/cloud-accounts/connects/triggerdev.ts);
// the CLI never rewrites it.
const NO_RESTRICTIONS_REFUSED =
  "Polylane needs a key created with the 'No restrictions' preset";

async function captureStderr(fn: () => Promise<void> | void): Promise<string> {
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return writes.join('');
}

describe('printConnectSuccess', () => {
  it("surfaces the API's refusal from failures[].response verbatim", async () => {
    const result = {
      provider: 'triggerdev',
      accounts: [],
      failures: [
        {
          message: 'There was an error when connecting an account.',
          response: NO_RESTRICTIONS_REFUSED,
          account: 'proj_abc123/prod',
          name: 'my-project (prod)',
          type: '400',
        },
      ],
    } as unknown as ConnectResult;
    const output = await captureStderr(() => printConnectSuccess(config, result));
    assert.equal(output, `Couldn't connect proj_abc123/prod: ${NO_RESTRICTIONS_REFUSED}\n`);
  });

  it('falls back to the failure message when the API sent no response text', async () => {
    const result = {
      provider: 'triggerdev',
      accounts: [],
      failures: [
        {
          message: 'There was an error when connecting an account.',
          account: 'proj_abc123/prod',
          name: 'my-project (prod)',
          type: 'unknown',
        },
      ],
    } as unknown as ConnectResult;
    const output = await captureStderr(() => printConnectSuccess(config, result));
    assert.equal(
      output,
      "Couldn't connect proj_abc123/prod: There was an error when connecting an account.\n"
    );
  });
});

describe('cloud connect --provider triggerdev flags', () => {
  it('takes only --api-key: the project ref comes from the key, so no --project-ref flag exists', () => {
    const flags = (cloudConnectCommand.options ?? []).map((o) => o.flag);
    assert.ok(flags.some((f) => f.startsWith('--api-key')));
    assert.ok(!flags.some((f) => f.startsWith('--project-ref')));
  });
});
