import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';
import type { Message } from '../../generated/types';

export const threadShowCommand: Command = {
  name: 'thread show',
  description: 'Show a thread with its messages',
  operationId: 'threads.get',
  positional: [{ name: 'thread-id', description: 'The thread ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');

    const api = new NominalAPI(config);
    const [threadResult, messages] = await Promise.all([
      api.threadsGet(workspaceId, threadId),
      api.messagesList(workspaceId, threadId, { perPage: 100, order: 'asc' }),
    ]);

    if (config.output === 'json') {
      formatOutput(config, { thread: threadResult.thread, messages });
      return;
    }

    const t = threadResult.thread;
    process.stdout.write(`# ${t.name}\n\n`);
    process.stdout.write(`ID: ${t.id}\n`);
    process.stdout.write(`Type: ${t.type}\n`);
    process.stdout.write(`Created: ${t.created}\n\n`);

    for (const msg of messages.items as Message[]) {
      process.stdout.write(`## ${msg.role}\n\n`);
      process.stdout.write(formatParts(msg.parts));
      process.stdout.write('\n\n');
    }
  },
};

function formatParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const out: string[] = [];
  for (const p of parts) {
    if (p === null || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    if (rec.type === 'text' && typeof rec.text === 'string') {
      out.push(rec.text);
    } else if (typeof rec.text === 'string') {
      out.push(rec.text);
    } else if (typeof rec.content === 'string') {
      out.push(rec.content);
    }
  }
  return out.join('\n');
}
