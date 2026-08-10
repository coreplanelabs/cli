import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScanTarget } from '../src/commands/scan';
import type { ScanReport, ScanReportRisk } from '../src/client/scan-reports';

// Point HOME at a temp dir before importing any source module, so credential
// resolution never reads the developer's real ~/.polylane/credentials.json
// (an expiring stored token would trigger a refresh fetch inside mocked-fetch
// tests). Same pattern as signup.test.ts.
const tempHome = mkdtempSync(join(tmpdir(), 'polylane-scan-test-'));
process.env.HOME = tempHome;
after(() => rmSync(tempHome, { recursive: true, force: true }));

const {
  buildRiskNavigatorOptions,
  issueConsoleUrl,
  rankRisks,
  renderRiskLines,
  riskKey,
  runScans,
  scanProgressLabel,
  scansIndexUrl,
  seedInvestigations,
} = await import('../src/commands/scan');
const { investigateScanRisks } = await import('../src/client/scan-reports');
const { mockConfig } = await import('./helpers/config');

function risk(severity: ScanReportRisk['severity'], title: string): ScanReportRisk {
  return { title, detail: '', severity, resourceIds: [], resourceTypes: [] };
}

function report(overrides: Partial<ScanReport>): ScanReport {
  return {
    id: 'scan_report_1',
    workspaceId: 'ws_1',
    kind: 'cloud',
    provider: 'aws',
    alias: null,
    status: 'ready',
    risks: [],
    riskCount: 0,
    highRiskCount: 0,
    ...overrides,
  };
}

function target(overrides: Partial<ScanTarget> = {}): ScanTarget {
  return { kind: 'cloud', provider: 'aws', id: 'acc_1', label: 'prod', ...overrides };
}

describe('rankRisks', () => {
  it('orders high before medium before low', () => {
    const ranked = rankRisks([
      report({ risks: [risk('low', 'l1'), risk('high', 'h1'), risk('medium', 'm1')] }),
      report({ risks: [risk('high', 'h2')] }),
    ]);
    assert.deepEqual(
      ranked.map((r) => r.title),
      ['h1', 'h2', 'm1', 'l1']
    );
  });

  it('labels risks with the report alias, falling back to provider', () => {
    const ranked = rankRisks([
      report({ alias: 'prod', risks: [risk('high', 'a')] }),
      report({ alias: null, provider: 'cloudflare', risks: [risk('low', 'b')] }),
    ]);
    assert.equal(ranked[0]!.source, 'prod');
    assert.equal(ranked[1]!.source, 'cloudflare');
  });

  it('carries the risk id, report id, and report console url', () => {
    const ranked = rankRisks([
      report({
        id: 'scan_report_9',
        _html_url: 'https://console.polylane.com/acme/scans/scan_report_9',
        risks: [{ ...risk('high', 'a'), id: 'risk_1' }, risk('low', 'b')],
      }),
    ]);
    assert.equal(ranked[0]!.id, 'risk_1');
    assert.equal(ranked[0]!.reportId, 'scan_report_9');
    assert.equal(ranked[0]!.reportHtmlUrl, 'https://console.polylane.com/acme/scans/scan_report_9');
    assert.equal(ranked[1]!.id, undefined);
    assert.equal(ranked[1]!.reportId, 'scan_report_9');
  });
});

describe('issueConsoleUrl', () => {
  it('rewrites a report console url to the issue page on the same slug', () => {
    assert.equal(
      issueConsoleUrl('https://console.polylane.com/acme/scans/scan_report_abc', 'issue_1'),
      'https://console.polylane.com/acme/issues/issue_1'
    );
  });

  it('rewrites a scans index url too', () => {
    assert.equal(
      issueConsoleUrl('https://console.polylane.com/acme/scans', 'issue_1'),
      'https://console.polylane.com/acme/issues/issue_1'
    );
  });

  it('returns null without a scan console url', () => {
    assert.equal(issueConsoleUrl(null, 'issue_1'), null);
    assert.equal(issueConsoleUrl(undefined, 'issue_1'), null);
    assert.equal(issueConsoleUrl('https://console.polylane.com/acme/issues', 'issue_1'), null);
  });
});

