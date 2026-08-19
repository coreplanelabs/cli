import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Command } from '../command';
import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';
import { AGENTS, AGENT_IDS, MAPPING_PROMPT, agentById, type AgentSetup, type HeadlessRun } from '../agents/registry';
import { consoleBaseUrl } from '../auth/oauth';
import { tryResolveCredential } from '../auth/resolver';
import { PolylaneAPI } from '../generated/client';
import { isInteractive } from '../utils/env';
import { promptSelect } from '../utils/prompt';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

/**
 * Best-effort deep link to the workspace's topology page. Falls back to the
 * console root when a workspace or credential can't be resolved (map is a
 * no-auth command, so this must never throw or prompt).
 */
async function workspaceTopologyUrl(config: Config): Promise<string> {
  const base = consoleBaseUrl(config);
  try {
    if (!config.workspaceId) return base;
    const credential = await tryResolveCredential(config);
    if (!credential) return base;
    const workspace = await new PolylaneAPI(config).workspacesGet(config.workspaceId);
    return workspace?.slug ? `${base}/${workspace.slug}/topology` : base;
  } catch {
    return base;
  }
}

/** Whether `bin` resolves to an executable on PATH. */
export function onPath(bin: string): boolean {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return dirs.some((dir) => exts.some((ext) => existsSync(join(dir, bin + ext))));
}

interface Runnable {
  agent: AgentSetup;
  run: HeadlessRun;
}

/**
 * Pick the agent that will actually run the map. The primary agent runs it when
 * it has a headless recipe whose binary is installed. Otherwise any other
 * installed agent with a runnable recipe is a fallback — the map only needs an
 * agent wired to the authed MCP, not the primary one — so a user whose primary
 * is IDE-only (Windsurf/Zed/Roo/VS Code) can still map through a sibling CLI.
 */
export function resolveRunnable(
  primary: AgentSetup | undefined,
  installed: AgentSetup[],
  isOnPath: (bin: string) => boolean = onPath
): { runnable?: Runnable; viaSibling: boolean } {
  if (primary?.headlessRun && isOnPath(primary.headlessRun.bin)) {
    return { runnable: { agent: primary, run: primary.headlessRun }, viaSibling: false };
  }
  const sibling = installed.find(
    (a) => a.id !== primary?.id && a.headlessRun && isOnPath(a.headlessRun.bin)
  );
  if (sibling?.headlessRun) {
    return { runnable: { agent: sibling, run: sibling.headlessRun }, viaSibling: Boolean(primary) };
  }
  return { viaSibling: false };
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Run the agent headlessly, capturing its output instead of streaming it. A
 * coding agent's raw output is markdown and mostly tool calls, so dumping it
 * into the terminal is a wall of noise; the rendered result lives in the
 * workspace. We show a heartbeat while it runs and surface the captured log
 * only if it fails. Returns the exit code and everything the agent printed.
 */
export function runMapping(
  bin: string,
  argv: string[],
  env: Record<string, string> | undefined,
  onStart: () => void
): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: { ...process.env, ...(env ?? {}) },
    });

    // Keep at most the tail of the output so a long run can't grow unbounded;
    // only the end matters when we surface it after a failure. Buffer, not
    // string: decode once at the end so a multi-byte character split across
    // chunk boundaries (or the tail cut) is sized and rendered correctly.
    const MAX_CAPTURE = 64 * 1024;
    let captured = Buffer.alloc(0);
    const capture = (chunk: Buffer): void => {
      captured = Buffer.concat([captured, chunk]);
      if (captured.length > MAX_CAPTURE) captured = captured.subarray(captured.length - MAX_CAPTURE);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    onStart();
    const started = Date.now();
    const tty = Boolean(process.stderr.isTTY);
    // On a TTY the heartbeat overwrites one line every 5s; without a TTY (CI,
    // piped, log capture) each tick is a fresh line, so tick far less often to
    // avoid flooding logs on a long run.
    const tickMs = tty ? 5000 : 30000;
    const heartbeat = setInterval(() => {
      const elapsed = formatElapsed(Date.now() - started);
      if (tty) process.stderr.write(`\r\x1b[2mMapping… ${elapsed} elapsed\x1b[0m\x1b[K`);
      else process.stderr.write(`Mapping… ${elapsed} elapsed\n`);
    }, tickMs);

    const finish = (): void => {
      clearInterval(heartbeat);
      if (tty) process.stderr.write('\r\x1b[K');
    };

    child.on('error', (err) => {
      finish();
      reject(new CLIError(`Failed to launch ${bin}: ${(err as Error).message}`, ExitCode.GENERAL));
    });
    // close delivers (code, signal): a signal-killed agent has code === null,
    // which must be treated as a failure, not mapped to 0.
    child.on('close', (code, signal) => {
      finish();
      resolve({ code, signal, output: captured.toString() });
    });
  });
}

