import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { fetchWorkspacePlan } from '../../client/billing';
import { capacityOf, limitLabel } from '../../billing/plans';
import { formatOutput } from '../../output/formatter';
import { outputKeyValue } from '../../output/text';
import { requireWorkspace } from '../helpers';

function used(cap: { current: number; limit: number }): string {
  return `${cap.current} of ${limitLabel(cap.limit)}`;
}

export const subscriptionShowCommand: Command = {
  name: 'subscription show',
  description: "Show the workspace's plan and how much of each limit is used",
  operationId: 'workspaces.plan.get',
  examples: ['polylane subscription show', 'polylane subscription show --output json'],
  async execute(config: Config): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const plan = await fetchWorkspacePlan(config, workspaceId);
    const cloudAccounts = capacityOf(plan.usage.cloudAccounts);
    const workspaceMembers = capacityOf(plan.usage.workspaceMembers);
    if (config.output === 'json') {
      formatOutput(config, {
        plan: plan.plan,
        usage: { cloudAccounts, workspaceMembers, normalizedTokens: plan.usage.normalizedTokens },
      });
      return;
    }
    outputKeyValue([
      ['Plan', plan.plan.name],
      ['Cloud accounts', used(cloudAccounts)],
      ['Members', used(workspaceMembers)],
      ['Credits used', `${plan.usage.normalizedTokens.percentage}%${plan.usage.normalizedTokens.atLimit ? ' (exhausted)' : ''}`],
    ]);
    if (config.hints && cloudAccounts.atLimit) {
      process.stdout.write('\nCloud accounts are at the plan limit. Upgrade: polylane subscription upgrade\n');
    }
  },
};
