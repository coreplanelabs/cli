import type { Config } from '../config/schema';
import { fetchPlanCatalog, fetchWorkspacePlan } from '../client/billing';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { isInteractive } from '../utils/env';
import { BACK, promptYesNoOrBack } from '../utils/prompt';
import { UPGRADE_LATER, type CheckoutOutcome } from './checkout';
import { resolveUpgradeMode, runUpgrade, type UpgradeMode, type UpgradePlanOptions } from './upgrade';
import type { Subscription } from '../client/billing';
import {
  cheapestPlanRaising,
  cloudAccountCapacity,
  formatPrice,
  limitLabel,
  pluralize,
  type CatalogPlan,
  type PlanCatalog,
  type WorkspacePlan,
} from './plans';

const PRICING_URL = 'https://polylane.com/pricing';

// ok:       there is room (or the check could not run, which never blocks a connect:
//           the API enforces the limit and answers 402 if it must).
// declined: at the limit and the user said no, backed out of Stripe, or let it lapse.
// pending:  paid, but the plan has not flipped yet.
export type CapacityGate = 'ok' | 'declined' | 'pending';

export interface CapacityDeps {
  fetchPlan: (config: Config, workspaceId: string) => Promise<WorkspacePlan>;
  fetchCatalog: (config: Config) => Promise<PlanCatalog>;
  resolveMode: (config: Config, workspaceId: string) => Promise<{ mode: UpgradeMode; subscription: Subscription | null }>;
  upgrade: (config: Config, mode: UpgradeMode, opts: UpgradePlanOptions) => Promise<CheckoutOutcome>;
  confirm: (message: string) => Promise<boolean | typeof BACK>;
  interactive: (config: Config) => boolean;
}

function defaultDeps(config: Config): CapacityDeps {
  return {
    fetchPlan: fetchWorkspacePlan,
    fetchCatalog: fetchPlanCatalog,
    resolveMode: resolveUpgradeMode,
    upgrade: runUpgrade,
    confirm: (message) => promptYesNoOrBack({ nonInteractive: config.nonInteractive }, message, false),
    interactive: (cfg) => isInteractive(cfg.nonInteractive),
  };
}

function say(config: Config, line: string): void {
  if (!config.quiet) process.stderr.write(line + '\n');
}

function limitLine(plan: WorkspacePlan): string {
  const cap = cloudAccountCapacity(plan);
  return `Your ${plan.plan.name} plan includes ${pluralize(cap.limit, 'cloud account')}; ${cap.current} connected.`;
}

// Before a connect: is there room for one more cloud account on this plan? At
// the limit, offer the cheapest plan that raises it and run checkout right
// here, so the connect can carry on with the new plan. All numbers come from
// the API on each call; the CLI never assumes what a plan allows.
export async function ensureCloudAccountCapacity(
  config: Config,
  workspaceId: string,
  opts: { noBrowser: boolean },
  deps: CapacityDeps = defaultDeps(config)
): Promise<CapacityGate> {
  if (config.dryRun) return 'ok';
  let plan: WorkspacePlan;
  try {
    plan = await deps.fetchPlan(config, workspaceId);
  } catch {
    return 'ok';
  }
  if (!cloudAccountCapacity(plan).atLimit) return 'ok';

  if (!deps.interactive(config) || config.output === 'json') {
    throw new CLIError(limitLine(plan), ExitCode.QUOTA, UPGRADE_LATER);
  }

  let next: CatalogPlan | null = null;
  try {
    next = cheapestPlanRaising(await deps.fetchCatalog(config), 'maxCloudAccounts', plan.usage.cloudAccounts.limit, plan.plan.id);
  } catch {
    throw new CLIError(limitLine(plan), ExitCode.QUOTA, `Plans: ${PRICING_URL}\n${UPGRADE_LATER}`);
  }
  if (!next) {
    throw new CLIError(limitLine(plan), ExitCode.QUOTA, `Plans: ${PRICING_URL}`);
  }

  // A paying workspace changes plan in place (prorated, no browser); a free
  // one goes through Checkout. Decided before the question so it can be
  // worded honestly.
  const { mode, subscription } = await deps.resolveMode(config, workspaceId);
  const cycle = subscription?.billingCycle ?? 'monthly';

  say(config, '');
  say(config, limitLine(plan));
  say(config, `${next.name} (${formatPrice(next, cycle)}) allows ${limitLabel(next.limits.maxCloudAccounts)} cloud accounts. All plans: polylane subscription plans`);
  const answer = await deps.confirm(mode === 'change' ? `Switch to ${next.name} now? (prorated)` : `Upgrade to ${next.name} now?`);
  if (answer === BACK || !answer) {
    say(config, UPGRADE_LATER);
    return 'declined';
  }

  const outcome = await deps.upgrade(config, mode, { workspaceId, plan: next, cycle, noBrowser: opts.noBrowser, previousPlanId: plan.plan.id });
  switch (outcome) {
    case 'upgraded':
      say(config, `Upgraded to ${next.name}: ${limitLabel(next.limits.maxCloudAccounts)} cloud accounts.`);
      return 'ok';
    case 'canceled':
      say(config, `Checkout canceled. ${UPGRADE_LATER}`);
      return 'declined';
    case 'pending':
      say(config, 'Your plan is updating. Retry in a minute: polylane cloud connect');
      return 'pending';
    case 'handoff':
      // Nothing was waited for (no TTY to wait in); the connect cannot proceed yet.
      say(config, 'Finish the upgrade in the browser, then run: polylane cloud connect');
      return 'pending';
    case 'timeout':
      say(config, `No upgrade yet. ${UPGRADE_LATER}`);
      return 'declined';
  }
}
