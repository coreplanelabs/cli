import { writeFileSync } from 'node:fs';
import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { requireWorkspace, requirePositional, getArgString } from '../helpers';

type Format = 'md' | 'pdf';

export const threadExportCommand: Command = {
  name: 'thread export',
  description: 'Export a thread as markdown or PDF',
  operationId: 'threads.export',
  positional: [{ name: 'thread-id', description: 'The thread ID' }],
  options: [
    { flag: '--format <f>', description: 'md | pdf (default md)', type: 'string' },
    { flag: '--out <path>', description: 'Output file (default stdout for md, required for pdf)', type: 'string' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const format = (getArgString(args, 'format') ?? 'md') as Format;
    const out = getArgString(args, 'out');

    const api = new NominalAPI(config);
    const result = await api.threadsExport({ workspaceId, id: threadId, format });

    const buffer = Buffer.from(result.base64, 'base64');
    if (out) {
      writeFileSync(out, buffer);
      process.stderr.write(`Wrote ${out} (${buffer.length} bytes)\n`);
      return;
    }
    if (format === 'pdf') {
      process.stderr.write('PDF output requires --out\n');
      process.exit(2);
    }
    process.stdout.write(buffer.toString('utf-8'));
  },
};
