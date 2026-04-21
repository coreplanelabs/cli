import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { Spinner } from '../../output/progress';
import {
  sendThreadMessage,
  extractText as extractStreamedText,
  type UIMessage,
} from '../../client/thread-chat';
import type { Message } from '../../generated/types';

function toUIMessage(m: Message): UIMessage {
  const rawParts = Array.isArray(m.parts) ? m.parts : [];
  const parts: UIMessage['parts'] = [];
  for (const rp of rawParts) {
    if (rp === null || typeof rp !== 'object') continue;
    const rec = rp as Record<string, unknown>;
    const type = typeof rec.type === 'string' ? rec.type : undefined;
    const text = typeof rec.text === 'string' ? rec.text : undefined;
    if (type) parts.push(text !== undefined ? { type, text } : { type });
  }
  return { id: m.id, role: m.role, parts };
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

export const threadContinueCommand: Command = {
  name: 'thread continue',
  description: 'Send a message to an existing thread and wait for the reply',
  operationId: 'messages.post',
  positional: [
    { name: 'thread-id', description: 'The thread ID' },
    { name: 'prompt', description: 'Message to send', variadic: true },
  ],
  options: [
    { flag: '--stream', description: 'Stream assistant tokens as they arrive (requires OAuth)', type: 'boolean' },
    { flag: '--no-wait', description: 'Return immediately after sending', type: 'boolean' },
  ],
  examples: [
    'nominal thread continue thrd_xxx "and what about staging?"',
    'nominal thread continue thrd_xxx "expand on point 2" --stream',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const promptParts = getAllPositional(args).slice(1);
    if (promptParts.length === 0) {
      throw new CLIError('Missing <prompt>', ExitCode.USAGE);
    }
    const prompt = promptParts.join(' ');
    const stream = getArgBoolean(args, 'stream') === true;
    const noWait = getArgBoolean(args, 'noWait') === true;

    const api = new NominalAPI(config);

    if (noWait) {
      await api.messagesPost({ workspaceId, threadId, prompt, wait: false });
      formatOutput(config, { id: threadId, status: 'accepted' });
      return;
    }

    if (stream) {
      const existing = await api.messagesList(workspaceId, threadId, {
        perPage: 100,
        order: 'asc',
      });
      const history = existing.items.map((m) => toUIMessage(m as unknown as Message));

      const result = await sendThreadMessage(config, workspaceId, threadId, history, prompt, {
        onStreamChunk: (chunk: string): void => {
          process.stdout.write(chunk);
        },
      });
      const text = extractStreamedText(result.assistantMessage);
      if (config.output === 'json') {
        formatOutput(config, { thread: { id: threadId }, message: result.assistantMessage, text });
        return;
      }
      if (!text.endsWith('\n')) process.stdout.write('\n');
      return;
    }

    const useSpinner = !config.quiet && config.output !== 'json';
    const spinner = useSpinner ? new Spinner(`Waiting for assistant on ${threadId}`) : null;
    if (spinner) spinner.start();

    try {
      const response = await api.messagesPost({
        workspaceId,
        threadId,
        prompt,
        wait: true,
      });
      if (spinner) spinner.stop();

      if ('status' in response) {
        formatOutput(config, { id: threadId, status: 'accepted' });
        return;
      }

      const message = response;
      const text = extractText(message.parts);

      if (config.output === 'json') {
        formatOutput(config, { thread: { id: threadId }, message, text });
        return;
      }

      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
    } catch (err) {
      if (spinner) spinner.fail();
      throw err;
    }
  },
};
