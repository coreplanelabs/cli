import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureCloudAccountCapacity, type CapacityDeps } from '../src/billing/cloud-capacity';
import { UPGRADE_LATER, type CheckoutOutcome } from '../src/billing/checkout';
import type { UpgradeMode } from '../src/billing/upgrade';
import type { Subscription } from '../src/client/billing';
import type { CatalogPlan, PlanCatalog, WorkspacePlan } from '../src/billing/plans';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import { BACK } from '../src/utils/prompt';
import { mockConfig } from './helpers/config';

function plan(id: string, monthly: number, maxCloudAccounts: number): CatalogPlan {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    tagline: '',
    highlight: false,
    selectable: true,
    monthlyPriceCents: monthly,
    annualPriceCents: monthly * 12,
    features: [],
    limits: { maxCloudAccounts, maxWorkspaceMembers: -1 },
    allowsOverage: monthly > 0,
  };
}

const catalog: PlanCatalog = {
  plans: [plan('free', 0, 2), plan('starter', 8000, 5), plan('team', 20000, -1)],
  overage: { unitCredits: 1, unitPriceCents: 100, defaultMonthlyCapCents: 50000 },
};

function usage(current: number, limit: number, planId = 'free'): WorkspacePlan {
  return {
    plan: { id: planId, name: planId[0]!.toUpperCase() + planId.slice(1), limits: { maxCloudAccounts: limit, maxWorkspaceMembers: -1 } },
    usage: {
      cloudAccounts: { current, limit },
      normalizedTokens: { percentage: 0, atLimit: false },
      workspaceMembers: { current: 1, limit: -1 },
    },
  };
}

interface Harness {
  deps: CapacityDeps;
  confirms: string[];
  checkouts: Array<{ mode: UpgradeMode; plan: string; cycle: string; previousPlanId: string; noBrowser: boolean }>;
}

function harness(opts: {
  plan?: WorkspacePlan | Error;
  catalog?: PlanCatalog | Error;
  answer?: boolean | typeof BACK;
  outcome?: CheckoutOutcome;
  interactive?: boolean;
  subscription?: Subscription | null;
}): Harness {
  const h: Harness = {
    confirms: [],
    checkouts: [],
    deps: {
      fetchPlan: async () => {
        const p = opts.plan ?? usage(2, 2);
        if (p instanceof Error) throw p;
        return p;
      },
      fetchCatalog: async () => {
        const c = opts.catalog ?? catalog;
        if (c instanceof Error) throw c;
        return c;
      },
      confirm: async (message) => {
        h.confirms.push(message);
        return opts.answer ?? true;
      },
      resolveMode: async () => {
        const subscription = opts.subscription ?? null;
        const mode: UpgradeMode = subscription && subscription.plan !== 'free' && subscription.stripeSubscriptionId ? 'change' : 'checkout';
        return { mode, subscription };
      },
      upgrade: async (_c, mode, o) => {
        h.checkouts.push({ mode, plan: o.plan.id, cycle: o.cycle, previousPlanId: o.previousPlanId, noBrowser: o.noBrowser });
        return opts.outcome ?? 'upgraded';
      },
      interactive: () => opts.interactive ?? true,
    },
  };
  return h;
}

const config = mockConfig({ output: 'text', nonInteractive: false });
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

