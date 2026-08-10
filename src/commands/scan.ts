import type { Command } from '../command';
import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';
import { PolylaneAPI } from '../generated/client';
import {
  generateScanReport,
  getScanReport,
  investigateScanRisks,
  type ScanReport,
  type ScanRiskInvestigation,
  type ScanRiskSeverity,
} from '../client/scan-reports';
import { authLoginCommand } from './auth/login';
import { tryResolveCredential } from '../auth/resolver';
import { consoleBaseUrl } from '../auth/oauth';
import { loadConfig } from '../config/loader';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { Spinner } from '../output/progress';
import { outputJson } from '../output/json';
import { showStatusBar } from '../output/status-bar';
import { isInteractive, shouldUseColor } from '../utils/env';
import { openBrowser } from '../utils/browser';
import {
  BACK,
  note,
  promptConfirmOrBack,
  promptSelect,
  promptSelectOrBack,
  type PromptContext,
} from '../utils/prompt';

const POLL_INTERVAL_MS = 3_000;
const SCAN_TIMEOUT_MS = 180_000;
const MAX_RISK_LINES = 10;

export interface ScanTarget {
  kind: 'cloud' | 'integration';
  provider: string;
  id: string;
  label: string;
}

export interface ScanRunResult {
  target: ScanTarget;
  status: 'ready' | 'failed' | 'timeout';
  report: ScanReport | null;
  error?: string;
}

export interface RunScanOps {
  generate: (target: ScanTarget) => Promise<{ id: string | null; status: string }>;
  get: (reportId: string) => Promise<ScanReport>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
  onSettled?: (result: ScanRunResult) => void;
}

