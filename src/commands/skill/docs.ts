import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'name', 'filename', 'mimeType', 'size', 'updated'];

export const skillDocsCommand: Command = {
  name: 'skill docs',
  description: 'List documents attached to a skill',
  operationId: 'skills.documents.list',
  positional: [{ name: 'skill-id', description: 'The skill ID' }],
  options: [{ flag: '--full', description: 'Return full objects', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'skill-id');
    const full = getArgBoolean(args, 'full') === true;

    const api = new NominalAPI(config);
    const result = await api.skillsDocumentsList(workspaceId, id);

    if (full) {
      formatList(config, {
        items: result.items as unknown as Array<Record<string, unknown>>,
        count: result.items.length,
      });
      return;
    }

    const projected = projectItems(result.items as unknown as Array<Record<string, unknown>>, FIELDS);
    formatList(
      config,
      { items: projected, count: projected.length },
      {
        headers: ['ID', 'Name', 'Filename', 'Type', 'Size', 'Updated'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.name ?? ''),
          String(item.filename ?? ''),
          String(item.mimeType ?? ''),
          String(item.size ?? ''),
          String(item.updated ?? ''),
        ],
      }
    );
  },
};