describe('ensureCloudAccountCapacity', () => {
  it('is ok with room to spare and asks nothing', async () => {
    const h = harness({ plan: usage(1, 2) });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'ok');
    assert.deepEqual(h.confirms, []);
  });

  it('is ok on an unlimited plan however many are connected', async () => {
    const h = harness({ plan: usage(40, -1, 'team') });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'ok');
  });

  it('fails open when the plan cannot be read (the API still enforces the limit)', async () => {
    const h = harness({ plan: new Error('network') });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'ok');
  });

  it('is ok under --dry-run without touching the API', async () => {
    const h = harness({ plan: new Error('should not be called') });
    assert.equal(await ensureCloudAccountCapacity(mockConfig({ dryRun: true }), 'ws_1', { noBrowser: false }, h.deps), 'ok');
  });

  it('at the limit without a TTY exits QUOTA with the numbers and the upgrade hint', async () => {
    const h = harness({ plan: usage(2, 2), interactive: false });
    await assert.rejects(
      () => ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.QUOTA &&
        err.message === 'Your Free plan includes 2 cloud accounts; 2 connected.' &&
        err.hint === UPGRADE_LATER
    );
    assert.deepEqual(h.checkouts, []);
  });

  it('a zero-account plan is at the limit before the first connect', async () => {
    const h = harness({ plan: usage(0, 0), interactive: false });
    await assert.rejects(
      () => ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps),
      (err: unknown) => err instanceof CLIError && err.message === 'Your Free plan includes 0 cloud accounts; 0 connected.'
    );
  });

  it('pitches the cheapest plan that raises the limit, from the live catalog', async () => {
    const h = harness({ plan: usage(2, 2), answer: true });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: true }, h.deps), 'ok');
    const text = errOut.join('');
    assert.match(text, /Your Free plan includes 2 cloud accounts; 2 connected\./);
    assert.match(text, /Starter \(\$80\/mo\) allows 5 cloud accounts\./);
    assert.match(text, /Upgraded to Starter: 5 cloud accounts\./);
    assert.deepEqual(h.confirms, ['Upgrade to Starter now?']);
    assert.deepEqual(h.checkouts, [{ mode: 'checkout', plan: 'starter', cycle: 'monthly', previousPlanId: 'free', noBrowser: true }]);
  });

  it('follows a changed catalog: a one-account free plan pitches whichever plan beats one', async () => {
    const moved: PlanCatalog = { ...catalog, plans: [plan('free', 0, 1), plan('starter', 8000, 1), plan('team', 20000, -1)] };
    const h = harness({ plan: usage(1, 1), catalog: moved, answer: true });
    await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps);
    assert.match(errOut.join(''), /Team \(\$200\/mo\) allows unlimited cloud accounts\./);
    assert.equal(h.checkouts[0]?.plan, 'team');
  });

  it('declining says how to upgrade later and skips checkout', async () => {
    const h = harness({ plan: usage(2, 2), answer: false });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'declined');
    assert.match(errOut.join(''), new RegExp(UPGRADE_LATER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(h.checkouts, []);
  });

  it('backing out of the question counts as declining', async () => {
    const h = harness({ plan: usage(2, 2), answer: BACK });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'declined');
  });

  it('a Stripe cancel is a decline that still says how to upgrade later', async () => {
    const h = harness({ plan: usage(2, 2), outcome: 'canceled' });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'declined');
    assert.match(errOut.join(''), /Checkout canceled\. Upgrade any time/);
  });

  it('a timeout is treated as a decline', async () => {
    const h = harness({ plan: usage(2, 2), outcome: 'timeout' });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'declined');
    assert.match(errOut.join(''), /No upgrade yet\. Upgrade any time/);
  });

  it('a paid-but-not-flipped upgrade is pending with a retry line', async () => {
    const h = harness({ plan: usage(2, 2), outcome: 'pending' });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'pending');
    assert.match(errOut.join(''), /Retry in a minute: polylane cloud connect/);
  });

  it('a paying workspace at its limit is offered an in-place switch on its own billing cycle', async () => {
    const h = harness({
      plan: usage(5, 5, 'starter'),
      subscription: { plan: 'starter', status: 'active', billingCycle: 'annual', stripeSubscriptionId: 'sub_1' },
      answer: true,
    });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'ok');
    assert.match(errOut.join(''), /Team \(\$2400\/yr\) allows unlimited cloud accounts\./);
    assert.deepEqual(h.confirms, ['Switch to Team now? (prorated)']);
    assert.deepEqual(h.checkouts, [{ mode: 'change', plan: 'team', cycle: 'annual', previousPlanId: 'starter', noBrowser: false }]);
  });

  it('a paying workspace whose limit an admin lowered is pitched the next plan up, never its own', async () => {
    const h = harness({
      plan: usage(0, 0, 'starter'),
      subscription: { plan: 'starter', status: 'active', billingCycle: 'monthly', stripeSubscriptionId: 'sub_1' },
      answer: false,
    });
    assert.equal(await ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps), 'declined');
    assert.match(errOut.join(''), /Your Starter plan includes 0 cloud accounts; 0 connected\./);
    assert.match(errOut.join(''), /Team \(\$200\/mo\) allows unlimited cloud accounts\./);
    assert.deepEqual(h.confirms, ['Switch to Team now? (prorated)']);
  });

  it('exits QUOTA pointing at the pricing page when the catalog is unavailable', async () => {
    const h = harness({ plan: usage(2, 2), catalog: new Error('down') });
    await assert.rejects(
      () => ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps),
      (err: unknown) => err instanceof CLIError && err.exitCode === ExitCode.QUOTA && (err.hint ?? '').includes('polylane.com/pricing')
    );
  });

  it('exits QUOTA when no plan on sale raises the limit', async () => {
    const h = harness({ plan: usage(3, 3, 'starter'), catalog: { ...catalog, plans: [plan('free', 0, 2), plan('starter', 8000, 3)] } });
    await assert.rejects(
      () => ensureCloudAccountCapacity(config, 'ws_1', { noBrowser: false }, h.deps),
      (err: unknown) => err instanceof CLIError && err.exitCode === ExitCode.QUOTA
    );
    assert.deepEqual(h.confirms, []);
  });
});
