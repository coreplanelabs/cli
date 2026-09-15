import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { fetchPlanCatalog } from '../../client/billing';
import { formatPrice, limitLabel } from '../../billing/plans';
import { formatOutput } from '../../output/formatter';
import { outputTable } from '../../output/text';

// The same catalog polylane.com/pricing renders; no sign-in needed.
export const subscriptionPlansCommand: Command = {
  name: 'subscription plans',
  description: 'List the plans on offer with prices and limits (no sign-in needed)',
  examples: ['polylane subscription plans', 'polylane subscription plans --output json'],
  async execute(config: Config): Promise<void> {
    const catalog = await fetchPlanCatalog(config);
    if (config.output === 'json') {
      formatOutput(config, catalog);
      return;
    }
    outputTable(
      ['Plan', 'Monthly', 'Annual', 'Cloud accounts', 'Members'],
      catalog.plans.map((plan) => [
        plan.name,
        formatPrice(plan, 'monthly'),
        formatPrice(plan, 'annual'),
        limitLabel(plan.limits.maxCloudAccounts),
        limitLabel(plan.limits.maxWorkspaceMembers),
      ])
    );
    if (config.hints) process.stdout.write('\nDetails: https://polylane.com/pricing\n');
  },
};
