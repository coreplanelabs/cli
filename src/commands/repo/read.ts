import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';
import { resolveRepoId } from './id';

export const repoReadCommand: Command = {
  name: 'repo read',
  description: 'Read a file from a repository',
  operationId: 'repositories.codefiles.contents',
  positional: [
    { name: 'repo-id', description: 'Repo ID, owner/name, or short name' },
    { name: 'path', description: 'Path to the file' },
  ],
  examples: ['nominal repo read cli src/main.ts'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const repoRaw = requirePositional(args, 0, 'repo-id');
    const path = requirePositional(args, 1, 'path');

    const repoId = await resolveRepoId(config, repoRaw, workspaceId);
    const api = new NominalAPI(config);
    const result = await api.repositoriesCodefilesContents({
      workspaceId,
      repositoryId: repoId,
      path,
    });

    if (config.output === 'json') {
      formatOutput(config, result);
      return;
    }
    process.stdout.write(result.contents);
    if (!result.contents.endsWith('\n')) process.stdout.write('\n');
  },
};
