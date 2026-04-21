import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { writeConfigFile } from '../../config/loader';
import { getArgString, promptIfMissing } from '../helpers';

export const workspaceCreateCommand: Command = {
  name: 'workspace create',
  description: 'Create a new workspace and set it as the default',
  operationId: 'workspaces.post',
  options: [
    { flag: '--name <name>', description: 'Workspace name', type: 'string' },
    { flag: '--description <text>', description: 'Workspace description', type: 'string' },
    { flag: '--slug <slug>', description: 'URL slug (lowercase, dashes)', type: 'string' },
    { flag: '--no-default', description: 'Do not set this workspace as default', type: 'boolean' },
  ],
  examples: [
    'nominal workspace create --name "Acme Inc"',
    'nominal workspace create --name Acme --slug acme --description "Infra"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const name = await promptIfMissing(config, args, 'name', 'Workspace name', '--name');
    const description = getArgString(args, 'description');
    const slug = getArgString(args, 'slug');
    const noDefault = args.noDefault === true;

    const body: Parameters<NominalAPI['workspacesPost']>[0] = { name };
    if (description !== undefined) body.description = description;
    if (slug !== undefined) body.slug = slug;

    const api = new NominalAPI(config);
    const workspace = await api.workspacesPost(body);

    if (!noDefault) {
      writeConfigFile({ workspace_id: workspace.id });
      if (!config.quiet) {
        process.stderr.write(`Default workspace set to ${workspace.id}\n`);
      }
    }

    formatOutput(config, workspace);
  },
};
