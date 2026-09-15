import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { createPortalSession } from '../../client/billing';
import { isOpenableUrl } from '../../billing/checkout';
import { formatOutput } from '../../output/formatter';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import { getArgBoolean, requireWorkspace } from '../helpers';

// Invoices, payment method, plan changes and cancellation all live in the
// Stripe billing portal; the CLI's job is to get you there signed in.
export const subscriptionManageCommand: Command = {
  name: 'subscription manage',
  description: 'Open the billing portal (invoices, payment method, change or cancel the plan)',
  operationId: 'billing.portal.create',
  options: [{ flag: '--no-browser', description: 'Print the portal URL instead of opening it', type: 'boolean' }],
  examples: ['polylane subscription manage', 'polylane subscription manage --no-browser'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const { url } = await createPortalSession(config, workspaceId);
    if (config.output === 'json') {
      formatOutput(config, { url });
      return;
    }
    const shouldOpen = getArgBoolean(args, 'noBrowser') !== true && isInteractive(config.nonInteractive) && isOpenableUrl(url);
    if (!config.quiet) {
      process.stderr.write(shouldOpen ? "Opening the billing portal in your browser…\nIf it doesn't open, use this URL:\n" : 'Open this URL to manage billing:\n');
    }
    process.stdout.write(url + '\n');
    if (shouldOpen) openBrowser(url);
  },
};
