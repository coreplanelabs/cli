import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountCheckForAwsId,
  AwsStackWaits,
  connectedAwsAccountsForId,
  prepareAwsSubmission,
  startAwsStackWait,
  useAwsBackgroundPicker,
} from '../src/commands/cloud/connect';
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
  it('flush stays silent while pending, then prints the connected transition once', async () => {
    let calls = 0;
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait('123456789012', async () => (++calls >= 2 ? account() : null), {
        intervalMs: 5,
      });
      wait.flush();
      assert.equal(wait.pending(), true);
      while (wait.pending()) {
        await sleep(5);
        wait.flush();
      }
      wait.flush();
      assert.equal(wait.stop(), 'connected');
    });
    const matches = output.match(/✓ AWS connected: prod \(123456789012, us-east-1\)/g);
    assert.equal(matches?.length, 1);
  });

  it('stop reports an arrival the background poll already saw', async () => {
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait('123456789012', async () => account(), { intervalMs: 5 });
      await sleep(20);
      assert.equal(wait.stop(), 'connected');
      assert.equal(wait.pending(), false);
    });
    assert.match(output, /✓ AWS connected: prod/);
  });

  it('stop returns pending promptly without waiting for another poll', async () => {
    const started = Date.now();
    const output = await captureStderr(async () => {
      const wait = startAwsStackWait('123456789012', async () => null, { intervalMs: 60_000 });
      assert.equal(wait.stop(), 'pending');
      assert.equal(wait.pending(), false);
    });
    assert.equal(output, '');
    assert.ok(Date.now() - started < 100);
  });
});

describe('accountCheckForAwsId', () => {
  it('only completes for the requested 12-digit account', async () => {
    const existing = account({ account: '111111111111', updated: 'before' });
    const check = accountCheckForAwsId(
      { existing },
      '222222222222',
      async () => [
        ...account({ account: '111111111111', updated: 'after' }),
        ...account({ account: '222222222222', alias: 'second' }),
      ]
    );
    assert.deepEqual((await check())?.map((item) => item.account), ['222222222222']);
  });

  it('ignores changes to another account while the requested one is absent', async () => {
    const existing = account({ account: '111111111111', updated: 'before' });
    const check = accountCheckForAwsId(
      { existing },
      '222222222222',
      async () => account({ account: '111111111111', updated: 'after' })
    );
    assert.equal(await check(), null);
  });
});

describe('connectedAwsAccountsForId', () => {
  it('short-circuits only the exact existing account and leaves a new account connectable', () => {
    const existing = [
      ...account({ account: '111111111111', alias: 'existing' }),
      ...account({ account: '333333333333', alias: 'other' }),
    ];
    assert.deepEqual(connectedAwsAccountsForId(existing, '111111111111').map((item) => item.account), [
      '111111111111',
    ]);
    assert.deepEqual(connectedAwsAccountsForId(existing, '222222222222'), []);
  });
});

describe('prepareAwsSubmission', () => {
  it('refreshes after a same-account wait completes at the pre-submit boundary', async () => {
    const waits = new AwsStackWaits();
    const completed = account({ account: '111111111111', updated: 'completed' });
    waits.add(startAwsStackWait('111111111111', async () => completed, { intervalMs: 5 }));
    await sleep(20);
    let refreshes = 0;

    const output = await captureStderr(async () => {
      const result = await prepareAwsSubmission('111111111111', false, waits, async () => {
        refreshes += 1;
        return completed;
      });
      assert.equal(result.kind, 'connected');
      if (result.kind === 'connected') {
        assert.deepEqual(result.accounts.map((item) => item.account), ['111111111111']);
      }
    });

    assert.equal(refreshes, 1);
    assert.equal(output.match(/✓ AWS connected:/g)?.length, 1);
  });

  it('still allows a distinct account after another account completed', async () => {
    const waits = new AwsStackWaits();
    const completed = account({ account: '111111111111', updated: 'completed' });
    waits.add(startAwsStackWait('111111111111', async () => completed, { intervalMs: 5 }));
    await sleep(20);

    await captureStderr(async () => {
      const result = await prepareAwsSubmission('222222222222', false, waits, async () => completed);
      assert.equal(result.kind, 'submit');
      if (result.kind === 'submit') {
        assert.deepEqual(result.baseline.existing.map((item) => item.account), ['111111111111']);
      }
    });
  });

  it('uses the fresh snapshot as the reconnect polling baseline', async () => {
    const waits = new AwsStackWaits();
    const completed = account({ account: '111111111111', id: 'aws-1', updated: 'completed' });
    const result = await prepareAwsSubmission('111111111111', true, waits, async () => completed);
    assert.equal(result.kind, 'submit');
    if (result.kind !== 'submit') return;

    const unchanged = accountCheckForAwsId(result.baseline, '111111111111', async () => completed);
    assert.equal(await unchanged(), null);
    const changed = accountCheckForAwsId(result.baseline, '111111111111', async () =>
      account({ account: '111111111111', id: 'aws-1', updated: 'reconnected' })
    );
    assert.deepEqual((await changed())?.map((item) => item.updated), ['reconnected']);
  });
});

