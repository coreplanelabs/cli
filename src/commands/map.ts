import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Command } from '../command';
import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';
import { AGENTS, AGENT_IDS, MAPPING_PROMPT, agentById, type AgentSetup, type HeadlessRun } from '../agents/registry';
import { isInteractive } from '../utils/env';
import { promptSelect } from '../utils/prompt';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

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

function runChild(bin: string, argv: string[], env?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, ...(env ?? {}) },
    });
    child.on('error', (err) =>
      reject(new CLIError(`Failed to launch ${bin}: ${(err as Error).message}`, ExitCode.GENERAL))
    );
    child.on('close', (code) => resolve(code ?? 0));
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

    process.stderr.write(`Mapping this repository with ${agent.name}...\n`);
    const code = await runChild(run.bin, argv, run.env);
    if (code !== 0) {
      throw new CLIError(
        `${agent.name} exited with code ${code} before finishing the map`,
        ExitCode.GENERAL,
        `Run it yourself: open ${agent.name} and ask "${MAPPING_PROMPT}"`
      );
    }
  },
};
