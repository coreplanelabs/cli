import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString, getArgBoolean } from '../helpers';
import { Spinner } from '../../output/progress';
import { sendThreadMessage, extractText as extractStreamedText } from '../../client/thread-chat';

type ContextType =
  | 'repository'
  | 'cloud_account'
  | 'thread'
  | 'infrastructure_node'
  | 'wiki_document'
  | 'memory'
  | 'case';

function inferContextType(id: string): ContextType {
  if (id.startsWith('repo_')) return 'repository';
  if (id.startsWith('acc_')) return 'cloud_account';
  if (id.startsWith('thrd_')) return 'thread';
  if (id.startsWith('wiki_doc_')) return 'wiki_document';
  if (id.startsWith('mem_')) return 'memory';
  if (id.startsWith('case_')) return 'case';
  return 'infrastructure_node';
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const out: string[] = [];
  for (const p of parts) {
    if (p === null || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    if (rec.type === 'text' && typeof rec.text === 'string') {
      out.push(rec.text);
    }
  }
  return out.join('\n\n');
}

export const threadAskCommand: Command = {
  name: 'thread ask',
  description: 'Start a new conversation thread and wait for the reply',
  operationId: 'threads.post',
  positional: [{ name: 'prompt', description: 'Initial message', variadic: true }],
  options: [
    { flag: '--context <ids>', description: 'Comma-separated resource IDs to attach as context', type: 'string' },
    { flag: '--name <n>', description: 'Name for the thread (default: auto-derived)', type: 'string' },
    { flag: '--visibility <v>', description: 'workspace | private (default: workspace)', type: 'string' },
    { flag: '--stream', description: 'Stream assistant tokens as they arrive (requires OAuth)', type: 'boolean' },
    { flag: '--no-wait', description: 'Return immediately after sending', type: 'boolean' },
  ],
  examples: [
    'nominal thread ask "explain how the auth service works"',
    'nominal thread ask "what does this service do?" --context repo_xxx,wiki_doc_yyy',
    'nominal thread ask "summarize last week" --stream',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'prompt');
    const prompt = getAllPositional(args).join(' ');

    const name = getArgString(args, 'name');
    const visibilityRaw = getArgString(args, 'visibility') ?? 'workspace';
    const contextIds = (getArgString(args, 'context') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const noWait = getArgBoolean(args, 'noWait') === true;
    const stream = getArgBoolean(args, 'stream') === true;

    const context = contextIds.map((id) => ({ id, type: inferContextType(id) }));

    type Visibility = Parameters<NominalAPI['threadsPost']>[0]['visibility'];

    const api = new NominalAPI(config);
    const thread = await api.threadsPost({
      workspaceId,
      prompt,
      visibility: visibilityRaw as Visibility,
      ...(name ? { name } : {}),
      ...(context.length > 0 ? { context } : {}),
    });

    if (noWait) {
      await api.messagesPost({ workspaceId, threadId: thread.id, prompt, wait: false });
      formatOutput(config, { id: thread.id, name: thread.name, status: 'accepted' });
      return;
    }

    if (stream) {
      if (!config.quiet && config.output !== 'json') {
        process.stderr.write(`Thread: ${thread.id}\n\n`);
      }
      const result = await sendThreadMessage(config, workspaceId, thread.id, [], prompt, {
        onStreamChunk: (chunk: string): void => {
          process.stdout.write(chunk);
        },
      });
      const text = extractStreamedText(result.assistantMessage);
      if (config.output === 'json') {
        formatOutput(config, { thread: { id: thread.id, name: thread.name }, message: result.assistantMessage, text });
        return;
      }
      if (!text.endsWith('\n')) process.stdout.write('\n');
      return;
    }

    const useSpinner = !config.quiet && config.output !== 'json';
    const spinner = useSpinner ? new Spinner(`Waiting for assistant on ${thread.id}`) : null;
    if (spinner) spinner.start();

    try {
      const response = await api.messagesPost({
        workspaceId,
        threadId: thread.id,
        prompt,
        wait: true,
      });
      if (spinner) spinner.stop();

      if ('status' in response) {
        formatOutput(config, { id: thread.id, name: thread.name, status: 'accepted' });
        return;
      }

      const message = response;
      const text = extractText(message.parts);

      if (config.output === 'json') {
        formatOutput(config, { thread: { id: thread.id, name: thread.name }, message, text });
        return;
      }

      if (!config.quiet) {
        process.stderr.write(`Thread: ${thread.id}\n\n`);
      }
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
    } catch (err) {
      if (spinner) spinner.fail();
      throw err;
    }
  },
};
