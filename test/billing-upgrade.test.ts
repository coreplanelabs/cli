import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runUpgrade, upgradeModeFor, type UpgradeDeps, type UpgradePlanOptions } from '../src/billing/upgrade';
import { UPGRADE_LATER } from '../src/billing/checkout';
import type { CatalogPlan, WorkspacePlan } from '../src/billing/plans';
import { ApiError } from '../src/errors/api';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import { mockConfig } from './helpers/config';

const team: CatalogPlan = {
  id: 'team',
  name: 'Team',
  tagline: '',
  highlight: false,
  selectable: true,
  monthlyPriceCents: 20000,
  annualPriceCents: 192000,
  features: [],
  limits: { maxCloudAccounts: -1, maxWorkspaceMembers: -1 },
  allowsOverage: true,
};

function workspacePlan(id: string): WorkspacePlan {
  return {
    plan: { id, name: id, limits: { maxCloudAccounts: 5, maxWorkspaceMembers: -1 } },
    usage: {
      cloudAccounts: { current: 5, limit: 5 },
      normalizedTokens: { percentage: 0, atLimit: false },
      workspaceMembers: { current: 1, limit: -1 },
    },
  };
}

const opts: UpgradePlanOptions = {
  workspaceId: 'ws_1',
  plan: team,
  cycle: 'monthly',
  noBrowser: false,
  previousPlanId: 'starter',
  settleMs: 20,
  pollIntervalMs: 1,
};

function deps(over: Partial<UpgradeDeps> & { planIds?: string[] } = {}): UpgradeDeps & { changes: unknown[]; checkouts: unknown[] } {
  const planIds = over.planIds ?? ['starter'];
  const d = {
    changes: [] as unknown[],
    checkouts: [] as unknown[],
    fetchSubscription: async () => ({ plan: 'starter', status: 'active', billingCycle: 'monthly' as const, stripeSubscriptionId: 'sub_1' }),
    changePlan: async (_c: unknown, body: unknown) => {
      d.changes.push(body);
      return {};
    },
    fetchPlan: async () => workspacePlan(planIds.length > 1 ? planIds.shift()! : planIds[0]!),
    checkout: async (_c: unknown, o: unknown) => {
      d.checkouts.push(o);
      return 'canceled' as const;
    },
    sleep: async () => {},
    ...over,
  };
  return d;
}

const realErr = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  process.stderr.write = (() => true) as typeof process.stderr.write;
});
afterEach(() => {
  process.stderr.write = realErr;
});

describe('upgradeModeFor', () => {
  it('is checkout for a free workspace, or when there is no subscription record', () => {
    assert.equal(upgradeModeFor(null), 'checkout');
    assert.equal(upgradeModeFor({ plan: 'free', status: 'none', billingCycle: 'monthly', stripeSubscriptionId: null }), 'checkout');
  });

  it('is checkout when the plan is paid but no Stripe subscription backs it (admin-granted)', () => {
    assert.equal(upgradeModeFor({ plan: 'enterprise', status: 'active', billingCycle: 'monthly', stripeSubscriptionId: null }), 'checkout');
  });

  it('is an in-place change for a paying workspace', () => {
    assert.equal(upgradeModeFor({ plan: 'starter', status: 'active', billingCycle: 'annual', stripeSubscriptionId: 'sub_1' }), 'change');
  });
});

describe('runUpgrade', () => {
  it('delegates checkout mode to the checkout flow untouched', async () => {
    const d = deps();
    assert.equal(await runUpgrade(mockConfig(), 'checkout', opts, d), 'canceled');
    assert.deepEqual(d.checkouts, [opts]);
    assert.deepEqual(d.changes, []);
  });

  it('changes the plan in place and is upgraded once the plan endpoint flips', async () => {
    const d = deps({ planIds: ['starter', 'starter', 'team'] });
    assert.equal(await runUpgrade(mockConfig(), 'change', opts, d), 'upgraded');
    assert.deepEqual(d.changes, [{ workspaceId: 'ws_1', newPlan: 'team', newBillingCycle: 'monthly' }]);
    assert.deepEqual(d.checkouts, []);
  });

  it('is pending when the webhook has not flipped the plan within the settle window', async () => {
    const d = deps({ planIds: ['starter'] });
    assert.equal(await runUpgrade(mockConfig(), 'change', opts, d), 'pending');
  });

  it('keeps waiting through transient plan-read failures', async () => {
    let calls = 0;
    const d = deps({
      fetchPlan: async () => {
        calls += 1;
        if (calls < 2) throw new Error('boom');
        return workspacePlan('team');
      },
    });
    assert.equal(await runUpgrade(mockConfig(), 'change', opts, d), 'upgraded');
  });

  it('wraps a change-plan API error, keeps its exit code, and says how to upgrade later', async () => {
    const d = deps({
      changePlan: async () => {
        throw new ApiError(404, 'No Stripe subscription for workspace', ExitCode.GENERAL);
      },
    });
    await assert.rejects(
      () => runUpgrade(mockConfig(), 'change', opts, d),
      (err: unknown) =>
        err instanceof CLIError &&
        err.exitCode === ExitCode.GENERAL &&
        err.message === "Couldn't change the plan: No Stripe subscription for workspace" &&
        err.hint === UPGRADE_LATER
    );
  });
});
