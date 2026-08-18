import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onPath, resolveRunnable, runMapping } from '../src/commands/map';
import { AGENTS, MAPPING_PROMPT, agentById, type AgentSetup } from '../src/agents/registry';

function fakeAgent(id: string, hasRecipe: boolean, bin = `${id}-bin`): AgentSetup {
  return {
    id,
    name: id.toUpperCase(),
    detect: () => true,
    user: () => [],
    ...(hasRecipe ? { headlessRun: { bin, args: (p: string) => ['-p', p] } } : {}),
  };
}

describe('resolveRunnable', () => {
  const yes = () => true;
  const no = () => false;

  it('runs the primary when it has a recipe on PATH', () => {
    const primary = fakeAgent('claude', true);
    const { runnable, viaSibling } = resolveRunnable(primary, [primary], yes);
    assert.equal(runnable?.agent.id, 'claude');
    assert.equal(viaSibling, false);
  });

  it('falls back to a sibling when the primary is IDE-only', () => {
    const primary = fakeAgent('windsurf', false);
    const sibling = fakeAgent('claude', true);
    const { runnable, viaSibling } = resolveRunnable(primary, [primary, sibling], yes);
    assert.equal(runnable?.agent.id, 'claude');
    assert.equal(viaSibling, true);
  });

  it('falls back to a sibling when the primary recipe binary is not installed', () => {
    const primary = fakeAgent('cursor', true, 'cursor-agent');
    const sibling = fakeAgent('codex', true, 'codex');
    const onlyCodex = (bin: string) => bin === 'codex';
    const { runnable, viaSibling } = resolveRunnable(primary, [primary, sibling], onlyCodex);
    assert.equal(runnable?.agent.id, 'codex');
    assert.equal(viaSibling, true);
  });

  it('returns nothing runnable when no installed agent has a recipe on PATH', () => {
    const primary = fakeAgent('windsurf', false);
    const { runnable } = resolveRunnable(primary, [primary, fakeAgent('zed', false)], yes);
    assert.equal(runnable, undefined);
  });

  it('does not flag viaSibling when there is no primary at all', () => {
    const only = fakeAgent('claude', true);
    const { runnable, viaSibling } = resolveRunnable(undefined, [only], yes);
    assert.equal(runnable?.agent.id, 'claude');
    assert.equal(viaSibling, false);
  });

  it('returns nothing when recipes exist but none are on PATH', () => {
    const primary = fakeAgent('claude', true);
    const { runnable } = resolveRunnable(primary, [primary], no);
    assert.equal(runnable, undefined);
  });
});

describe('headlessRun recipes', () => {
  const HEADLESS: Record<string, { bin: string; approve: string }> = {
    claude: { bin: 'claude', approve: 'bypassPermissions' },
    cursor: { bin: 'cursor-agent', approve: '--force' },
    opencode: { bin: 'opencode', approve: 'run' },
    codex: { bin: 'codex', approve: '--full-auto' },
    pi: { bin: 'pi', approve: '-p' },
    cline: { bin: 'cline', approve: '--yolo' },
    goose: { bin: 'goose', approve: '--no-session' },
    gemini: { bin: 'gemini', approve: '--yolo' },
  };
  const IDE_ONLY = ['warp', 'roo', 'windsurf', 'zed', 'vscode'];

  for (const [id, expected] of Object.entries(HEADLESS)) {
    it(`${id} has a recipe that carries the prompt and auto-approves`, () => {
      const agent = agentById(id);
      assert.ok(agent?.headlessRun, `${id} should have a headlessRun recipe`);
      assert.equal(agent!.headlessRun!.bin, expected.bin);
      const argv = agent!.headlessRun!.args(MAPPING_PROMPT);
      assert.ok(argv.includes(MAPPING_PROMPT), `${id} argv must include the mapping prompt`);
      assert.ok(argv.includes(expected.approve), `${id} argv must include ${expected.approve}`);
    });
  }

  it('goose runs non-interactively via GOOSE_MODE=auto', () => {
    assert.equal(agentById('goose')?.headlessRun?.env?.GOOSE_MODE, 'auto');
  });

  for (const id of IDE_ONLY) {
    it(`${id} has no headless recipe (IDE/extension surface)`, () => {
      assert.equal(agentById(id)?.headlessRun, undefined);
    });
  }

  it('every recipe binary differs from a bare agent id where the CLI is named differently', () => {
    // Cursor's binary is cursor-agent, not "cursor" — guard against a regression.
    assert.equal(agentById('cursor')?.headlessRun?.bin, 'cursor-agent');
  });
});

describe('runMapping', () => {
  it('reports a signal-killed agent as a failure, not a success', async () => {
    const res = await runMapping('sh', ['-c', 'kill -KILL $$'], undefined, () => {});
    // A signal death delivers code === null; it must not be mapped to 0.
    assert.equal(res.code, null);
    assert.ok(res.signal, 'expected a signal to be reported');
  });

  it('reports a non-zero exit as the exit code', async () => {
    const res = await runMapping('sh', ['-c', 'exit 3'], undefined, () => {});
    assert.equal(res.code, 3);
    assert.equal(res.signal, null);
  });

  it('captures output and reports a clean exit', async () => {
    const res = await runMapping('sh', ['-c', 'echo hello; exit 0'], undefined, () => {});
    assert.equal(res.code, 0);
    assert.ok(res.output.includes('hello'));
  });
});

describe('onPath', () => {
  it('finds an executable placed on a fake PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polylane-onpath-'));
    const bin = 'faux-agent';
    const file = join(dir, bin);
    writeFileSync(file, '#!/bin/sh\n');
    chmodSync(file, 0o755);
    const original = process.env.PATH;
    process.env.PATH = dir;
    try {
      assert.equal(onPath(bin), true);
      assert.equal(onPath('definitely-not-installed-xyz'), false);
    } finally {
      process.env.PATH = original;
    }
  });
});
