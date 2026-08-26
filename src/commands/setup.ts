import { homedir } from 'node:os';

import type { Command } from '../command';
import type { Config } from '../config/schema';
import { tryResolveCredential } from '../auth/resolver';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { getArgArray, getArgBoolean, getArgString } from './helpers';
import { formatOutput } from '../output/formatter';
import {
  AGENTS,
  AGENT_ID_NAMESPACES,
  detectedAgents,
  detectedAgentIds,
  type AgentIdNamespace,
  type WriteAction,
  type WriteOutcome,
} from '../agents/registry';

const ACTION_LABEL: Record<WriteAction, string> = {
  created: 'installed',
  updated: 'updated',
  unchanged: 'already up to date',
  skipped: 'skipped',
};

export const setupCommand: Command = {
  name: 'setup',
  description: 'Wire the CLI into coding agents (agent skill + MCP server)',
  options: [
    {
      flag: '--agent <id>',
      description: `Configure only this agent, even when not detected; repeatable (${AGENTS.map((a) => a.id).join(', ')})`,
      type: 'array',
    },
    {
      flag: '--project',
      description: 'Install into the current project (e.g. ./.claude, ./.cursor) instead of the home directory',
      type: 'boolean',
    },
    {
      flag: '--list-detected',
      description: 'Print the ids of the coding agents detected on this machine (one per line) and exit without writing anything',
      type: 'boolean',
    },
    {
      flag: '--ids <namespace>',
      description: `With --list-detected: which ids to print (${AGENT_ID_NAMESPACES.join(', ')}; default polylane). skills-sh prints what \`npx skills add -a\` expects and omits agents skills.sh does not know`,
      type: 'string',
    },
  ],
  examples: [
    'polylane setup',
    'polylane setup --agent claude --agent cursor',
    'polylane setup --project',
    'polylane setup --dry-run',
    'polylane setup --list-detected',
    'polylane setup --list-detected --ids skills-sh',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const project = getArgBoolean(args, 'project') === true;
    const requested = getArgArray(args, 'agent');
    const home = homedir();

    // The installer asks this instead of keeping its own agent table: detection
    // and the skills.sh id map live here; the shell script only forwards the
    // answer to `npx skills add -a`.
    if (getArgBoolean(args, 'listDetected') === true) {
      const namespace = getArgString(args, 'ids') ?? 'polylane';
      if (!AGENT_ID_NAMESPACES.includes(namespace as AgentIdNamespace)) {
        throw new CLIError(
          `Unknown id namespace: "${namespace}"`,
          ExitCode.USAGE,
          `Use --ids ${AGENT_ID_NAMESPACES.join(' or --ids ')}`
        );
      }
      const ids = detectedAgentIds(home, namespace as AgentIdNamespace);
      if (config.output === 'json') {
        formatOutput(config, ids);
      } else {
        for (const id of ids) process.stdout.write(id + '\n');
      }
      return;
    }

    if (requested) {
      const known = new Set(AGENTS.map((a) => a.id));
      for (const id of requested) {
        if (!known.has(id)) {
          throw new CLIError(
            `Unknown agent: "${id}"`,
            ExitCode.USAGE,
            `Supported agents: ${AGENTS.map((a) => a.id).join(', ')}`
          );
        }
      }
    }

    const say = (line: string): void => {
      if (!config.quiet) process.stderr.write(line + '\n');
    };

    const selected = requested
      ? AGENTS.filter((a) => requested.includes(a.id))
      : detectedAgents(home);

    if (selected.length === 0) {
      say('No coding agents detected.');
      say(`Configure one anyway with --agent <id> (${AGENTS.map((a) => a.id).join(', ')}).`);
      return;
    }

    const verb = config.dryRun ? 'Would configure' : 'Configuring';
    say(`${verb} ${selected.length} coding agent${selected.length === 1 ? '' : 's'}: ${selected.map((a) => a.name).join(', ')}`);

    for (const agent of selected) {
      let outcomes: WriteOutcome[];
      if (project) {
        if (!agent.project) {
          say(`${agent.id}: skipped, no project-level convention; run without --project`);
          continue;
        }
        outcomes = agent.project(process.cwd(), config.dryRun);
      } else {
        outcomes = agent.user(home, config.dryRun);
      }

      for (const outcome of outcomes) {
        const changed = outcome.action === 'created' || outcome.action === 'updated';
        const base =
          outcome.label === 'MCP server' && changed ? 'registered' : ACTION_LABEL[outcome.action];
        const state = config.dryRun && changed ? `would be ${base}` : base;
        const detail = outcome.detail ? ` (${outcome.detail})` : '';
        say(`${agent.id}: ${outcome.label} ${state}: ${outcome.path}${detail}`);
        if (outcome.needsManualStep) {
          say(`${agent.id}: register it manually: https://docs.polylane.com/coding-agents/platform-mcp`);
        }
      }
    }

    const credential = await tryResolveCredential(config);
    if (credential) {
      say('Signed in.');
    } else {
      say('Not signed in. Run `polylane auth login`.');
    }
  },
};
