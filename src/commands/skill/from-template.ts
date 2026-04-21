import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const skillFromTemplateCommand: Command = {
  name: 'skill from-template',
  description: 'Create a skill from a catalog template slug',
  operationId: 'skills.createFromTemplate',
  positional: [{ name: 'template-slug', description: 'Slug from `nominal skill catalog`' }],
  examples: [
    'nominal skill catalog',
    'nominal skill from-template runbook-triage',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const templateSlug = requirePositional(args, 0, 'template-slug');
    const api = new NominalAPI(config);
    const skill = await api.skillsCreateFromTemplate({ workspaceId, templateSlug });
    formatOutput(config, skill);
  },
};
