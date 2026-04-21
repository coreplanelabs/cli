import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { writeConfigFile } from '../../config/loader';
import { requirePositional } from '../helpers';

export const workspaceUseCommand: Command = {
  name: 'workspace use',
  description: 'Set the default workspace for future commands',
  positional: [{ name: 'workspace-id', description: 'Workspace ID or slug' }],
  examples: ['nominal workspace use ws_xxx', 'nominal workspace use acme-inc'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const raw = requirePositional(args, 0, 'workspace-id');
    const api = new NominalAPI(config);

    let workspace;
    if (raw.startsWith('ws_')) {
      workspace = await api.workspacesGet(raw);
    } else {
      const list = await api.workspacesList({ slug: raw, perPage: 5 });
      if (list.items.length === 0) {
        process.stderr.write(`No workspace matching "${raw}"\n`);
        process.exit(1);
      }
      workspace = list.items[0]!;
    }

    writeConfigFile({ workspace_id: workspace.id });
    process.stderr.write(`Using workspace ${workspace.id} (${workspace.name})\n`);
  },
};