async function runScan(target: ScanTarget, ops: Required<Pick<RunScanOps, 'generate' | 'get' | 'sleep' | 'now' | 'intervalMs'>>, deadline: number): Promise<ScanRunResult> {
  let started: { id: string | null; status: string };
  try {
    started = await ops.generate(target);
  } catch (err) {
    return {
      target,
      status: 'failed',
      report: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!started.id) {
    return { target, status: 'failed', report: null, error: 'no matching connection' };
  }
  let report: ScanReport | null = null;
  while (ops.now() < deadline) {
    await ops.sleep(Math.min(ops.intervalMs, deadline - ops.now()));
    try {
      report = await ops.get(started.id);
    } catch {
      continue;
    }
    if (report.status === 'ready') return { target, status: 'ready', report };
    if (report.status === 'failed') return { target, status: 'failed', report };
  }
  return { target, status: 'timeout', report };
}

export async function runScans(targets: ScanTarget[], ops: RunScanOps): Promise<ScanRunResult[]> {
  const sleep = ops.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const now = ops.now ?? Date.now;
  const intervalMs = ops.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = ops.timeoutMs ?? SCAN_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  return Promise.all(
    targets.map(async (target) => {
      const result = await runScan(target, { generate: ops.generate, get: ops.get, sleep, now, intervalMs }, deadline);
      ops.onSettled?.(result);
      return result;
    })
  );
}

export interface RankedRisk {
  severity: ScanRiskSeverity;
  title: string;
  source: string;
  id?: string;
  reportId: string;
  reportHtmlUrl?: string;
}

const SEVERITY_RANK: Record<ScanRiskSeverity, number> = { high: 0, medium: 1, low: 2 };

export function rankRisks(reports: ScanReport[]): RankedRisk[] {
  const ranked: RankedRisk[] = [];
  for (const report of reports) {
    for (const risk of report.risks) {
      ranked.push({
        severity: risk.severity,
        title: risk.title,
        source: report.alias || report.provider,
        ...(risk.id ? { id: risk.id } : {}),
        reportId: report.id,
        ...(report._html_url ? { reportHtmlUrl: report._html_url } : {}),
      });
    }
  }
  return ranked.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
}

function color(s: string, code: string, useColor: boolean): string {
  if (!useColor) return s;
  return `\x1B[${code}m${s}\x1B[0m`;
}

const SEVERITY_COLOR: Record<ScanRiskSeverity, string> = { high: '1;31', medium: '33', low: '36' };

export function renderRiskLines(
  ranked: RankedRisk[],
  useColor: boolean,
  limit = MAX_RISK_LINES
): string[] {
  if (ranked.length === 0) {
    return ['No key risks found.'];
  }
  const lines = [color(`Key risks (${ranked.length})`, '1', useColor)];
  for (const risk of ranked.slice(0, limit)) {
    const tag = color(risk.severity.toUpperCase().padEnd(6), SEVERITY_COLOR[risk.severity] ?? '0', useColor);
    lines.push(`  ${tag}  ${risk.title}${color(`  · ${risk.source}`, '2', useColor)}`);
  }
  if (ranked.length > limit) {
    lines.push(color(`  +${ranked.length - limit} more in the console`, '2', useColor));
  }
  return lines;
}

export function scanProgressLabel(
  counts: { cloud: number; integration: number },
  done: number,
  total: number
): string {
  const parts: string[] = [];
  if (counts.cloud > 0) {
    parts.push(`${counts.cloud} cloud account${counts.cloud === 1 ? '' : 's'}`);
  }
  if (counts.integration > 0) {
    parts.push(`${counts.integration} integration${counts.integration === 1 ? '' : 's'}`);
  }
  const suffix = done > 0 ? ` (${done}/${total} complete)` : '';
  return `Scanning ${parts.join(' and ')}…${suffix}`;
}

export function scansIndexUrl(reportHtmlUrl: string): string {
  return reportHtmlUrl.replace(/\/[^/]+$/, '');
}

// Scan console URLs look like https://console…/{slug}/scans[/{id}]; the issue
// page lives at https://console…/{slug}/issues/{issueId} on the same slug.
export function issueConsoleUrl(
  scanConsoleUrl: string | null | undefined,
  issueId: string
): string | null {
  if (!scanConsoleUrl) return null;
  const match = scanConsoleUrl.match(/^(.*)\/scans(\/[^/]*)?$/);
  if (!match) return null;
  return `${match[1]}/issues/${encodeURIComponent(issueId)}`;
}

export function riskKey(risk: Pick<RankedRisk, 'reportId' | 'id'>): string {
  return `${risk.reportId}:${risk.id ?? ''}`;
}

// Risks that already have an investigation (from an earlier run or another
// user) seed the navigator's marker state; the value is the issue id when the
// API recorded one.
export function seedInvestigations(reports: ScanReport[]): Map<string, string | null> {
  const seeded = new Map<string, string | null>();
  for (const report of reports) {
    for (const investigation of report.riskInvestigations ?? []) {
      seeded.set(riskKey({ reportId: report.id, id: investigation.riskId }), investigation.issueId ?? null);
    }
  }
  return seeded;
}

export interface RiskNavigatorOption {
  value: string;
  label: string;
  hint?: string;
}

export function buildRiskNavigatorOptions(
  ranked: RankedRisk[],
  investigated: ReadonlySet<string>,
  useColor: boolean
): RiskNavigatorOption[] {
  return ranked
    .filter((risk): risk is RankedRisk & { id: string } => Boolean(risk.id))
    .map((risk) => {
      const key = riskKey(risk);
      const done = investigated.has(key);
      const tag = color(risk.severity.toUpperCase().padEnd(6), SEVERITY_COLOR[risk.severity] ?? '0', useColor);
      return {
        value: key,
        label: `${done ? '✔ ' : '  '}${tag}  ${risk.title}`,
        hint: done ? 'issue created · investigating' : risk.source,
      };
    });
}

function resolveConsoleUrl(results: ScanRunResult[]): string | null {
  const withUrl = results.filter((r) => r.report?._html_url);
  if (withUrl.length === 0) return null;
  const ready = withUrl.filter((r) => r.status === 'ready');
  if (ready.length === 1 && withUrl.length === 1) return ready[0]!.report!._html_url!;
  return scansIndexUrl(withUrl[0]!.report!._html_url!);
}

async function ensureSignedIn(config: Config, flags: GlobalFlags): Promise<Config> {
  const credential = await tryResolveCredential(config);
  if (credential) return config;
  if (!isInteractive(config.nonInteractive) || config.output === 'json') {
    throw new CLIError(
      'Not signed in.',
      ExitCode.AUTH,
      'polylane auth login --api-key sk_xxxxx         (API key)\n' +
        '        polylane auth login                            (OAuth browser flow)\n' +
        '        POLYLANE_API_KEY=sk_xxxxx                      (environment variable)'
    );
  }
  await authLoginCommand.execute(config, flags, { _: [] });
  return loadConfig(flags);
}

async function resolveWorkspaceId(config: Config, api: PolylaneAPI): Promise<string> {
  if (config.workspaceId) return config.workspaceId;
  const list = await api.workspacesList({ perPage: 100 });
  if (list.items.length === 1) return list.items[0]!.id;
  if (list.items.length > 1 && isInteractive(config.nonInteractive)) {
    return promptSelect<string>(
      { nonInteractive: config.nonInteractive },
      'Workspace to scan',
      list.items.map((ws) => ({ value: ws.id, label: ws.name, hint: ws.id }))
    );
  }
  throw new CLIError(
    'No workspace set',
    ExitCode.USAGE,
    'polylane workspace use <id>                     (set default)\n' +
      '        --workspace <id>                              (one-shot)\n' +
      '        POLYLANE_WORKSPACE_ID=<id>                     (environment variable)\n' +
      'List workspaces with: polylane workspace list'
  );
}

async function offerToOpen(ctx: PromptContext, url: string): Promise<void> {
  const open = await promptConfirmOrBack(ctx, 'Open the issue in your browser?', false);
  if (open === true) openBrowser(url);
}

async function runRiskNavigator(
  cfg: Config,
  workspaceId: string,
  ranked: RankedRisk[],
  seeded: Map<string, string | null>,
  scanConsoleUrl: string | null
): Promise<void> {
  const ctx: PromptContext = { nonInteractive: cfg.nonInteractive };
  const useColor = shouldUseColor(cfg.noColor);
  const issueIds = new Map(seeded);

  for (;;) {
    const options = buildRiskNavigatorOptions(ranked, new Set(issueIds.keys()), useColor);
    if (options.length === 0) return;
    const choice = await promptSelectOrBack<string>(
      ctx,
      'Investigate a risk (Enter creates an issue; Polylane investigates in the background)',
      options,
      'Done'
    );
    if (choice === BACK) return;
    const risk = ranked.find((r) => r.id && riskKey(r) === choice);
    if (!risk?.id) continue;

    if (issueIds.has(choice)) {
      const knownIssueId = issueIds.get(choice) ?? null;
      const url = knownIssueId
        ? issueConsoleUrl(risk.reportHtmlUrl ?? scanConsoleUrl, knownIssueId)
        : null;
      note(
        'An issue is already open for this risk and Polylane is investigating it.' +
          (url ? `\n\nView the issue in the console:\n  ${url}` : ''),
        'Already under investigation'
      );
      if (url) await offerToOpen(ctx, url);
      continue;
    }

    const spinner = new Spinner(`Creating an issue for "${risk.title}"…`);
    spinner.start();
    let investigation: ScanRiskInvestigation | undefined;
    try {
      const res = await investigateScanRisks(cfg, {
        workspaceId,
        scanReportId: risk.reportId,
        riskIds: [risk.id],
      });
      investigation = res.investigations.find((inv) => inv.riskId === risk.id);
      spinner.stop();
    } catch (err) {
      spinner.stop();
      const message = err instanceof Error ? err.message : String(err);
      note(
        `The issue was not created (${message}).\nPick the risk again to retry, or investigate it from the console.`,
        'Nothing changed'
      );
      continue;
    }

    issueIds.set(choice, investigation?.issueId ?? null);
    const url = investigation?.issueId
      ? issueConsoleUrl(risk.reportHtmlUrl ?? scanConsoleUrl, investigation.issueId)
      : null;
    note(
      `Issue created for "${risk.title}".\n` +
        'Polylane is investigating this risk in the background and will post what it finds on the issue. You can keep working; nothing else is needed from you.' +
        (url ? `\n\nView the issue in the console:\n  ${url}` : ''),
      'Investigation started'
    );
    if (url) await offerToOpen(ctx, url);
  }
}

export const scanCommand: Command = {
  name: 'scan',
  description: 'Scan connected cloud accounts and integrations for key risks',
  operationId: 'scan_reports.generate',
  examples: ['polylane scan', 'polylane scan --workspace ws_xxx', 'polylane scan --output json'],
  async execute(config: Config, flags: GlobalFlags, _args: Record<string, unknown>): Promise<void> {
    const cfg = await ensureSignedIn(config, flags);
    const api = new PolylaneAPI(cfg);
    const workspaceId = await resolveWorkspaceId(cfg, api);
    const useSpinner = !cfg.quiet && cfg.output !== 'json';
    const useColor = shouldUseColor(cfg.noColor);
    const say = (line: string): void => {
      if (!cfg.quiet && cfg.output !== 'json') process.stderr.write(line + '\n');
    };

    showStatusBar(cfg);
    const spinner = new Spinner('Finding scan targets…');
    if (useSpinner) spinner.start();

    let targets: ScanTarget[];
    try {
      const [cloud, integrations] = await Promise.all([
        api.cloudAccountsList(workspaceId, { perPage: 100 }),
        api.integrationsList(workspaceId, { perPage: 100 }),
      ]);
      targets = [
        ...cloud.items.map(
          (a): ScanTarget => ({
            kind: 'cloud',
            provider: a.provider,
            id: a.id,
            label: a.alias || a.account || a.provider,
          })
        ),
        ...integrations.items
          .filter((i) => !i.disabled)
          .map(
            (i): ScanTarget => ({
              kind: 'integration',
              provider: i.type,
              id: i.id,
              label: i.name || i.type,
            })
          ),
      ];
    } catch (err) {
      spinner.fail();
      throw err;
    }

    if (targets.length === 0) {
      spinner.stop();
      if (cfg.output === 'json') {
        outputJson({ workspaceId, targets: 0, reports: [], risks: [], consoleUrl: null });
        return;
      }
      say('Nothing to scan — no cloud accounts or integrations are connected.');
      say('Connect one with `polylane cloud connect` or `polylane integration connect`.');
      return;
    }

    const counts = {
      cloud: targets.filter((t) => t.kind === 'cloud').length,
      integration: targets.filter((t) => t.kind === 'integration').length,
    };
    let done = 0;
    if (useSpinner) spinner.update(scanProgressLabel(counts, 0, targets.length));

    const results = await runScans(targets, {
      generate: (t) =>
        generateScanReport(cfg, { workspaceId, kind: t.kind, provider: t.provider, id: t.id }),
      get: (reportId) => getScanReport(cfg, workspaceId, reportId),
      onSettled: () => {
        done++;
        if (useSpinner) spinner.update(scanProgressLabel(counts, done, targets.length));
      },
    });
    spinner.stop();

    const ready = results.filter((r) => r.status === 'ready');
    const failed = results.filter((r) => r.status === 'failed');
    const timedOut = results.filter((r) => r.status === 'timeout');
    const ranked = rankRisks(ready.map((r) => r.report!));
    const consoleUrl = resolveConsoleUrl(results) ?? (await scansFallbackUrl(cfg, api, workspaceId));

    for (const f of failed) {
      say(color(`Scan failed for ${f.target.label}${f.error ? ` (${f.error})` : ''}`, '33', useColor));
    }
    if (timedOut.length > 0) {
      say(
        color(
          `${timedOut.length} scan${timedOut.length === 1 ? ' is' : 's are'} still running — view progress in the console.`,
          '2',
          useColor
        )
      );
    }

    if (cfg.output === 'json') {
      outputJson({
        workspaceId,
        targets: targets.length,
        reports: results.map((r) => ({
          target: r.target,
          status: r.status,
          ...(r.error ? { error: r.error } : {}),
          report: r.report,
        })),
        risks: ranked,
        consoleUrl,
      });
      return;
    }

    for (const line of renderRiskLines(ranked, useColor)) {
      process.stdout.write(line + '\n');
    }
    if (consoleUrl) {
      process.stdout.write(`\nInvestigate: ${consoleUrl}\n`);
    }

    if (!cfg.quiet && isInteractive(cfg.nonInteractive) && ranked.some((r) => r.id)) {
      process.stdout.write('\n');
      await runRiskNavigator(
        cfg,
        workspaceId,
        ranked,
        seedInvestigations(ready.map((r) => r.report!)),
        consoleUrl
      );
    }
  },
};

async function scansFallbackUrl(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string
): Promise<string | null> {
  try {
    const workspace = await api.workspacesGet(workspaceId);
    return `${consoleBaseUrl(config)}/${workspace.slug}/scans`;
  } catch {
    return null;
  }
}