describe('seedInvestigations', () => {
  it('maps already-investigated risks to their issue ids', () => {
    const seeded = seedInvestigations([
      report({
        id: 'scan_report_9',
        riskInvestigations: [
          { riskId: 'risk_1', threadId: 'thread_1', issueId: 'issue_1', status: 'running' },
          { riskId: 'risk_2', threadId: 'thread_2', status: 'running' },
        ],
      }),
      report({ id: 'scan_report_10' }),
    ]);
    assert.equal(seeded.size, 2);
    assert.equal(seeded.get('scan_report_9:risk_1'), 'issue_1');
    assert.equal(seeded.get('scan_report_9:risk_2'), null);
  });
});

describe('buildRiskNavigatorOptions', () => {
  const ranked = rankRisks([
    report({
      id: 'scan_report_9',
      alias: 'prod',
      risks: [
        { ...risk('high', 'Public bucket'), id: 'risk_1' },
        { ...risk('low', 'Old key'), id: 'risk_2' },
        risk('medium', 'No id, not selectable'),
      ],
    }),
  ]);

  it('only offers risks that have an id', () => {
    const options = buildRiskNavigatorOptions(ranked, new Set(), false);
    assert.deepEqual(
      options.map((o) => o.value),
      ['scan_report_9:risk_1', 'scan_report_9:risk_2']
    );
  });

  it('shows the source as the hint for uninvestigated risks', () => {
    const options = buildRiskNavigatorOptions(ranked, new Set(), false);
    assert.equal(options[0]!.label, '  HIGH    Public bucket');
    assert.equal(options[0]!.hint, 'prod');
  });

  it('marks already-investigated risks', () => {
    const options = buildRiskNavigatorOptions(ranked, new Set(['scan_report_9:risk_1']), false);
    assert.equal(options[0]!.label, '✔ HIGH    Public bucket');
    assert.equal(options[0]!.hint, 'issue created · investigating');
    assert.equal(options[1]!.label, '  LOW     Old key');
  });

  it('colors the severity tag when enabled', () => {
    const options = buildRiskNavigatorOptions(ranked, new Set(), true);
    assert.ok(options[0]!.label.includes('\x1B[1;31mHIGH  \x1B[0m'));
  });
});

describe('riskKey', () => {
  it('is stable across reports', () => {
    assert.equal(riskKey({ reportId: 'scan_report_9', id: 'risk_1' }), 'scan_report_9:risk_1');
    assert.equal(riskKey({ reportId: 'scan_report_9' }), 'scan_report_9:');
  });
});

