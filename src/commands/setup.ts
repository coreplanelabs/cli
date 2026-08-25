import { homedir } from 'node:os';

import type { Command } from '../command';
import type { Config } from '../config/schema';
import { tryResolveCredential } from '../auth/resolver';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { isInteractive } from '../utils/env';
import { promptSelect } from '../utils/prompt';
import { writeConfigFile } from '../config/loader';
import { getArgArray, getArgBoolean, getArgString } from './helpers';
import { formatOutput } from '../output/formatter';
import {
  AGENTS,
  AGENT_ID_NAMESPACES,
  detectedAgents,
  detectedAgentIds,
  type AgentIdNamespace,
  type AgentSetup,
  type WriteAction,
  type WriteOutcome,
} from '../agents/registry';

// The registry (agent table + config writers) lives in src/agents/registry.ts
// so the config loader can validate the stored agent id without importing a
// command module; re-exported here because this was its original home.
export {
  AGENTS,
  MCP_SERVER_NAME,
  MCP_SERVER_URL,
  SKILL_DIRECTORY_NAME,
  writeSkillFile,
  upsertJsonEntry,
  upsertJsoncEntry,
  opencodeConfigFile,
  upsertTomlSection,
  upsertGooseExtension,
  vscodeUserDirectory,
  hasAgentFootprint,
  detectedAgents,
  detectedAgentIds,
  SKILLS_SH_IDS,
  type AgentSetup,
  type WriteAction,
  type WriteOutcome,
} from '../agents/registry';

const ACTION_LABEL: Record<WriteAction, string> = {
  created: 'installed',
  updated: 'updated',
  unchanged: 'already up to date',
  skipped: 'skipped',
};

export type PrimaryAgentDecision =
  | { kind: 'keep' }
  | { kind: 'persist'; id: string }
  | { kind: 'prompt'; candidates: AgentSetup[] };

// The primary agent is the one downstream handoffs address ("open <agent> and
// ask ..."); wiring is unaffected — every selected agent gets configured.
export function decidePrimaryAgent(
  stored: string | undefined,
  selected: AgentSetup[],
  interactive: boolean
): PrimaryAgentDecision {
  if (stored !== undefined) return { kind: 'keep' };
  if (selected.length === 0) return { kind: 'keep' };
  if (selected.length === 1) return { kind: 'persist', id: selected[0]!.id };
  if (interactive) return { kind: 'prompt', candidates: selected };
  return { kind: 'keep' };
}

async function settlePrimaryAgent(
  config: Config,
  selected: AgentSetup[],
  say: (line: string) => void
): Promise<void> {
  if (config.dryRun) return;
  const decision = decidePrimaryAgent(config.agent, selected, isInteractive(config.nonInteractive));
  if (decision.kind === 'keep') return;

  let id: string;
  if (decision.kind === 'persist') {
    id = decision.id;
  } else {
    id = await promptSelect(
      { nonInteractive: config.nonInteractive },
      'Which coding agent do you mainly use?',
      decision.candidates.map((a) => ({ value: a.id, label: a.name })),
    );
  }
  writeConfigFile({ agent: id });
  const name = selected.find((a) => a.id === id)?.name ?? id;
  say(`Primary coding agent: ${name} (change with \`polylane config set --key agent --value <id>\`)`);
}

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

    await settlePrimaryAgent(config, selected, say);

    const credential = await tryResolveCredential(config);
    if (credential) {
      say('Signed in.');
    } else {
      say('Not signed in. Run `polylane auth login`.');
    }
  },
};
