import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import type { CreateAutomationFromTemplateBody } from '../../generated/types';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgString, getArgNumber } from '../helpers';

type Provider = NonNullable<CreateAutomationFromTemplateBody['provider']>;

export const automationFromTemplateCommand: Command = {
  name: 'automation from-template',
  description: 'Create an automation from a catalog template slug',
  operationId: 'automations.postFromTemplate',
  positional: [{ name: 'template-slug', description: 'Slug from `polylane automation catalog`' }],
  options: [
    { flag: '--pass-count <n>', description: "Override the template's number of parallel agent passes (1-10)", type: 'number' },
    { flag: '--provider <name>', description: 'Sanity-check the template targets this provider; fails on mismatch', type: 'string' },
  ],
  examples: [
    'polylane automation catalog',
    'polylane automation from-template alert-triage',
    'polylane automation from-template babysit-cloudflare-deployment --pass-count 2 --provider cloudflare',
    '# To scope a template (e.g. narrow the trigger), crib its body and use `automation create`:',
    'polylane automation create --body-file template.json --trigger \'{"type":"cloudflare.deployment","filters":{"environments":["production"]}}\'',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const templateSlug = requirePositional(args, 0, 'template-slug');
    const passCount = getArgNumber(args, 'passCount');
    const provider = getArgString(args, 'provider') as Provider | undefined;
    const api = new PolylaneAPI(config);
    const automation = await api.automationsPostFromTemplate({
      workspaceId,
      templateSlug,
      ...(passCount !== undefined ? { passCount } : {}),
      ...(provider !== undefined ? { provider } : {}),
    });
    formatOutput(config, automation);
  },
};
