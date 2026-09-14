import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenableUrl, runCheckout, TERMS_LINE, UPGRADE_LATER, type CheckoutDeps, type CheckoutOptions } from '../src/billing/checkout';
import type { ReturnListener, ReturnOutcome } from '../src/billing/return-listener';
import type { CatalogPlan, WorkspacePlan } from '../src/billing/plans';
import { ApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import { mockConfig } from './helpers/config';

const starter: CatalogPlan = {
  id: 'starter',
  name: 'Starter',
  tagline: '',
  highlight: false,
  selectable: true,
  monthlyPriceCents: 8000,
  annualPriceCents: 76800,
  features: [],
  limits: { maxCloudAccounts: 5, maxWorkspaceMembers: -1 },
  allowsOverage: true,
};

function workspacePlan(id: string): WorkspacePlan {
  return {
    plan: { id, name: id, limits: { maxCloudAccounts: 2, maxWorkspaceMembers: -1 } },
    usage: {
      cloudAccounts: { current: 2, limit: 2 },
      normalizedTokens: { percentage: 0, atLimit: false },
      workspaceMembers: { current: 1, limit: -1 },
    },
  };
}

interface FakeListener extends ReturnListener {
  settle: (o: ReturnOutcome) => void;
  closed: boolean;
}

function fakeListener(): FakeListener {
  let settle: (o: ReturnOutcome) => void = () => {};
  const outcome = new Promise<ReturnOutcome>((r) => {
    settle = r;
  });
  const listener: FakeListener = {
    successUrl: 'http://127.0.0.1:5000/billing/return?state=s',
    cancelUrl: 'http://127.0.0.1:5000/billing/cancel?state=s',
    outcome,
    closed: false,
    settle,
    close: () => {
      listener.closed = true;
    },
  };
  return listener;
}

interface Harness {
  deps: CheckoutDeps;
  bodies: unknown[];
  opened: string[];
  out: string[];
  planIds: string[];
  listener: FakeListener | null;
}

function harness(opts: { listener?: FakeListener | null; planIds?: string[]; canWait?: boolean; checkoutError?: Error } = {}): Harness {
  const listener = opts.listener === undefined ? fakeListener() : opts.listener;
  const h: Harness = {
    bodies: [],
    opened: [],
    out: [],
    planIds: opts.planIds ?? [],
    listener,
    deps: {
      writeOut: (line) => {
        h.out.push(line);
      },
      startListener: async () => listener,
      openBrowser: (url) => {
        h.opened.push(url);
      },
      fetchPlan: async () => workspacePlan(h.planIds.length > 1 ? h.planIds.shift()! : (h.planIds[0] ?? 'free')),
      createCheckout: async (_c, body) => {
        h.bodies.push(body);
        if (opts.checkoutError) throw opts.checkoutError;
        return { url: 'https://checkout.stripe.com/cs_1' };
      },
      sleep: async () => {},
      canWait: () => opts.canWait ?? true,
    },
  };
  return h;
}

const base: CheckoutOptions = {
  workspaceId: 'ws_1',
  plan: starter,
  cycle: 'monthly',
  noBrowser: false,
  previousPlanId: 'free',
  timeoutMs: 50,
  pollIntervalMs: 1,
  settleMs: 20,
};

// stderr is captured; stdout is never stubbed (the test runner reports through
// it), so data output is read back through the harness's writeOut.
let errOut: string[];
const realErr = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  errOut = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    errOut.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = realErr;
});

