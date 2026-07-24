import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import type { Command } from '../command';
import type { Config } from '../config/schema';
import { tryResolveCredential } from '../auth/resolver';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { ensureDir } from '../utils/fs';
import { getArgArray, getArgBoolean } from './helpers';
import { SKILL_MD } from '../generated/skill';

export const MCP_SERVER_NAME = 'polylane';
export const MCP_SERVER_URL = process.env.POLYLANE_MCP_URL || 'https://mcp.polylane.com/mcp';
export const SKILL_DIRECTORY_NAME = 'polylane-cli';

export type WriteAction = 'created' | 'updated' | 'unchanged' | 'skipped';

export interface WriteOutcome {
  label: string;
  path: string;
  action: WriteAction;
  detail?: string;
  needsManualStep?: boolean;
}

export function writeSkillFile(path: string, dryRun = false): WriteOutcome {
  const label = 'agent skill';
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf-8');
    if (current === SKILL_MD) {
      return { label, path, action: 'unchanged' };
    }
    if (!dryRun) writeFileSync(path, SKILL_MD, 'utf-8');
    return { label, path, action: 'updated' };
  }
  if (!dryRun) {
    ensureDir(dirname(path));
    writeFileSync(path, SKILL_MD, 'utf-8');
  }
  return { label, path, action: 'created' };
}

export function upsertJsonEntry(
  path: string,
  keyPath: string[],
  value: unknown,
  dryRun = false
): WriteOutcome {
  const label = 'MCP server';
  const existed = existsSync(path);
  let root: Record<string, unknown> = {};
  if (existed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return { label, path, action: 'skipped', detail: 'existing file is not valid JSON', needsManualStep: true };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { label, path, action: 'skipped', detail: 'existing file is not a JSON object', needsManualStep: true };
    }
    root = parsed as Record<string, unknown>;
  }

  let node = root;
  for (const key of keyPath.slice(0, -1)) {
    const child = node[key];
    if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      node = child as Record<string, unknown>;
    } else if (child === undefined) {
      const fresh: Record<string, unknown> = {};
      node[key] = fresh;
      node = fresh;
    } else {
      return { label, path, action: 'skipped', detail: `"${key}" is not a JSON object`, needsManualStep: true };
    }
  }

  const leaf = keyPath[keyPath.length - 1]!;
  if (node[leaf] !== undefined) {
    return { label, path, action: 'unchanged' };
  }

  node[leaf] = value;
  if (!dryRun) {
    ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify(root, null, 2) + '\n', 'utf-8');
  }
  return { label, path, action: existed ? 'updated' : 'created' };
}

export function upsertTomlSection(
  path: string,
  sectionHeader: string,
  sectionBody: string,
  dryRun = false
): WriteOutcome {
  const label = 'MCP server';
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf-8');
    if (current.includes(sectionHeader)) {
      return { label, path, action: 'unchanged' };
    }
    if (!dryRun) {
      const separator = current.endsWith('\n') || current === '' ? '' : '\n';
      writeFileSync(path, `${current}${separator}\n${sectionHeader}\n${sectionBody}`, 'utf-8');
    }
    return { label, path, action: 'updated' };
  }
  if (!dryRun) {
    ensureDir(dirname(path));
    writeFileSync(path, `${sectionHeader}\n${sectionBody}`, 'utf-8');
  }
  return { label, path, action: 'created' };
}

export function vscodeUserDirectory(home: string): string {
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Code', 'User');
  }
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(roaming, 'Code', 'User');
  }
  return join(home, '.config', 'Code', 'User');
}

const HTTP_SERVER_ENTRY = { type: 'http', url: MCP_SERVER_URL };
const CODEX_SECTION_HEADER = `[mcp_servers.${MCP_SERVER_NAME}]`;
const CODEX_SECTION_BODY = `url = "${MCP_SERVER_URL}"\n`;

export interface AgentSetup {
  id: string;
  name: string;
  detect(home: string): boolean;
  user(home: string, dryRun: boolean): WriteOutcome[];
  project?(projectDir: string, dryRun: boolean): WriteOutcome[];
}

