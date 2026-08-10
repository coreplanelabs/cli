import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankRisks,
  renderRiskLines,
  runScans,
  scanProgressLabel,
  scansIndexUrl,
  type ScanTarget,
} from '../src/commands/scan';
import type { ScanReport, ScanReportRisk } from '../src/client/scan-reports';

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
