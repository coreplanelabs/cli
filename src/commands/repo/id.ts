import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';

export async function resolveRepoId(config: Config, raw: string, workspaceId: string): Promise<string> {
  if (raw.startsWith('repo_')) return raw;

  const api = new NominalAPI(config);

  if (raw.includes('/')) {
    const [owner, name] = raw.split('/');
    const list = await api.repositoriesList(workspaceId, {
      owner: owner!,
      name: name!,
      perPage: 5,
    });
    if (list.items.length === 0) {
      throw new CLIError(
        `No repository matching "${raw}"`,
        ExitCode.GENERAL,
        'Use `nominal repo list` to see available repositories'
      );
    }
    if (list.items.length > 1) {
      throw new CLIError(
        `Multiple repos match "${raw}"`,
        ExitCode.USAGE,
        list.items.map((r) => `  ${r.id} (${r.owner}/${r.name})`).join('\n')
      );
    }
    return list.items[0]!.id;
  }

  const list = await api.repositoriesList(workspaceId, { name: raw, perPage: 5 });
  if (list.items.length === 0) {
    throw new CLIError(
      `No repository matching "${raw}"`,
      ExitCode.GENERAL,
      'Use `nominal repo list` to see available repositories'
    );
  }
  if (list.items.length > 1) {
    throw new CLIError(
      `Multiple repos match "${raw}"`,
      ExitCode.USAGE,
      list.items.map((r) => `  ${r.id} (${r.owner}/${r.name})`).join('\n')
    );
  }
  return list.items[0]!.id;
}