describe('useAwsBackgroundPicker', () => {
  const interactiveText = mockConfig({ output: 'text', dryRun: false, quiet: false, nonInteractive: false });

  it('is enabled only for the normal interactive text picker', () => {
    assert.equal(useAwsBackgroundPicker(interactiveText, true), true);
    assert.equal(useAwsBackgroundPicker(interactiveText, false), false);
  });

  it('does not re-enter the picker for JSON or dry-run AWS results', () => {
    assert.equal(useAwsBackgroundPicker({ ...interactiveText, output: 'json' }, true), false);
    assert.equal(useAwsBackgroundPicker({ ...interactiveText, dryRun: true }, true), false);
  });

  it('preserves background behavior for quiet and no-browser interactive picker runs', () => {
    assert.equal(useAwsBackgroundPicker({ ...interactiveText, quiet: true }, true), true);
    assert.equal(useAwsBackgroundPicker(interactiveText, true), true);
  });

  it('does not re-enter for non-interactive runs or an explicit provider', () => {
    assert.equal(useAwsBackgroundPicker({ ...interactiveText, nonInteractive: true }, false), false);
    assert.equal(useAwsBackgroundPicker(interactiveText, false), false);
  });
});

describe('AwsStackWaits', () => {
  it('tracks concurrent accounts and reports out-of-order completion exactly once', async () => {
    let firstReady = false;
    let secondReady = false;
    const waits = new AwsStackWaits();
    const output = await captureStderr(async () => {
      assert.equal(
        waits.add(
          startAwsStackWait(
            '111111111111',
            async () => (firstReady ? account({ account: '111111111111', alias: 'first' }) : null),
            { intervalMs: 5 }
          )
        ),
        true
      );
      assert.equal(
        waits.add(
          startAwsStackWait(
            '222222222222',
            async () => (secondReady ? account({ account: '222222222222', alias: 'second' }) : null),
            { intervalMs: 5 }
          )
        ),
        true
      );

      secondReady = true;
      await sleep(20);
      waits.flush();
      waits.flush();
      assert.deepEqual(waits.pendingAccountIds(), ['111111111111']);

      firstReady = true;
      await sleep(20);
      waits.flush();
      waits.flush();
      assert.deepEqual(waits.pendingAccountIds(), []);
      assert.equal(waits.hasSubmitted(), true);
      assert.deepEqual(waits.finish(), []);
    });
    assert.equal(output.match(/second \(222222222222/g)?.length, 1);
    assert.equal(output.match(/first \(111111111111/g)?.length, 1);
  });

  it('rejects a duplicate submission only while that exact account is pending', async () => {
    const waits = new AwsStackWaits();
    const first = startAwsStackWait('111111111111', async () => null, { intervalMs: 60_000 });
    const duplicate = startAwsStackWait('111111111111', async () => null, { intervalMs: 60_000 });
    assert.equal(waits.add(first), true);
    assert.equal(waits.add(duplicate), false);
    assert.deepEqual(waits.pendingAccountIds(), ['111111111111']);
    await captureStderr(async () => {
      waits.finish();
    });
  });

  it('shows every pending account between prompts', async () => {
    const waits = new AwsStackWaits();
    waits.add(startAwsStackWait('111111111111', async () => null, { intervalMs: 60_000 }));
    waits.add(startAwsStackWait('222222222222', async () => null, { intervalMs: 60_000 }));
    const output = await captureStderr(async () => {
      waits.printPendingStatus();
      waits.finish();
    });
    assert.match(output, /^AWS pending: 111111111111, 222222222222/m);
  });

  it('does not print from background checks while a prompt may be active', async () => {
    const waits = new AwsStackWaits();
    let beforeFlush = '';
    const output = await captureStderr(async () => {
      waits.add(startAwsStackWait('123456789012', async () => account(), { intervalMs: 5 }));
      await sleep(20);
      beforeFlush = 'captured outside writer';
      waits.flush();
    });
    assert.equal(beforeFlush, 'captured outside writer');
    assert.match(output, /^✓ AWS connected:/);
  });

  it('Done stops every poller and gives per-account check and retry guidance for mixed states', async () => {
    let completedCalls = 0;
    let pendingCalls = 0;
    const waits = new AwsStackWaits();
    const output = await captureStderr(async () => {
      waits.add(
        startAwsStackWait(
          '111111111111',
          async () => {
            completedCalls += 1;
            return account({ account: '111111111111' });
          },
          { intervalMs: 5 }
        )
      );
      waits.add(
        startAwsStackWait(
          '222222222222',
          async () => {
            pendingCalls += 1;
            return null;
          },
          { intervalMs: 5 }
        )
      );
      await sleep(20);
      const outcomes = waits.finish();
      assert.deepEqual(outcomes, ['pending']);
      const completedAfter = completedCalls;
      const pendingAfter = pendingCalls;
      await sleep(30);
      assert.equal(completedCalls, completedAfter);
      assert.equal(pendingCalls, pendingAfter);
    });
    assert.match(output, /AWS account 222222222222 is still connecting/);
    assert.match(output, /Check 222222222222: `polylane cloud list` \(look for account 222222222222\)/);
    assert.match(output, /Retry 222222222222: `polylane cloud connect --provider aws --account 222222222222`/);
    assert.doesNotMatch(output, /AWS account 111111111111 is still connecting/);
  });
});
