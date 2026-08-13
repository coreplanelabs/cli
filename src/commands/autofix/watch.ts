import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import type * as T from '../../generated/types';
import { openWorkspaceSocket, type AutofixRow, type WorkspaceSocket } from '../../client/workspace-socket';
import { Spinner } from '../../output/progress';
import { note } from '../../utils/prompt';
import { requireWorkspace, getArgString, getArgNumber } from '../helpers';

const DEFAULT_TIMEOUT_SECONDS = 45 * 60;
const CONNECT_TRIGGERS = new Set(['repo_onboarding', 'repo_connect']);
const OPEN_STATUSES = new Set(['pr_opened', 'merged']);
const HELD_OFF_STATUSES = new Set(['no_fix_needed', 'failed', 'closed', 'quota_exhausted', 'already_in_flight']);

function isTerminal(row: AutofixRow): boolean {
  return OPEN_STATUSES.has(row.status ?? '') || HELD_OFF_STATUSES.has(row.status ?? '') || !!row.submittedPrUrl;
}

function fromApi(item: T.Autofix): AutofixRow {
  return {
    id: item.id,
    status: item.status,
    trigger: item.trigger,
    owner: item.owner,
    repo: item.repo,
    title: item.title,
    submittedPrNumber: item.submittedPrNumber,
    submittedPrUrl: item.submittedPrUrl,
    skippedReason: item.skippedReason,
    failureReason: item.failureReason,
    created: item.created ?? undefined,
  };
}

function repoLabel(row: AutofixRow): string {
  return row.owner && row.repo ? `${row.owner}/${row.repo}` : (row.repo ?? '');
}

function printOutcome(row: AutofixRow): void {
  const label = row.title || 'Autofix';
  if (row.submittedPrUrl) {
    process.stdout.write(`\n${label} (${repoLabel(row)})\n  Pull request: ${row.submittedPrUrl}\n`);
    return;
  }
  const reason = row.skippedReason || row.failureReason;
  if (reason) {
    process.stdout.write(`\n${label} (${repoLabel(row)})\n  I held off: ${reason}\n`);
    return;
  }
  process.stdout.write(`\n${label} (${repoLabel(row)}): ${row.status ?? 'unknown'}\n`);
}

export const autofixWatchCommand: Command = {
  name: 'autofix watch',
  description: "Watch the pull requests I'm opening, live",
  options: [
    { flag: '--id <autofix-id>', description: 'Watch one autofix instead of the connect-time pair', type: 'string' },
    { flag: '--timeout <seconds>', description: `Stop waiting after this many seconds (default ${DEFAULT_TIMEOUT_SECONDS})`, type: 'number' },
  ],
  examples: ['polylane autofix watch', 'polylane autofix watch --id autofix_abc123', 'polylane autofix watch --timeout 600'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const timeoutSeconds = getArgNumber(args, 'timeout') ?? DEFAULT_TIMEOUT_SECONDS;
    const onlyId = getArgString(args, 'id');

    const api = new PolylaneAPI(config);
    const listed = await api.autofixesList(workspaceId, { perPage: 30 });
    const rows = (listed.items ?? []).map(fromApi);

    const watched = new Map<string, AutofixRow>();
    if (onlyId) {
      const row = rows.find((r) => r.id === onlyId);
      if (row) watched.set(row.id, row);
      else watched.set(onlyId, { id: onlyId });
    } else {
      const onboarding = rows.find((r) => r.trigger === 'repo_onboarding');
      const improvement = rows.find((r) => r.trigger === 'repo_connect');
      if (onboarding) watched.set(onboarding.id, onboarding);
      if (improvement) watched.set(improvement.id, improvement);
    }

    if (watched.size === 0) {
      note("No pull request activity to watch yet. Connect a GitHub repository and I'll open a first pull request within minutes.");
      return;
    }

    const printed = new Set<string>();
    const settle = (row: AutofixRow) => {
      if (printed.has(row.id)) return;
      printed.add(row.id);
      printOutcome(row);
    };

    for (const row of watched.values()) {
      if (isTerminal(row)) settle(row);
    }
    if ([...watched.values()].every((row) => isTerminal(row))) return;

    const spinner = new Spinner('Working on the pull requests…');
    const socketRef: { current: WorkspaceSocket | null } = { current: null };

    const finished = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const timer = setTimeout(() => {
        spinner.stop();
        note("I'm still working. I'll email you when the pull request opens, and it will be in your console.");
        finish();
      }, timeoutSeconds * 1000);
      timer.unref?.();

      const maybeFinish = () => {
        if ([...watched.values()].every((row) => isTerminal(row))) {
          clearTimeout(timer);
          spinner.stop();
          finish();
        }
      };

      const onSigint = () => {
        clearTimeout(timer);
        spinner.stop();
        note('Stopped watching. I keep working; check your console or GitHub for the pull requests.');
        finish();
      };
      process.once('SIGINT', onSigint);

      openWorkspaceSocket(config, workspaceId, {
        onAutofixRow: (row) => {
          const known = watched.get(row.id);
          if (!known) {
            if (onlyId || !CONNECT_TRIGGERS.has(row.trigger ?? '')) return;
            watched.set(row.id, row);
            socketRef.current?.subscribeAutofixProgress(row.id);
          } else {
            watched.set(row.id, { ...known, ...row });
          }
          const current = watched.get(row.id);
          if (current && isTerminal(current)) settle(current);
          maybeFinish();
        },
        onAutofixProgress: (autofixId, step) => {
          if (!watched.has(autofixId)) return;
          spinner.update(step.message);
          if (step.phase === 'opened' && step.prUrl) {
            const row = watched.get(autofixId);
            if (row) {
              const updated: AutofixRow = { ...row, status: 'pr_opened', submittedPrUrl: step.prUrl, submittedPrNumber: step.prNumber ?? null };
              watched.set(autofixId, updated);
              settle(updated);
            }
          }
          maybeFinish();
        },
        onAutofixProgressSync: (autofixId, steps) => {
          const latest = steps.at(-1);
          if (latest && watched.has(autofixId)) spinner.update(latest.message);
        },
      })
        .then((ws) => {
          socketRef.current = ws;
          spinner.start();
          for (const row of watched.values()) {
            if (!isTerminal(row)) ws.subscribeAutofixProgress(row.id);
          }
        })
        .catch(() => {
          clearTimeout(timer);
          spinner.stop();
          note("Live updates are unavailable right now. I'll email you when the pull request opens.");
          finish();
        });
    });

    await finished;
    socketRef.current?.close();
  },
};