function skillFile(baseDir: string): string {
  return join(baseDir, 'skills', SKILL_DIRECTORY_NAME, 'SKILL.md');
}

export const AGENTS: AgentSetup[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    detect: (home) => existsSync(join(home, '.claude')) || existsSync(join(home, '.claude.json')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.claude')), dryRun),
      upsertJsonEntry(join(home, '.claude.json'), ['mcpServers', MCP_SERVER_NAME], HTTP_SERVER_ENTRY, dryRun),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.claude')), dryRun),
      upsertJsonEntry(join(projectDir, '.mcp.json'), ['mcpServers', MCP_SERVER_NAME], HTTP_SERVER_ENTRY, dryRun),
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: (home) => existsSync(join(home, '.cursor')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.cursor')), dryRun),
      upsertJsonEntry(join(home, '.cursor', 'mcp.json'), ['mcpServers', MCP_SERVER_NAME], HTTP_SERVER_ENTRY, dryRun),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.cursor')), dryRun),
      upsertJsonEntry(join(projectDir, '.cursor', 'mcp.json'), ['mcpServers', MCP_SERVER_NAME], HTTP_SERVER_ENTRY, dryRun),
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    detect: (home) => existsSync(join(home, '.config', 'opencode')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.config', 'opencode')), dryRun),
      upsertJsonEntry(
        join(home, '.config', 'opencode', 'opencode.json'),
        ['mcp', MCP_SERVER_NAME],
        { type: 'remote', url: MCP_SERVER_URL },
        dryRun
      ),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.opencode')), dryRun),
      upsertJsonEntry(
        join(projectDir, 'opencode.json'),
        ['mcp', MCP_SERVER_NAME],
        { type: 'remote', url: MCP_SERVER_URL },
        dryRun
      ),
    ],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    detect: (home) => existsSync(join(home, '.codex')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.codex')), dryRun),
      upsertTomlSection(join(home, '.codex', 'config.toml'), CODEX_SECTION_HEADER, CODEX_SECTION_BODY, dryRun),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.codex')), dryRun),
      {
        label: 'MCP server',
        path: join(homedir(), '.codex', 'config.toml'),
        action: 'skipped',
        detail: 'Codex MCP servers are user-level only; run without --project',
      },
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: (home) => existsSync(join(home, '.codeium', 'windsurf')),
    user: (home, dryRun) => [
      upsertJsonEntry(
        join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        ['mcpServers', MCP_SERVER_NAME],
        { serverUrl: MCP_SERVER_URL },
        dryRun
      ),
    ],
  },
  {
    id: 'zed',
    name: 'Zed',
    detect: (home) => existsSync(join(home, '.config', 'zed')),
    user: (home, dryRun) => [
      upsertJsonEntry(
        join(home, '.config', 'zed', 'settings.json'),
        ['context_servers', MCP_SERVER_NAME],
        { source: 'custom', command: 'npx', args: ['mcp-remote', MCP_SERVER_URL], env: {} },
        dryRun
      ),
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    detect: (home) => existsSync(vscodeUserDirectory(home)),
    user: (home, dryRun) => [
      upsertJsonEntry(
        join(vscodeUserDirectory(home), 'mcp.json'),
        ['servers', MCP_SERVER_NAME],
        HTTP_SERVER_ENTRY,
        dryRun
      ),
    ],
    project: (projectDir, dryRun) => [
      upsertJsonEntry(
        join(projectDir, '.vscode', 'mcp.json'),
        ['servers', MCP_SERVER_NAME],
        HTTP_SERVER_ENTRY,
        dryRun
      ),
    ],
  },
];

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
  ],
  examples: [
    'polylane setup',
    'polylane setup --agent claude --agent cursor',
    'polylane setup --project',
    'polylane setup --dry-run',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const project = getArgBoolean(args, 'project') === true;
    const requested = getArgArray(args, 'agent');
    const home = homedir();

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
      : AGENTS.filter((a) => a.detect(home));

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
          say(`${agent.id}: skipped — no project-level convention; run without --project`);
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
          say(`${agent.id}: register it manually — see https://docs.polylane.com/coding-agents/platform-mcp`);
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
