import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const automationFromTemplateCommand: Command = {
  name: 'automation from-template',
  description: 'Create an automation from a catalog template slug',
  operationId: 'automations.postFromTemplate',
  positional: [{ name: 'template-slug', description: 'Slug from `polylane automation catalog`' }],
  examples: [
    'polylane automation catalog',
    'polylane automation from-template alert-triage',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const templateSlug = requirePositional(args, 0, 'template-slug');
    const api = new PolylaneAPI(config);
    const automation = await api.automationsPostFromTemplate({ workspaceId, templateSlug });
    formatOutput(config, automation);
  },
};
