import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
import type { Config } from '../config/schema';
import { resolveCredential, getAuthHeader } from '../auth/resolver';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

export interface UIMessagePart {
  type: string;
  text?: string;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts?: UIMessagePart[];
}

export interface SendThreadMessageOptions {
  onStreamChunk?: (chunk: string) => void;
}

export interface SendThreadMessageResult {
  assistantMessage: UIMessage;
}

interface CfChatResponseFrame {
  type: 'cf_agent_use_chat_response';
  id: string;
  body: string;
  done: boolean;
}

interface CfChatMessagesFrame {
  type: 'cf_agent_chat_messages';
  messages: UIMessage[];
}

interface CfStreamingStatusFrame {
  type: 'cf_agent_streaming_status';
  isStreaming: boolean;
}

type IncomingFrame = CfChatResponseFrame | CfChatMessagesFrame | CfStreamingStatusFrame | { type: string };

interface SsePart {
  type: string;
  id?: string;
  delta?: string;
  text?: string;
}

export function extractText(message: UIMessage): string {
  if (!message.parts) return '';
  const out: string[] = [];
  for (const p of message.parts) {
    if (p.type === 'text' && typeof p.text === 'string') {
      out.push(p.text);
    }
  }
  return out.join('');
}

function parseSseChunks(raw: string): SsePart[] {
  const out: SsePart[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as SsePart;
      out.push(parsed);
    } catch {
      // ignore unparseable
    }
  }
  return out;
}

async function buildConnection(
  config: Config,
  workspaceId: string,
  threadId: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const cred = await resolveCredential(config);
  const room = `${workspaceId}.${threadId}`;
  const params = new URLSearchParams();
  params.set('_pk', randomUUID());
  const url = `wss://${config.domain}/v1/durable-thread/${room}?${params.toString()}`;
  const headers: Record<string, string> = {
    ...getAuthHeader(cred),
    'x-nominal-client': 'cli',
    'x-nominal-client-version': process.env.NOMINAL_CLI_VERSION ?? '0.0.0',
  };
  return { url, headers };
}

export async function sendThreadMessage(
  config: Config,
  workspaceId: string,
  threadId: string,
  history: UIMessage[],
  prompt: string,
  options: SendThreadMessageOptions = {}
): Promise<SendThreadMessageResult> {
  const { url, headers } = await buildConnection(config, workspaceId, threadId);
  const ws = new WebSocket(url, { headers });

  const userMessage: UIMessage = {
    id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    role: 'user',
    parts: [{ type: 'text', text: prompt }],
  };

  return new Promise<SendThreadMessageResult>((resolve, reject) => {
    let resolved = false;
    const blocks = new Map<string, string>();
    const blockOrder: string[] = [];
    let lastEmittedBlock: string | null = null;

    const resolveOnce = (result: SendThreadMessageResult): void => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const rejectOnce = (err: unknown): void => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const handleSseParts = (parts: SsePart[]): void => {
      for (const part of parts) {
        if (part.type === 'text-start' && typeof part.id === 'string') {
          if (!blocks.has(part.id)) {
            blocks.set(part.id, '');
            blockOrder.push(part.id);
          }
        } else if (part.type === 'text-delta' && typeof part.id === 'string' && typeof part.delta === 'string') {
          const current = blocks.get(part.id) ?? '';
          blocks.set(part.id, current + part.delta);
          if (!blockOrder.includes(part.id)) blockOrder.push(part.id);
          if (options.onStreamChunk) {
            if (lastEmittedBlock !== null && lastEmittedBlock !== part.id) {
              options.onStreamChunk('\n\n');
            }
            options.onStreamChunk(part.delta);
            lastEmittedBlock = part.id;
          }
        }
      }
    };

    const finalize = (): void => {
      const parts: UIMessagePart[] = [];
      for (const id of blockOrder) {
        parts.push({ type: 'text', text: blocks.get(id) ?? '' });
      }
      const assistantMessage: UIMessage = {
        id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        role: 'assistant',
        parts,
      };
      resolveOnce({ assistantMessage });
    };

    ws.on('open', () => {
      const messages = [...history, userMessage];
      const requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      ws.send(
        JSON.stringify({
          type: 'cf_agent_use_chat_request',
          id: requestId,
          init: {
            method: 'POST',
            body: JSON.stringify({ messages }),
          },
        })
      );
    });

    ws.on('message', (data: RawData) => {
      const raw = typeof data === 'string' ? data : data.toString('utf-8');
      if (!raw) return;
      let frame: IncomingFrame;
      try {
        frame = JSON.parse(raw) as IncomingFrame;
      } catch {
        return;
      }
      if (frame.type === 'cf_agent_use_chat_response') {
        const f = frame as CfChatResponseFrame;
        if (f.body) handleSseParts(parseSseChunks(f.body));
        if (f.done) finalize();
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8').slice(0, 500);
        rejectOnce(
          new CLIError(
            `WebSocket upgrade rejected (${status})${body ? `: ${body}` : ''}`,
            status === 401 || status === 403 ? ExitCode.AUTH : ExitCode.NETWORK
          )
        );
      });
    });

    ws.on('error', (err: Error) => {
      rejectOnce(new CLIError(`WebSocket error: ${err.message}`, ExitCode.NETWORK));
    });

    ws.on('close', () => {
      if (!resolved) {
        if (blockOrder.length > 0) {
          finalize();
        } else {
          rejectOnce(new CLIError('WebSocket closed before reply', ExitCode.NETWORK));
        }
      }
    });
  });
}
