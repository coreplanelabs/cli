import type { Message } from '../generated/types';

const POLL_INTERVAL_MS = 2_000;
const WAIT_TIMEOUT_MS = 10 * 60_000;
// The thread's running flag briefly drops between agent iterations; require a
// few consecutive idle polls before treating a reply without text as final.
const IDLE_POLLS_WITHOUT_TEXT = 3;

export interface ThreadPollApi {
  threadsGet(
    workspaceId: string,
    id: string
  ): Promise<{ thread: { runningSince: string | null; awaitingAgentsSince: string | null } }>;
  messagesList(
    workspaceId: string,
    threadId: string,
    query?: { orderBy?: 'id' | 'role' | 'createdAt'; perPage?: number; order?: 'asc' | 'desc' }
  ): Promise<{ items: Message[] }>;
}

export interface WaitForReplyOptions {
  intervalMs?: number;
  timeoutMs?: number;
  ignoreIds?: ReadonlySet<string>;
  onText?: (delta: string) => void;
}

export interface WaitForReplyResult {
  status: 'complete' | 'timeout';
  assistantMessages: Message[];
  text: string;
}

export function extractMessageText(message: Message): string {
  if (!Array.isArray(message.parts)) return '';
  const out: string[] = [];
  for (const part of message.parts) {
    if (part === null || typeof part !== 'object') continue;
    const rec = part as Record<string, unknown>;
    if (rec.type === 'text' && typeof rec.text === 'string') out.push(rec.text);
  }
  return out.join('\n\n');
}

function combinedAssistantText(messages: Message[]): string {
  return messages
    .filter((m) => m.role === 'assistant')
    .map(extractMessageText)
    .filter((t) => t.length > 0)
    .join('\n\n');
}

export async function waitForAssistantReply(
  api: ThreadPollApi,
  workspaceId: string,
  threadId: string,
  options: WaitForReplyOptions = {}
): Promise<WaitForReplyResult> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? WAIT_TIMEOUT_MS);
  const ignoreIds = options.ignoreIds;
  let sawRunning = false;
  let idlePollsWithoutText = 0;
  let emitted = '';
  let lastMessages: Message[] = [];

  const emit = (text: string): void => {
    if (!options.onText || text === emitted || text.length === 0) return;
    if (text.startsWith(emitted)) {
      options.onText(text.slice(emitted.length));
    } else {
      options.onText((emitted.length > 0 ? '\n\n' : '') + text);
    }
    emitted = text;
  };

  const result = (status: 'complete' | 'timeout'): WaitForReplyResult => ({
    status,
    assistantMessages: lastMessages.filter((m) => m.role === 'assistant'),
    text: combinedAssistantText(lastMessages),
  });

  for (;;) {
    let idle = false;
    try {
      const { thread } = await api.threadsGet(workspaceId, threadId);
      const busy = thread.runningSince !== null || thread.awaitingAgentsSince !== null;
      if (busy) sawRunning = true;
      idle = !busy;
    } catch {
      // transient failure — keep polling
    }
    if (!idle) idlePollsWithoutText = 0;

    if (idle || options.onText) {
      try {
        const { items } = await api.messagesList(workspaceId, threadId, {
          perPage: 100,
          order: 'desc',
          orderBy: 'createdAt',
        });
        const chronological = [...items].reverse();
        lastMessages = ignoreIds
          ? chronological.filter((m) => !ignoreIds.has(m.id))
          : chronological;
      } catch {
        // transient failure — keep polling
      }
      const text = combinedAssistantText(lastMessages);
      if (options.onText) emit(text);
      if (idle) {
        if (text.length > 0) return result('complete');
        if (sawRunning && ++idlePollsWithoutText >= IDLE_POLLS_WITHOUT_TEXT) {
          return result('complete');
        }
      }
    }

    if (Date.now() + intervalMs > deadline) {
      return result('timeout');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
