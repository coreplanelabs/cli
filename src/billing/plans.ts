// Plan catalog and workspace-plan shapes as the billing API serves them, plus
// the arithmetic the CLI does on top. Every limit here is data from the API at
// run time: nothing in the CLI knows how many cloud accounts a plan allows.

export const UNLIMITED = -1;

export type BillingCycle = 'monthly' | 'annual';

export interface PlanLimits {
  maxCloudAccounts: number;
  maxWorkspaceMembers: number;
  [dimension: string]: number | undefined;
}

export interface CatalogPlan {
  id: string;
  name: string;
  tagline: string;
  highlight: boolean;
  selectable: boolean;
  monthlyPriceCents: number;
  annualPriceCents: number;
  features: string[];
  limits: PlanLimits;
  allowsOverage: boolean;
}

export interface PlanCatalog {
  plans: CatalogPlan[];
  overage: { unitCredits: number; unitPriceCents: number; defaultMonthlyCapCents: number };
}

export interface WorkspacePlan {
  plan: { id: string; name: string; limits: PlanLimits };
  usage: {
    cloudAccounts: { current: number; limit: number };
    normalizedTokens: { percentage: number; atLimit: boolean };
    workspaceMembers: { current: number; limit: number };
  };
}

export interface Capacity {
  current: number;
  limit: number;
  unlimited: boolean;
  atLimit: boolean;
  remaining: number | null;
}

export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

// The API applies the workspace's own (possibly admin-adjusted) limit to
// usage.cloudAccounts.limit, so that is the number to trust — not the
// catalog's default for the plan.
export function capacityOf(usage: { current: number; limit: number }): Capacity {
  const unlimited = isUnlimited(usage.limit);
  return {
    current: usage.current,
    limit: usage.limit,
    unlimited,
    atLimit: !unlimited && usage.current >= usage.limit,
    remaining: unlimited ? null : Math.max(0, usage.limit - usage.current),
  };
}

export function cloudAccountCapacity(plan: WorkspacePlan): Capacity {
  return capacityOf(plan.usage.cloudAccounts);
}

// A plan the CLI can send to checkout: sold at a price (Free costs nothing to
// be on; Enterprise is quoted, not bought).
export function isPurchasable(plan: CatalogPlan): boolean {
  return plan.selectable && plan.monthlyPriceCents > 0;
}

// The cheapest purchasable plan that lifts `dimension` above `currentLimit`,
// or null when no plan on sale does (the workspace is already on the top
// tier for that dimension, or the catalog is empty).
export function cheapestPlanRaising(
  catalog: PlanCatalog,
  dimension: keyof PlanLimits & string,
  currentLimit: number
): CatalogPlan | null {
  const candidates = catalog.plans.filter((plan) => {
    if (!isPurchasable(plan)) return false;
    const limit = plan.limits[dimension];
    if (limit === undefined) return false;
    if (isUnlimited(limit)) return !isUnlimited(currentLimit);
    return !isUnlimited(currentLimit) && limit > currentLimit;
  });
  candidates.sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
  return candidates[0] ?? null;
}

// What `subscription upgrade` may move to: purchasable plans priced above the
// current one. Moving down is a billing-settings decision with a preview, not
// an upgrade; a plan the catalog does not list (admin-granted) counts as $0.
export function upgradeCandidates(catalog: PlanCatalog, currentPlanId: string): CatalogPlan[] {
  const currentPrice = catalog.plans.find((p) => p.id === currentPlanId)?.monthlyPriceCents ?? 0;
  return catalog.plans
    .filter((p) => isPurchasable(p) && p.id !== currentPlanId && p.monthlyPriceCents > currentPrice)
    .sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
}

export function formatPrice(plan: CatalogPlan, cycle: BillingCycle): string {
  const cents = cycle === 'annual' ? plan.annualPriceCents : plan.monthlyPriceCents;
  if (cents === 0) return plan.id === 'free' ? '$0' : 'custom';
  const dollars = cents / 100;
  const amount = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${amount}/${cycle === 'annual' ? 'yr' : 'mo'}`;
}

export function limitLabel(limit: number | undefined): string {
  if (limit === undefined) return '';
  return isUnlimited(limit) ? 'unlimited' : String(limit);
}

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
