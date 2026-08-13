import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString, getArgBoolean } from '../helpers';
import { Spinner } from '../../output/progress';
import { waitForAssistantReply } from '../../client/thread-poll';
import { threadConsoleUrl } from './console-url';

type ContextType =
  | 'repository'
  | 'cloud_account'
  | 'thread'
  | 'infrastructure_node'
  | 'memory';

function inferContextType(id: string): ContextType {
  if (id.startsWith('repo_')) return 'repository';
  if (id.startsWith('acc_')) return 'cloud_account';
  if (id.startsWith('thrd_')) return 'thread';
  if (id.startsWith('mem_')) return 'memory';
  return 'infrastructure_node';
}

export const threadAskCommand: Command = {
  name: 'thread ask',
  description: 'Start a new conversation thread and wait for the reply',
  operationId: 'threads.post',
  positional: [{ name: 'prompt', description: 'Initial message', variadic: true }],
  options: [
    { flag: '--context <ids>', description: 'Comma-separated resource IDs to attach as context', type: 'string' },
    { flag: '--name <n>', description: 'Name for the thread (default: auto-derived)', type: 'string' },
    { flag: '--visibility <v>', description: 'workspace | private | workspace_and_github_org | public (default: workspace)', type: 'string' },
    { flag: '--stream', description: 'Deprecated: streaming is the default in text mode', type: 'boolean' },
    { flag: '--no-wait', description: 'Return immediately after sending', type: 'boolean' },
  ],
  examples: [
    'polylane thread ask "explain how the auth service works"',
    'polylane thread ask "what does this service do?" --context repo_xxx,acc_yyy',
    'polylane thread ask "summarize last week" --output json',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'prompt');
    const prompt = getAllPositional(args).join(' ');

    const name = getArgString(args, 'name');
    const visibilityRaw = getArgString(args, 'visibility') ?? 'workspace';
    const contextIds = (getArgString(args, 'context') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const noWait = getArgBoolean(args, 'noWait') === true;

    const context = contextIds.map((id) => ({ id, type: inferContextType(id) }));

    type Visibility = Parameters<PolylaneAPI['threadsPost']>[0]['visibility'];

    const api = new PolylaneAPI(config);
    const thread = await api.threadsPost({
      workspaceId,
      prompt,
      visibility: visibilityRaw as Visibility,
      ...(name ? { name } : {}),
      ...(context.length > 0 ? { context } : {}),
    });
    await api.messagesPost({ workspaceId, threadId: thread.id, prompt });
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
        process.stderr.write(`The reply is still being generated. View it at:\n  ${url}\n`);
      }
      return;
    }

    if (result.text.length === 0 && !config.quiet) {
      process.stderr.write(`The agent finished without a text reply. View the thread at:\n  ${url}\n`);
    }
  },
};