describe('investigateScanRisks', () => {
  it('POSTs the risk ids and unwraps the investigations envelope', async () => {
    const calls: Array<{ url: string; init: { method?: string; body?: unknown } }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((url: unknown, init?: { method?: string; body?: unknown }) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: null,
            success: true,
            error: null,
            result: {
              investigations: [
                { riskId: 'risk_1', threadId: 'thread_1', issueId: 'issue_1', status: 'running' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    }) as typeof fetch;
    try {
      const result = await investigateScanRisks(mockConfig({ apiKey: 'sk_test' }), {
        workspaceId: 'ws_1',
        scanReportId: 'scan_report_1',
        riskIds: ['risk_1'],
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, 'https://api.example.test/v1/scan_reports/investigate');
      assert.equal(calls[0]!.init.method, 'POST');
      assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
        workspaceId: 'ws_1',
        scanReportId: 'scan_report_1',
        riskIds: ['risk_1'],
      });
      assert.deepEqual(result.investigations[0], {
        riskId: 'risk_1',
        threadId: 'thread_1',
        issueId: 'issue_1',
        status: 'running',
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('renderRiskLines', () => {
  it('renders one line per risk with a severity tag', () => {
    const lines = renderRiskLines(
      rankRisks([report({ alias: 'prod', risks: [risk('high', 'Public bucket'), risk('low', 'Old key')] })]),
      false
    );
    assert.equal(lines[0], 'Key risks (2)');
    assert.equal(lines[1], '  HIGH    Public bucket  · prod');
    assert.equal(lines[2], '  LOW     Old key  · prod');
    assert.equal(lines.length, 3);
  });

  it('caps output and reports the remainder', () => {
    const risks = Array.from({ length: 13 }, (_, i) => risk('medium', `r${i}`));
    const lines = renderRiskLines(rankRisks([report({ risks })]), false, 10);
    assert.equal(lines.length, 12);
    assert.equal(lines[11], '  +3 more in the console');
  });

  it('renders a single line when there are no risks', () => {
    assert.deepEqual(renderRiskLines([], true), ['No key risks found.']);
  });

  it('colors severity tags when enabled', () => {
    const lines = renderRiskLines(rankRisks([report({ risks: [risk('high', 'x')] })]), true);
    assert.ok(lines[1]!.includes('\x1B[1;31mHIGH  \x1B[0m'));
  });
});

describe('scanProgressLabel', () => {
  it('describes both target kinds and completion', () => {
    assert.equal(
      scanProgressLabel({ cloud: 3, integration: 2 }, 0, 5),
      'Scanning 3 cloud accounts and 2 integrations…'
    );
    assert.equal(
      scanProgressLabel({ cloud: 3, integration: 2 }, 1, 5),
      'Scanning 3 cloud accounts and 2 integrations… (1/5 complete)'
    );
    assert.equal(scanProgressLabel({ cloud: 1, integration: 0 }, 0, 1), 'Scanning 1 cloud account…');
  });
});

describe('scansIndexUrl', () => {
  it('strips the report id from a report console URL', () => {
    assert.equal(
      scansIndexUrl('https://console.polylane.com/acme/scans/scan_report_abc'),
      'https://console.polylane.com/acme/scans'
    );
  });
});

describe('runScans', () => {
  function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
    let t = 0;
    return {
      now: () => t,
      sleep: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
  }

  it('polls until each report leaves running', async () => {
    const clock = fakeClock();
    const polls: Record<string, number> = {};
    const results = await runScans([target({ id: 'acc_1' }), target({ id: 'acc_2', label: 'staging' })], {
      generate: (t) => Promise.resolve({ id: `scan_${t.id}`, status: 'running' }),
      get: (id) => {
        polls[id] = (polls[id] ?? 0) + 1;
        const done = polls[id]! >= (id === 'scan_acc_1' ? 2 : 4);
        return Promise.resolve(
          report({ id, status: done ? 'ready' : 'running', risks: done ? [risk('high', id)] : [] })
        );
      },
      ...clock,
      intervalMs: 1000,
      timeoutMs: 60_000,
    });
    assert.deepEqual(
      results.map((r) => r.status),
      ['ready', 'ready']
    );
    assert.equal(polls['scan_acc_1'], 2);
    assert.equal(polls['scan_acc_2'], 4);
  });

  it('marks a scan failed when generate returns no id', async () => {
    const clock = fakeClock();
    const results = await runScans([target()], {
      generate: () => Promise.resolve({ id: null, status: 'failed' }),
      get: () => Promise.reject(new Error('should not poll')),
      ...clock,
    });
    assert.equal(results[0]!.status, 'failed');
    assert.equal(results[0]!.error, 'no matching connection');
  });

  it('marks a scan failed when generate throws, without aborting others', async () => {
    const clock = fakeClock();
    const results = await runScans([target({ id: 'bad' }), target({ id: 'good' })], {
      generate: (t) =>
        t.id === 'bad'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ id: 'scan_good', status: 'running' }),
      get: () => Promise.resolve(report({ status: 'ready' })),
      ...clock,
      intervalMs: 1000,
    });
    assert.equal(results[0]!.status, 'failed');
    assert.equal(results[0]!.error, 'boom');
    assert.equal(results[1]!.status, 'ready');
  });

  it('times out gracefully when a scan never finishes', async () => {
    const clock = fakeClock();
    const results = await runScans([target()], {
      generate: () => Promise.resolve({ id: 'scan_1', status: 'running' }),
      get: () => Promise.resolve(report({ status: 'running' })),
      ...clock,
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    assert.equal(results[0]!.status, 'timeout');
    assert.ok(results[0]!.report);
  });

  it('keeps polling through transient get errors', async () => {
    const clock = fakeClock();
    let calls = 0;
    const results = await runScans([target()], {
      generate: () => Promise.resolve({ id: 'scan_1', status: 'running' }),
      get: () => {
        calls++;
        if (calls < 3) return Promise.reject(new Error('transient'));
        return Promise.resolve(report({ status: 'ready' }));
      },
      ...clock,
      intervalMs: 1000,
      timeoutMs: 60_000,
    });
    assert.equal(results[0]!.status, 'ready');
    assert.equal(calls, 3);
  });

  it('reports completion via onSettled', async () => {
    const clock = fakeClock();
    let settled = 0;
    await runScans([target({ id: 'a' }), target({ id: 'b' })], {
      generate: () => Promise.resolve({ id: null, status: 'failed' }),
      get: () => Promise.reject(new Error('unused')),
      onSettled: () => settled++,
      ...clock,
    });
    assert.equal(settled, 2);
  });
});
