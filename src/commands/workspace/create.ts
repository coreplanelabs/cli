import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { writeConfigFile } from '../../config/loader';
import { getArgString, promptIfMissing } from '../helpers';

type CreateWorkspaceBody = Parameters<PolylaneAPI['workspacesPost']>[0];

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
    'polylane workspace create --name "Acme Inc"',
    'polylane workspace create --name Acme --slug acme --description "Infra"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const name = await promptIfMissing(config, args, 'name', 'Workspace name', '--name');
    const description = getArgString(args, 'description');
    const slug = getArgString(args, 'slug');
    const noDefault = args.noDefault === true;

    // Workspace creation accepts the terms on the user's behalf, so say so
    // out loud first — on stderr, like every other notice, so piped stdout
    // stays pure data. Printed before the call and regardless of --quiet.
    process.stderr.write(
      'By creating a workspace you accept the Polylane Terms of Service: https://console.polylane.com/terms\n',
    );

    const body: CreateWorkspaceBody = { name };
    if (description !== undefined) body.description = description;
    if (slug !== undefined) body.slug = slug;

    const api = new PolylaneAPI(config);
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
