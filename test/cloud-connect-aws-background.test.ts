import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startAwsStackWait } from '../src/commands/cloud/connect';
import { startBackgroundCompletion } from '../src/commands/helpers';
import { mockConfig } from './helpers/config';
import type { CloudAccount } from '../src/generated/types';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function captureStderr(fn: () => Promise<void>): Promise<string> {
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

function account(overrides: Partial<CloudAccount> = {}): CloudAccount[] {
  return [{ alias: 'prod', account: '123456789012', region: 'us-east-1', ...overrides } as CloudAccount];
}

describe('startBackgroundCompletion', () => {
  it('surfaces the arrival through peek without blocking', async () => {
    let calls = 0;
    const poller = startBackgroundCompletion(async () => (++calls >= 2 ? 'arrived' : null), 5);
    assert.equal(poller.peek(), null);
    while (poller.peek() === null) await sleep(5);
    assert.equal(poller.peek(), 'arrived');
    poller.stop();
  });

  it('keeps polling through transient check failures', async () => {
    let calls = 0;
    const poller = startBackgroundCompletion(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return 'arrived';
    }, 5);
    while (poller.peek() === null) await sleep(5);
    assert.equal(poller.peek(), 'arrived');
    poller.stop();
  });

  it('stop() halts the poll loop', async () => {
    let calls = 0;
    const poller = startBackgroundCompletion(async () => {
      calls += 1;
      return null;
    }, 5);
    await sleep(20);
    poller.stop();
    const after = calls;
    await sleep(30);
    assert.equal(calls, after);
    assert.equal(poller.peek(), null);
  });
});

describe('startAwsStackWait', () => {
  const config = mockConfig({ quiet: true, output: 'text', nonInteractive: false });

  it('flush stays silent while pending, then prints the connected transition once', async () => {
    let calls = 0;
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait(config, async () => (++calls >= 2 ? account() : null), {
        intervalMs: 5,
        settleTimeoutMs: 200,
      });
      wait.flush();
      assert.equal(wait.pending(), true);
      while (wait.pending()) {
        await sleep(5);
        wait.flush();
      }
      wait.flush();
      assert.equal(await wait.settle(), 'connected');
    });
    const matches = output.match(/✓ AWS connected: prod \(123456789012, us-east-1\)/g);
    assert.equal(matches?.length, 1);
  });

  it('settle reports an arrival the background poll already saw', async () => {
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait(config, async () => account(), { intervalMs: 5, settleTimeoutMs: 200 });
      await sleep(20);
      assert.equal(await wait.settle(), 'connected');
      assert.equal(wait.pending(), false);
    });
    assert.match(output, /✓ AWS connected: prod/);
  });

  it('settle waits in the foreground and picks up a late arrival', async () => {
    let calls = 0;
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait(config, async () => (++calls >= 3 ? account() : null), {
        intervalMs: 5,
        settleTimeoutMs: 500,
      });
      assert.equal(await wait.settle(), 'connected');
    });
    assert.match(output, /✓ AWS connected: prod/);
  });

  it('settle returns pending with check-later guidance when the stack never shows up', async () => {
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait(config, async () => null, { intervalMs: 5, settleTimeoutMs: 30 });
      assert.equal(await wait.settle(), 'pending');
      assert.equal(wait.pending(), false);
    });
    assert.match(output, /AWS is still connecting/);
    assert.match(output, /polylane cloud list/);
    assert.match(output, /failed or rolled back/);
  });
});
