import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityOf,
  cheapestPlanRaising,
  cloudAccountCapacity,
  formatPrice,
  isPurchasable,
  limitLabel,
  upgradeCandidates,
  type CatalogPlan,
  type PlanCatalog,
} from '../src/billing/plans';

function plan(overrides: Partial<CatalogPlan> & { id: string }): CatalogPlan {
  return {
    name: overrides.id,
    tagline: '',
    highlight: false,
    selectable: true,
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    features: [],
    limits: { maxCloudAccounts: -1, maxWorkspaceMembers: -1 },
    allowsOverage: false,
    ...overrides,
  };
}

// Shaped like the live catalog, but the numbers are inputs here — the CLI
// must follow whatever the API says, so the tests vary them.
const catalog: PlanCatalog = {
  plans: [
    plan({ id: 'free', limits: { maxCloudAccounts: 2, maxWorkspaceMembers: -1 } }),
    plan({ id: 'starter', monthlyPriceCents: 8000, annualPriceCents: 76800, limits: { maxCloudAccounts: 5, maxWorkspaceMembers: -1 } }),
    plan({ id: 'team', monthlyPriceCents: 20000, annualPriceCents: 192000 }),
    plan({ id: 'scale', monthlyPriceCents: 80000, annualPriceCents: 768000 }),
    plan({ id: 'enterprise', monthlyPriceCents: 0 }),
  ],
  overage: { unitCredits: 1, unitPriceCents: 100, defaultMonthlyCapCents: 50000 },
};

describe('capacityOf', () => {
  it('is at the limit when current reaches it', () => {
    assert.deepEqual(capacityOf({ current: 2, limit: 2 }), { current: 2, limit: 2, unlimited: false, atLimit: true, remaining: 0 });
  });

  it('has room below the limit', () => {
    assert.deepEqual(capacityOf({ current: 1, limit: 3 }), { current: 1, limit: 3, unlimited: false, atLimit: false, remaining: 2 });
  });

  it('a zero limit is at the limit before anything is connected', () => {
    assert.equal(capacityOf({ current: 0, limit: 0 }).atLimit, true);
  });

  it('a limit of -1 is unlimited and never at the limit', () => {
    assert.deepEqual(capacityOf({ current: 40, limit: -1 }), { current: 40, limit: -1, unlimited: true, atLimit: false, remaining: null });
  });

  it('clamps remaining at zero when over the limit (admin lowered it)', () => {
    assert.equal(capacityOf({ current: 5, limit: 2 }).remaining, 0);
  });

  it('cloudAccountCapacity reads usage.cloudAccounts, not the plan default', () => {
    const cap = cloudAccountCapacity({
      plan: { id: 'free', name: 'Free', limits: { maxCloudAccounts: 2, maxWorkspaceMembers: -1 } },
      usage: {
        cloudAccounts: { current: 3, limit: 3 },
        normalizedTokens: { percentage: 0, atLimit: false },
        workspaceMembers: { current: 1, limit: -1 },
      },
    });
    assert.equal(cap.limit, 3);
    assert.equal(cap.atLimit, true);
  });
});

describe('cheapestPlanRaising', () => {
  it('picks the cheapest paid plan with a higher limit', () => {
    assert.equal(cheapestPlanRaising(catalog, 'maxCloudAccounts', 2, 'free')?.id, 'starter');
  });

  it('skips plans that do not raise the limit', () => {
    assert.equal(cheapestPlanRaising(catalog, 'maxCloudAccounts', 5, 'starter')?.id, 'team');
  });

  it('returns null when the current limit is already unlimited', () => {
    assert.equal(cheapestPlanRaising(catalog, 'maxCloudAccounts', -1, 'team'), null);
  });

  it('never offers Free or Enterprise', () => {
    const only = { ...catalog, plans: catalog.plans.filter((p) => p.monthlyPriceCents === 0) };
    assert.equal(cheapestPlanRaising(only, 'maxCloudAccounts', 0, 'free'), null);
  });

  it('follows the catalog when the free limit moves', () => {
    const moved = {
      ...catalog,
      plans: catalog.plans.map((p) => (p.id === 'starter' ? { ...p, limits: { ...p.limits, maxCloudAccounts: 1 } } : p)),
    };
    // Starter no longer raises a limit of 1, so the next tier is offered.
    assert.equal(cheapestPlanRaising(moved, 'maxCloudAccounts', 1, 'free')?.id, 'team');
  });

  it('never pitches the plan the workspace is already on, even when an admin lowered its limit below the catalog default', () => {
    // Seen live on UAT: Starter with maxCloudAccounts lowered to 0 was offered Starter.
    assert.equal(cheapestPlanRaising(catalog, 'maxCloudAccounts', 0, 'starter')?.id, 'team');
  });

  it('never pitches a plan priced at or below the current one', () => {
    assert.equal(cheapestPlanRaising(catalog, 'maxCloudAccounts', 0, 'team')?.id, 'scale');
    assert.equal(cheapestPlanRaising(catalog, 'maxCloudAccounts', 0, 'scale'), null);
  });

  it('ignores plans that are not selectable', () => {
    const hidden = { ...catalog, plans: catalog.plans.map((p) => (p.id === 'starter' ? { ...p, selectable: false } : p)) };
    assert.equal(cheapestPlanRaising(hidden, 'maxCloudAccounts', 2, 'free')?.id, 'team');
  });
});

describe('upgradeCandidates', () => {
  it('offers every paid plan to a free workspace, cheapest first', () => {
    assert.deepEqual(upgradeCandidates(catalog, 'free').map((p) => p.id), ['starter', 'team', 'scale']);
  });

  it('offers only plans priced above the current one', () => {
    assert.deepEqual(upgradeCandidates(catalog, 'starter').map((p) => p.id), ['team', 'scale']);
    assert.deepEqual(upgradeCandidates(catalog, 'team').map((p) => p.id), ['scale']);
  });

  it('offers nothing above the top paid plan', () => {
    assert.deepEqual(upgradeCandidates(catalog, 'scale'), []);
  });

  it('treats a plan the catalog does not list as $0', () => {
    assert.deepEqual(upgradeCandidates(catalog, 'beta').map((p) => p.id), ['starter', 'team', 'scale']);
  });
});

describe('formatting', () => {
  it('formats prices per cycle', () => {
    const starter = catalog.plans[1]!;
    assert.equal(formatPrice(starter, 'monthly'), '$80/mo');
    assert.equal(formatPrice(starter, 'annual'), '$768/yr');
    assert.equal(formatPrice(catalog.plans[0]!, 'monthly'), '$0');
    assert.equal(formatPrice(catalog.plans[4]!, 'monthly'), 'custom');
  });

  it('labels limits', () => {
    assert.equal(limitLabel(-1), 'unlimited');
    assert.equal(limitLabel(2), '2');
    assert.equal(limitLabel(undefined), '');
  });

  it('isPurchasable excludes free and quoted plans', () => {
    assert.deepEqual(catalog.plans.filter(isPurchasable).map((p) => p.id), ['starter', 'team', 'scale']);
  });
});