describe('runCheckout', () => {
  it('under json output prints the URL, sends no return URLs, and hands off', async () => {
    const h = harness({ canWait: false });
    const outcome = await runCheckout(mockConfig({ output: 'json' }), base, h.deps);
    assert.equal(outcome, 'handoff');
    assert.deepEqual(h.bodies, [{ workspaceId: 'ws_1', plan: 'starter', billingCycle: 'monthly' }]);
    assert.equal(h.out.join(''), JSON.stringify({ url: 'https://checkout.stripe.com/cs_1' }, null, 2) + '\n');
    assert.deepEqual(h.opened, []);
  });

  it('without a TTY prints the URL to stdout and hands off without waiting', async () => {
    const h = harness({ canWait: false });
    const outcome = await runCheckout(mockConfig({ output: 'text' }), base, h.deps);
    assert.equal(outcome, 'handoff');
    assert.equal(h.out.join(''), 'https://checkout.stripe.com/cs_1\n');
    assert.match(errOut.join(''), /Open this URL to upgrade/);
  });

  it('sends the listener URLs, opens the browser, and reports a cancel', async () => {
    const h = harness();
    const run = runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps);
    h.listener!.settle('cancel');
    assert.equal(await run, 'canceled');
    assert.deepEqual(h.bodies, [
      {
        workspaceId: 'ws_1',
        plan: 'starter',
        billingCycle: 'monthly',
        successUrl: h.listener!.successUrl,
        cancelUrl: h.listener!.cancelUrl,
      },
    ]);
    assert.equal(h.out.join(''), 'https://checkout.stripe.com/cs_1\n');
    assert.equal(h.listener!.closed, true);
  });

  it('is upgraded once the browser returns success and the plan flips', async () => {
    const h = harness({ planIds: ['free', 'free', 'starter'] });
    const run = runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps);
    h.listener!.settle('success');
    assert.equal(await run, 'upgraded');
  });

  it('is pending when the browser returned success but the plan never flips in time', async () => {
    const h = harness({ planIds: ['free'] });
    const run = runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps);
    h.listener!.settle('success');
    assert.equal(await run, 'pending');
  });

  it('is upgraded from the plan flip alone when the browser never returns', async () => {
    const h = harness({ planIds: ['free', 'starter'] });
    assert.equal(await runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps), 'upgraded');
  });

  it('times out as "not now" when nothing happens', async () => {
    const h = harness({ planIds: ['free'] });
    assert.equal(await runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps), 'timeout');
    assert.equal(h.listener!.closed, true);
  });

  it('falls back to polling when no listener could bind', async () => {
    const h = harness({ listener: null, planIds: ['free', 'starter'] });
    assert.equal(await runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps), 'upgraded');
    assert.deepEqual(h.bodies, [{ workspaceId: 'ws_1', plan: 'starter', billingCycle: 'monthly' }]);
  });

  it('treats poll failures as "no change yet"', async () => {
    const h = harness({ planIds: ['free'] });
    let calls = 0;
    h.deps.fetchPlan = async () => {
      calls += 1;
      if (calls < 3) throw new Error('boom');
      return workspacePlan('starter');
    };
    assert.equal(await runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps), 'upgraded');
  });

  it('prints the terms line before handing off to the browser', async () => {
    const h = harness();
    const run = runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps);
    h.listener!.settle('cancel');
    await run;
    const err = errOut.join('');
    // Whether the browser opens depends on the TTY; the terms line comes before the URL line either way.
    assert.ok(err.indexOf(TERMS_LINE) >= 0 && err.indexOf(TERMS_LINE) < err.indexOf('URL'));
  });

  it('sees an instant cancel without waiting a poll interval', async () => {
    const h = harness();
    let sleeps = 0;
    h.deps.sleep = async () => {
      sleeps += 1;
    };
    h.listener!.settle('cancel');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(await runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps), 'canceled');
    assert.equal(sleeps, 0);
  });

  it('prints but never opens a URL that is not https', async () => {
    const h = harness();
    h.deps.createCheckout = async () => ({ url: 'file:///etc/passwd' });
    const run = runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps);
    h.listener!.settle('cancel');
    await run;
    assert.deepEqual(h.opened, []);
    assert.equal(h.out.join(''), 'file:///etc/passwd\n');
  });

  it('honours --no-browser', async () => {
    const h = harness();
    const run = runCheckout(mockConfig({ output: 'text', nonInteractive: false }), { ...base, noBrowser: true }, h.deps);
    h.listener!.settle('cancel');
    await run;
    assert.deepEqual(h.opened, []);
  });

  it('wraps a checkout API error, keeps its exit code, and always says how to upgrade later', async () => {
    const h = harness({ checkoutError: new ApiError(403, 'Permission denied', ExitCode.AUTH, 'Check your API key scopes') });
    await assert.rejects(
      () => runCheckout(mockConfig({ output: 'text', nonInteractive: false }), base, h.deps),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.AUTH &&
        err.message === "Couldn't start checkout: Permission denied" &&
        (err.hint ?? '').includes('Check your API key scopes') &&
        (err.hint ?? '').includes(UPGRADE_LATER)
    );
    assert.equal(h.listener!.closed, true);
  });
});

describe('isOpenableUrl', () => {
  it('accepts only https', () => {
    assert.equal(isOpenableUrl('https://checkout.stripe.com/c/pay/cs_1'), true);
    assert.equal(isOpenableUrl('http://checkout.stripe.com/x'), false);
    assert.equal(isOpenableUrl('file:///etc/passwd'), false);
    assert.equal(isOpenableUrl('javascript:alert(1)'), false);
    assert.equal(isOpenableUrl('not a url'), false);
  });
});
