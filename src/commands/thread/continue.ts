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
    { flag: '--stream', description: 'Deprecated: streaming is the default in text mode', type: 'boolean' },
    { flag: '--no-wait', description: 'Return immediately after sending', type: 'boolean' },
  ],
  examples: [
    'polylane thread continue thrd_xxx "and what about staging?"',
    'polylane thread continue thrd_xxx "expand on point 2" --output json',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const promptParts = getAllPositional(args).slice(1);
    if (promptParts.length === 0) {
      throw new CLIError('Missing <prompt>', ExitCode.USAGE);
    }
    const prompt = promptParts.join(' ');
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

    const textMode = config.output !== 'json';
    if (!config.quiet && textMode) {
      process.stderr.write(`Thread: ${url}\n\n`);
    }

    const spinner = !config.quiet && textMode ? new Spinner('Working on the reply…') : null;
    if (spinner) spinner.start();
    let spinnerStopped = false;
    const stopSpinner = (): void => {
      if (spinner && !spinnerStopped) spinner.stop();
      spinnerStopped = true;
    };

    let result;
    try {
      result = await waitForAssistantReply(api, workspaceId, thread.id, {
        ignoreIds,
        ...(textMode
          ? { onText: (delta: string): void => { stopSpinner(); process.stdout.write(delta); } }
          : {}),
      });
    } catch (err) {
      if (spinner && !spinnerStopped) spinner.fail();
      throw err;
    }
    stopSpinner();

    if (config.output === 'json') {
      formatOutput(config, {
        thread: { id: thread.id, name: thread.name, url },
        status: result.status === 'complete' ? 'complete' : 'pending',
        text: result.text,
        messages: result.assistantMessages,
      });
      return;
    }

    if (result.text.length > 0 && !result.text.endsWith('\n')) {
      process.stdout.write('\n');
    }

    if (result.status === 'timeout') {
      if (!config.quiet) {
        process.stderr.write(`I'm still writing the reply. View it at:\n  ${url}\n`);
      }
      return;
    }

    if (result.text.length === 0 && !config.quiet) {
      process.stderr.write(`I finished without a text reply. View the thread at:\n  ${url}\n`);
    }
  },
};
