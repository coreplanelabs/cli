import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
import type { Config } from '../config/schema';
import { resolveCredential, getAuthHeader } from '../auth/resolver';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { getCliVersion } from '../version';

export interface AutofixProgressStep {
  phase: 'queued' | 'preparing' | 'reading' | 'writing' | 'reviewing' | 'pushing' | 'opened' | 'skipped' | 'error';
  message: string;
  prUrl?: string;
  prNumber?: number;
  timestamp: number;
}

export interface AutofixRow {
  id: string;
  status?: string;
  trigger?: string | null;
  owner?: string;
  repo?: string;
  title?: string | null;
  submittedPrNumber?: number | null;
  submittedPrUrl?: string | null;
  skippedReason?: string | null;
  failureReason?: string | null;
  created?: string;
}

export interface WorkspaceSocketHandlers {
  onAutofixRow?: (row: AutofixRow) => void;
  onAutofixProgress?: (autofixId: string, step: AutofixProgressStep) => void;
  onAutofixProgressSync?: (autofixId: string, steps: AutofixProgressStep[]) => void;
}

export interface WorkspaceSocket {
  subscribeAutofixProgress(autofixId: string): void;
  close(): void;
}

interface WorkspaceFrame {
  entity?: string;
  type?: string;
  data?: Record<string, unknown>;
  autofixId?: string;
  step?: AutofixProgressStep;
  steps?: AutofixProgressStep[];
}

function toAutofixRow(data: Record<string, unknown>, id: string): AutofixRow {
  const row: AutofixRow = { id };
  if (typeof data.status === 'string') row.status = data.status;
  if (typeof data.trigger === 'string') row.trigger = data.trigger;
  if (typeof data.owner === 'string') row.owner = data.owner;
  if (typeof data.repo === 'string') row.repo = data.repo;
  if (typeof data.title === 'string') row.title = data.title;
  if (typeof data.submittedPrNumber === 'number') row.submittedPrNumber = data.submittedPrNumber;
  if (typeof data.submittedPrUrl === 'string') row.submittedPrUrl = data.submittedPrUrl;
  if (typeof data.skippedReason === 'string') row.skippedReason = data.skippedReason;
  if (typeof data.failureReason === 'string') row.failureReason = data.failureReason;
  if (typeof data.created === 'string') row.created = data.created;
  return row;
}

export async function openWorkspaceSocket(config: Config, workspaceId: string, handlers: WorkspaceSocketHandlers): Promise<WorkspaceSocket> {
  const cred = await resolveCredential(config);
  const params = new URLSearchParams();
  params.set('_pk', randomUUID());
  const url = `wss://${config.domain}/v1/durable-workspace/${workspaceId}?${params.toString()}`;
  const headers: Record<string, string> = {
    ...getAuthHeader(cred),
    'x-nominal-client': 'cli',
    'x-nominal-client-version': getCliVersion(),
  };
  const ws = new WebSocket(url, { headers });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    ws.on('open', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    ws.on('unexpected-response', (_req, res) => {
      if (settled) return;
      settled = true;
      const status = res.statusCode ?? 0;
      reject(new CLIError(`WebSocket upgrade rejected (${status})`, status === 401 || status === 403 ? ExitCode.AUTH : ExitCode.NETWORK));
    });
    ws.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      reject(new CLIError(`WebSocket error: ${err.message}`, ExitCode.NETWORK));
    });
  });

  ws.on('message', (data: RawData) => {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    if (!raw) return;
    let frame: WorkspaceFrame;
    try {
      frame = JSON.parse(raw) as WorkspaceFrame;
    } catch {
      return;
    }
    if (frame.entity === 'autofix' && frame.type !== 'delete' && frame.data && typeof frame.data.id === 'string') {
      handlers.onAutofixRow?.(toAutofixRow(frame.data, frame.data.id));
      return;
    }
    if (frame.type === 'autofix_progress' && typeof frame.autofixId === 'string' && frame.step) {
      handlers.onAutofixProgress?.(frame.autofixId, frame.step);
      return;
    }
    if (frame.type === 'autofix_progress_sync' && typeof frame.autofixId === 'string' && Array.isArray(frame.steps)) {
      handlers.onAutofixProgressSync?.(frame.autofixId, frame.steps);
    }
  });

  return {
    subscribeAutofixProgress(autofixId: string): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'autofix_progress_subscribe', autofixId }));
    },
    close(): void {
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
  };
}
