import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';

export const memorySaveCommand: Command = {
  name: 'memory save',
  description: 'Save a memory',
  operationId: 'memories.post',
  positional: [{ name: 'content', description: 'Markdown content of the memory', variadic: true }],
  options: [
    { flag: '--title <t>', description: 'Title (default: first line of content)', type: 'string' },
    { flag: '--labels <a,b,c>', description: 'Comma-separated labels', type: 'string' },
    { flag: '--source-type <t>', description: 'investigation | change_analysis | observation', type: 'string' },
  ],
  examples: ['nominal memory save "The auth service uses Redis for sessions"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'content');
    const content = getAllPositional(args).join(' ');

    let title = getArgString(args, 'title');
    if (!title) {
      const firstLine = content.split('\n')[0] ?? content;
      title = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
    }

    const labelsRaw = getArgString(args, 'labels');
    const labels = labelsRaw ? labelsRaw.split(',').map((s) => s.trim()) : undefined;
    const sourceType = getArgString(args, 'sourceType') as
      | 'investigation'
      | 'change_analysis'
      | 'observation'
      | undefined;

    const api = new NominalAPI(config);
    const result = await api.memoriesPost({
      workspaceId,
      title,
      markdown: content,
      ...(labels ? { labels } : {}),
      ...(sourceType ? { sourceType } : {}),
    });

    formatOutput(config, { id: result.id, title: result.title });
  },
};
