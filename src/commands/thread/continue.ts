import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { Spinner } from '../../output/progress';
import { waitForAssistantReply } from '../../client/thread-poll';
import { threadConsoleUrl } from './console-url';

export const threadContinueCommand: Command = {
  name: 'thread continue',
  description: 'Send a message to an existing thread and wait for the reply',
  operationId: 'messages.post',
  positional: [
    { name: 'thread-id', description: 'The thread ID' },
    { name: 'prompt', description: 'Message to send', variadic: true },
  ],
  options: [
    { flag: '--stream', description: 'Print the reply as it is generated', type: 'boolean' },
    { flag: '--no-wait', description: 'Return immediately after sending', type: 'boolean' },
  ],
  examples: [
    'polylane thread continue thrd_xxx "and what about staging?"',
    'polylane thread continue thrd_xxx "expand on point 2" --stream',
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

    const api = new PolylaneAPI(config);
    const { thread } = await api.threadsGet(workspaceId, threadId);
    const existing = await api.messagesList(workspaceId, threadId, {
      perPage: 100,
      order: 'desc',
    });
    const ignoreIds = new Set(existing.items.map((m) => m.id));
    await api.messagesPost({ workspaceId, threadId, prompt });
    const url = await threadConsoleUrl(config, api, thread);

    if (noWait) {
      formatOutput(config, { id: thread.id, name: thread.name, url, status: 'accepted' });
      return;
    }

    const streamToStdout = stream && config.output !== 'json';
    if (!config.quiet && config.output !== 'json') {
      process.stderr.write(`Thread: ${url}\n\n`);
    }

    const useSpinner = !config.quiet && config.output !== 'json' && !streamToStdout;
    const spinner = useSpinner ? new Spinner('Waiting for the reply…') : null;
    if (spinner) spinner.start();

    let result;
    try {
      result = await waitForAssistantReply(api, workspaceId, thread.id, {
        ignoreIds,
        ...(streamToStdout
          ? { onText: (delta: string): void => { process.stdout.write(delta); } }
          : {}),
      });
    } catch (err) {
      if (spinner) spinner.fail();
      throw err;
    }
    if (spinner) spinner.stop();

    if (config.output === 'json') {
      formatOutput(config, {
        thread: { id: thread.id, name: thread.name, url },
        status: result.status === 'complete' ? 'complete' : 'pending',
        text: result.text,
        messages: result.assistantMessages,
      });
      return;
    }

    if (streamToStdout && result.text.length > 0 && !result.text.endsWith('\n')) {
      process.stdout.write('\n');
    }

    if (result.status === 'timeout') {
      if (!config.quiet) {
        process.stderr.write(`The reply is still being generated. View it at:\n  ${url}\n`);
      }
      return;
    }

    if (result.text.length === 0) {
      if (!config.quiet) {
        process.stderr.write(`The agent finished without a text reply. View the thread at:\n  ${url}\n`);
      }
      return;
    }

    if (streamToStdout) return;
    process.stdout.write(result.text);
    if (!result.text.endsWith('\n')) process.stdout.write('\n');
  },
};