export const mapCommand: Command = {
  name: 'map',
  description: 'Map this repository into your workspace using your coding agent',
  usage: 'polylane map [--agent <id>]',
  options: [
    {
      flag: '--agent <id>',
      description: 'Coding agent to run the map (defaults to your configured agent)',
      type: 'string',
    },
  ],
  examples: ['polylane map', 'polylane map --agent codex'],
  async execute(config: Config, _flags: GlobalFlags, args: Record<string, unknown>): Promise<void> {
    const home = homedir();
    const installed = AGENTS.filter((a) => a.detect(home));

    const requestedId = typeof args.agent === 'string' ? args.agent : undefined;
    if (requestedId && !agentById(requestedId)) {
      throw new CLIError(
        `Unknown agent: "${requestedId}"`,
        ExitCode.USAGE,
        `Supported agents: ${AGENT_IDS.join(', ')}`
      );
    }

    // Resolve the primary agent: explicit flag > configured choice > the only
    // installed agent > interactive pick among installed agents.
    let primary = requestedId
      ? agentById(requestedId)
      : config.agent
        ? agentById(config.agent)
        : undefined;
    if (!primary && installed.length === 1) {
      primary = installed[0];
    } else if (!primary && installed.length > 1 && isInteractive(config.nonInteractive)) {
      const runnable = installed.filter((a) => a.headlessRun && onPath(a.headlessRun.bin));
      const choices = runnable.length ? runnable : installed;
      const id = await promptSelect(
        { nonInteractive: config.nonInteractive },
        'Which coding agent should map this repository?',
        choices.map((a) => ({ value: a.id, label: a.name }))
      );
      primary = agentById(id);
    }

    const { runnable, viaSibling } = resolveRunnable(primary, installed);

    if (!runnable) {
      // Nothing installed can run headlessly — hand off the manual instruction.
      const name = primary?.name ?? 'your coding agent';
      process.stderr.write(`Open ${name} in this repository and ask: "${MAPPING_PROMPT}"\n`);
      return;
    }

    const { agent, run } = runnable;
    const argv = run.args(MAPPING_PROMPT);

    if (viaSibling && primary && primary.id !== agent.id) {
      process.stderr.write(
        `${primary.name} can't be launched headlessly; running the map with ${agent.name} instead.\n`
      );
    }

    if (config.dryRun) {
      process.stderr.write(`Would run: ${run.bin} ${argv.join(' ')}\n`);
      return;
    }

    const { code, signal, output } = await runMapping(run.bin, argv, run.env, () => {
      process.stderr.write(
        `Mapping this repository with ${agent.name}. Your agent reads the repo, runs checks, and\n` +
          `assembles the map locally; this usually takes a few minutes.\n`
      );
    });

    if (code !== 0) {
      // Surface the tail of the captured output so a failure isn't silent.
      const tail = output.trim().split('\n').slice(-20).join('\n');
      if (tail) process.stderr.write(`\n${tail}\n`);
      const reason = signal ? `was terminated by ${signal}` : `exited with code ${code}`;
      throw new CLIError(
        `${agent.name} ${reason} before finishing the map`,
        ExitCode.GENERAL,
        `Run it yourself: open ${agent.name} and ask "${MAPPING_PROMPT}"`
      );
    }

    const workspaceUrl = await workspaceTopologyUrl(config);
    process.stderr.write(
      `\n✓ Mapped this repository. View your topology, issues, and first-run thread:\n` +
        `  ${workspaceUrl}\n`
    );
  },
};
