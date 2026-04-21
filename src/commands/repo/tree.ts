import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getPositional } from '../helpers';
import { resolveRepoId } from './id';

export const repoTreeCommand: Command = {
  name: 'repo tree',
  description: 'List files in a directory of a repository',
  operationId: 'repositories.codefiles.tree',
  positional: [
    { name: 'repo-id', description: 'Repo ID, owner/name, or short name' },
    { name: 'path', description: 'Directory path (default: root)', required: false },
  ],
  examples: ['nominal repo tree cli src/commands'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const repoRaw = requirePositional(args, 0, 'repo-id');
    const path = getPositional(args, 1) ?? '';

    const repoId = await resolveRepoId(config, repoRaw, workspaceId);
    const api = new NominalAPI(config);
    const result = await api.repositoriesCodefilesTree(workspaceId, repoId, { path });

    formatList(
      config,
      { items: result.items as Array<Record<string, unknown>>, count: result.totalCount },
      {
        headers: ['Name', 'Type', 'Lang', 'Path'],
        rows: (item) => [
          String(item.name ?? ''),
          String(item.type ?? ''),
          String(item.language ?? ''),
          String(item.path ?? ''),
        ],
      }
    );
  },
};
