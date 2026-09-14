import type { Config } from '../config/schema';
import { changePlan, fetchSubscription, fetchWorkspacePlan, type ChangePlanRequest, type Subscription } from '../client/billing';
import { isApiError } from '../errors/api';
import { CLIError } from '../errors/base';
import { Spinner } from '../output/progress';
import { runCheckout, UPGRADE_LATER, type CheckoutOutcome } from './checkout';
import type { BillingCycle, CatalogPlan, WorkspacePlan } from './plans';

// How a workspace moves to a paid plan depends on whether it already pays:
//   free (no Stripe subscription)  -> Stripe Checkout in the browser
//   paid                           -> prorated change of the existing subscription, no browser
// Sending a paying workspace through Checkout would open a second
// subscription, so the split is decided here from the subscription record,
// the same way the console decides it.
export type UpgradeMode = 'checkout' | 'change';

export interface UpgradePlanOptions {
  workspaceId: string;
  plan: CatalogPlan;
  // The cycle to buy or switch to. Callers default it to the current one.
  cycle: BillingCycle;
  noBrowser: boolean;
  previousPlanId: string;
  settleMs?: number;
  pollIntervalMs?: number;
}

export interface UpgradeDeps {
  fetchSubscription: (config: Config, workspaceId: string) => Promise<Subscription>;
  changePlan: (config: Config, body: ChangePlanRequest) => Promise<unknown>;
  fetchPlan: (config: Config, workspaceId: string) => Promise<WorkspacePlan>;
  checkout: (config: Config, opts: UpgradePlanOptions) => Promise<CheckoutOutcome>;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: UpgradeDeps = {
  fetchSubscription,
  changePlan,
  fetchPlan: fetchWorkspacePlan,
  checkout: (config, opts) => runCheckout(config, opts),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const DEFAULT_SETTLE_MS = 90_000;
const DEFAULT_POLL_MS = 3_000;

export function upgradeModeFor(subscription: Subscription | null): UpgradeMode {
  return subscription && subscription.plan !== 'free' && subscription.stripeSubscriptionId ? 'change' : 'checkout';
}

// Reads the subscription to pick the mode. A failed read is thrown, never
// guessed: guessing checkout for a paying workspace would open a second
// subscription.
export async function resolveUpgradeMode(config: Config, workspaceId: string, deps: UpgradeDeps = defaultDeps): Promise<{ mode: UpgradeMode; subscription: Subscription | null }> {
  const subscription = await deps.fetchSubscription(config, workspaceId);
  return { mode: upgradeModeFor(subscription), subscription };
}

// Runs the upgrade in whichever mode fits. Outcomes are the checkout ones:
// an in-place change reports upgraded once the plan endpoint shows the new
// plan, or pending if the webhook has not landed within the settle window.
export async function runUpgrade(config: Config, mode: UpgradeMode, opts: UpgradePlanOptions, deps: UpgradeDeps = defaultDeps): Promise<CheckoutOutcome> {
  if (mode === 'checkout') return deps.checkout(config, opts);

  try {
    await deps.changePlan(config, { workspaceId: opts.workspaceId, newPlan: opts.plan.id, newBillingCycle: opts.cycle });
  } catch (err) {
    if (isApiError(err)) {
      throw new CLIError(`Couldn't change the plan: ${err.message}`, err.exitCode, [err.hint, UPGRADE_LATER].filter(Boolean).join('\n'));
    }
    throw err;
  }
  if (config.dryRun) return 'upgraded';
  const spinner = new Spinner('Plan changed, waiting for it to apply…');
  spinner.start();
  try {
    const poll = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    const settleBy = Date.now() + (opts.settleMs ?? DEFAULT_SETTLE_MS);
    while (Date.now() < settleBy) {
      await deps.sleep(poll);
      try {
        const plan = await deps.fetchPlan(config, opts.workspaceId);
        if (plan.plan.id !== opts.previousPlanId) return 'upgraded';
      } catch {
        // Not applied yet, or a transient read failure: keep waiting.
      }
    }
    return 'pending';
  } finally {
    spinner.stop();
  }
}
