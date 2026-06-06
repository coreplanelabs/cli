import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';
import { resolveRepoId } from './id';

export const repoShowCommand: Command = {
  name: 'repo show',
  description: 'Show a repository',
  operationId: 'repositories.get',
  positional: [{ name: 'repo-id', description: 'Repo ID, owner/name, or short name' }],
  examples: ['polylane repo show repo_xxx', 'polylane repo show boristane/cli'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const raw = requirePositional(args, 0, 'repo-id');
    const repoId = await resolveRepoId(config, raw, workspaceId);
    const api = new PolylaneAPI(config);
    const result = await api.repositoriesGet(workspaceId, repoId);
    formatOutput(config, result);
  },
};
