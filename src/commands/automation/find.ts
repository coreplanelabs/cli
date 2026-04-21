import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getAllPositional } from '../helpers';

const FIELDS = ['id', 'name', 'triggerType', 'disabled', 'source', 'created'];

export const automationFindCommand: Command = {
  name: 'automation find',
  description: 'Search automations by prompt',
  operationId: 'automations.search',
  positional: [{ name: 'prompt', description: 'Search query', variadic: true }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'prompt');
    const prompt = getAllPositional(args).join(' ');

    const api = new NominalAPI(config);
    const items = await api.automationsSearch({ workspaceId, prompt });
    const projected = projectItems(items as unknown as Array<Record<string, unknown>>, FIELDS);

    formatList(
      config,
      { items: projected, count: projected.length },
      {
        headers: ['ID', 'Name', 'Trigger', 'Disabled', 'Source', 'Created'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.name ?? ''),
          String(item.triggerType ?? ''),
          item.disabled ? 'yes' : 'no',
          String(item.source ?? ''),
          String(item.created ?? ''),
        ],
      }
    );
  },
};
