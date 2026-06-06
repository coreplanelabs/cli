import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList, formatOutput } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['version', 'created', 'createdBy', 'changeNote'];

export const artifactVersionsCommand: Command = {
  name: 'artifact versions',
  description: 'List artifact versions, or show one with --version',
  operationId: 'artifacts.listVersions',
  positional: [
    { name: 'thread-id', description: 'Thread ID (thrd_…)' },
    { name: 'artifact-id', description: 'Artifact ID' },
  ],
  options: [
    { flag: '--version <n>', description: 'Show this specific version (with content)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane artifact versions thrd_xxx art_xxx',
    'polylane artifact versions thrd_xxx art_xxx --version 2',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const artifactId = requirePositional(args, 1, 'artifact-id');
    const version = getArgNumber(args, 'version');

    const api = new PolylaneAPI(config);

    if (version !== undefined) {
      const result = await api.artifactsGetVersion(workspaceId, threadId, artifactId, version);
      formatOutput(config, result);
      return;
    }

    const result = await api.artifactsListVersions(workspaceId, threadId, artifactId);
    const full = getArgBoolean(args, 'full') === true;

    if (full) {
      formatList(config, result as { items: Array<Record<string, unknown>>; count: number });
      return;
    }

    formatList(
      config,
      {
        items: projectItems(result.items as unknown as Array<Record<string, unknown>>, FIELDS),
        count: result.count,
      },
      {
        headers: ['Version', 'Created', 'Author', 'Note'],
        rows: (item) => [
          String(item.version ?? ''),
          String(item.created ?? ''),
          String(item.createdBy ?? ''),
          truncate(String(item.changeNote ?? ''), 60),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
