import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { fetchPlanCatalog, fetchWorkspacePlan } from '../../client/billing';
import { TERMS_LINE, UPGRADE_LATER } from '../../billing/checkout';
import { resolveUpgradeMode, runUpgrade } from '../../billing/upgrade';
import { formatPrice, limitLabel, upgradeCandidates, type BillingCycle, type CatalogPlan, type PlanCatalog } from '../../billing/plans';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { isInteractive } from '../../utils/env';
import { promptConfirm, promptSelect } from '../../utils/prompt';
import { getArgBoolean, getArgString, requireWorkspace } from '../helpers';

const CYCLES: BillingCycle[] = ['monthly', 'annual'];

function parseCycle(value: string | undefined, fallback: BillingCycle): BillingCycle {
  if (value === undefined) return fallback;
  if ((CYCLES as string[]).includes(value)) return value as BillingCycle;
  throw new CLIError(`Invalid value for --cycle: "${value}"`, ExitCode.USAGE, 'Use monthly or annual');
}

async function choosePlan(config: Config, catalog: PlanCatalog, currentPlanId: string, fromFlag: string | undefined, cycle: BillingCycle): Promise<CatalogPlan> {
  const onSale = upgradeCandidates(catalog, currentPlanId);
  if (onSale.length === 0) {
    throw new CLIError('No plan above the current one to upgrade to', ExitCode.GENERAL, 'Change or cancel the plan from the billing portal: polylane subscription manage');
  }
  const ids = onSale.map((p) => p.id);
  if (fromFlag !== undefined) {
    const picked = onSale.find((p) => p.id === fromFlag);
    if (!picked) {
      throw new CLIError(`Invalid value for --plan: "${fromFlag}"`, ExitCode.USAGE, `Choose one of: ${ids.join(', ')}`);
    }
    return picked;
  }
  if (!isInteractive(config.nonInteractive)) {
    throw new CLIError('Missing required flag: --plan', ExitCode.USAGE, `Choose one of: ${ids.join(', ')}`);
  }
  const id = await promptSelect(
    { nonInteractive: config.nonInteractive },
    'Which plan?',
    onSale.map((p) => ({
      value: p.id,
      label: p.name,
      hint: `${formatPrice(p, cycle)}, ${limitLabel(p.limits.maxCloudAccounts)} cloud accounts`,
    }))
  );
  return onSale.find((p) => p.id === id)!;
}

export const subscriptionUpgradeCommand: Command = {
  name: 'subscription upgrade',
  description: 'Upgrade the workspace plan (Stripe Checkout, or a prorated change when already paying)',
  operationId: 'billing.checkout.create',
  options: [
    { flag: '--plan <id>', description: 'Plan to buy (prompted if omitted; see subscription plans)', type: 'string' },
    { flag: '--cycle <monthly|annual>', description: 'Billing cycle (default: the current one, else monthly)', type: 'string' },
    { flag: '--no-browser', description: 'Print the checkout URL instead of opening it', type: 'boolean' },
    { flag: '--yes', description: 'Skip the confirmation when the plan changes in place (already paying)', type: 'boolean' },
  ],
  examples: [
    'polylane subscription upgrade',
    'polylane subscription upgrade --plan starter',
    'polylane subscription upgrade --plan team --cycle annual --no-browser',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const [catalog, current, { mode, subscription }] = await Promise.all([
      fetchPlanCatalog(config),
      fetchWorkspacePlan(config, workspaceId),
      resolveUpgradeMode(config, workspaceId),
    ]);
    const cycle = parseCycle(getArgString(args, 'cycle'), subscription?.billingCycle ?? 'monthly');
    const plan = await choosePlan(config, catalog, current.plan.id, getArgString(args, 'plan'), cycle);

    // Checkout confirms on Stripe's page. An in-place change bills the
    // difference the moment the request lands, so it gets its own question,
    // and a script has to say --yes.
    if (mode === 'change' && getArgBoolean(args, 'yes') !== true) {
      const question = `Switch ${current.plan.name} to ${plan.name} (${formatPrice(plan, cycle)}, prorated) now?`;
      if (!isInteractive(config.nonInteractive)) {
        throw new CLIError(`Confirmation required: ${question}`, ExitCode.USAGE, 'Pass --yes to change the plan without a prompt');
      }
      if (!config.quiet) process.stderr.write(`${TERMS_LINE}\n`);
      if (!(await promptConfirm({ nonInteractive: config.nonInteractive }, question, false))) {
        process.stderr.write(`Plan unchanged. ${UPGRADE_LATER}\n`);
        process.exitCode = ExitCode.GENERAL;
        return;
      }
    }

    const outcome = await runUpgrade(config, mode, { workspaceId, plan, cycle, noBrowser, previousPlanId: current.plan.id });
    const say = (line: string): void => {
      if (!config.quiet) process.stderr.write(line + '\n');
    };
    switch (outcome) {
      case 'upgraded':
        say(`Upgraded to ${plan.name}.`);
        return;
      case 'handoff':
        return;
      case 'pending':
        say('Your plan is updating. Check in a minute: polylane subscription show');
        process.exitCode = ExitCode.PENDING;
        return;
      case 'canceled':
        say(`Checkout canceled. ${UPGRADE_LATER}`);
        process.exitCode = ExitCode.GENERAL;
        return;
      case 'timeout':
        say(`No upgrade yet. ${UPGRADE_LATER}`);
        process.exitCode = ExitCode.GENERAL;
        return;
    }
  },
};
