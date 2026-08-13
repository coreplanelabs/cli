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
const URL_SERVER_ENTRY = { url: MCP_SERVER_URL };
const CODEX_SECTION_HEADER = `[mcp_servers.${MCP_SERVER_NAME}]`;
const CODEX_SECTION_BODY = `url = "${MCP_SERVER_URL}"\n`;
// Cline wants "streamableHttp", Roo wants "streamable-http" (it rejects the
// entry otherwise), Gemini keys HTTP streaming off "httpUrl" — none of these
// are interchangeable.
const CLINE_SERVER_ENTRY = { type: 'streamableHttp', url: MCP_SERVER_URL };
const ROO_SERVER_ENTRY = { type: 'streamable-http', url: MCP_SERVER_URL };
const GEMINI_SERVER_ENTRY = { httpUrl: MCP_SERVER_URL };

// Goose config is YAML (~/.config/goose/config.yaml). Same dependency-free
// approach as upsertTomlSection: exact-string checks and line inserts under
// the top-level `extensions:` block. Goose requires `uri` (not `url`) and
// `streamable_http` (underscore).
const GOOSE_EXTENSION_LINES = [
  `  ${MCP_SERVER_NAME}:`,
  `    enabled: true`,
  `    type: streamable_http`,
  `    name: ${MCP_SERVER_NAME}`,
  `    uri: ${MCP_SERVER_URL}`,
  `    timeout: 300`,
];

export function upsertGooseExtension(path: string, dryRun = false): WriteOutcome {
  const label = 'MCP server';
  if (!existsSync(path)) {
    if (!dryRun) {
      ensureDir(dirname(path));
      writeFileSync(path, ['extensions:', ...GOOSE_EXTENSION_LINES, ''].join('\n'), 'utf-8');
    }
    return { label, path, action: 'created' };
  }
  const current = readFileSync(path, 'utf-8');
  const lines = current.split('\n');
  if (lines.some((l) => l.startsWith(`  ${MCP_SERVER_NAME}:`))) {
    return { label, path, action: 'unchanged' };
  }
  const blockStart = lines.findIndex((l) => /^extensions:\s*$/.test(l));
  if (blockStart >= 0) {
    lines.splice(blockStart + 1, 0, ...GOOSE_EXTENSION_LINES);
    if (!dryRun) writeFileSync(path, lines.join('\n'), 'utf-8');
    return { label, path, action: 'updated' };
  }
  if (/^extensions:/m.test(current)) {
    return { label, path, action: 'skipped', detail: '`extensions:` is not a plain block; add the entry manually', needsManualStep: true };
  }
  const separator = current.endsWith('\n') || current === '' ? '' : '\n';
  if (!dryRun) writeFileSync(path, `${current}${separator}\nextensions:\n${GOOSE_EXTENSION_LINES.join('\n')}\n`, 'utf-8');
  return { label, path, action: 'updated' };
}

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
    id: 'pi',
    name: 'Pi',
    detect: (home) => existsSync(join(home, '.pi')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.pi', 'agent')), dryRun),
      upsertJsonEntry(join(home, '.pi', 'agent', 'mcp.json'), ['mcpServers', MCP_SERVER_NAME], URL_SERVER_ENTRY, dryRun),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.pi')), dryRun),
      upsertJsonEntry(join(projectDir, '.pi', 'mcp.json'), ['mcpServers', MCP_SERVER_NAME], URL_SERVER_ENTRY, dryRun),
    ],
  },
  {
    id: 'warp',
    name: 'Warp',
    detect: (home) => existsSync(join(home, '.warp')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.warp')), dryRun),
      upsertJsonEntry(join(home, '.warp', '.mcp.json'), ['mcpServers', MCP_SERVER_NAME], URL_SERVER_ENTRY, dryRun),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.warp')), dryRun),
      upsertJsonEntry(join(projectDir, '.warp', '.mcp.json'), ['mcpServers', MCP_SERVER_NAME], URL_SERVER_ENTRY, dryRun),
    ],
  },
  {
    id: 'cline',
    name: 'Cline',
    // Two Cline surfaces share one config format: the VS Code extension
    // (globalStorage) and the Cline CLI (~/.cline). Write to whichever exists
    // so we never create VS Code's storage tree for an uninstalled extension.
    detect: (home) =>
      existsSync(join(vscodeUserDirectory(home), 'globalStorage', 'saoudrizwan.claude-dev')) ||
      existsSync(join(home, '.cline')),
    user: (home, dryRun) => {
      const outcomes: WriteOutcome[] = [];
      const extensionDir = join(vscodeUserDirectory(home), 'globalStorage', 'saoudrizwan.claude-dev');
      if (existsSync(extensionDir)) {
        outcomes.push(
          upsertJsonEntry(join(extensionDir, 'settings', 'cline_mcp_settings.json'), ['mcpServers', MCP_SERVER_NAME], CLINE_SERVER_ENTRY, dryRun)
        );
      }
      // Fall back to the CLI location when neither surface exists yet, so an
      // explicit `--agent cline` always has an effect.
      if (existsSync(join(home, '.cline')) || outcomes.length === 0) {
        outcomes.push(
          upsertJsonEntry(join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json'), ['mcpServers', MCP_SERVER_NAME], CLINE_SERVER_ENTRY, dryRun)
        );
      }
      return outcomes;
    },
  },
  {
    id: 'roo',
    name: 'Roo Code',
    detect: (home) => existsSync(join(vscodeUserDirectory(home), 'globalStorage', 'rooveterinaryinc.roo-cline')),
    user: (home, dryRun) => [
      upsertJsonEntry(
        join(vscodeUserDirectory(home), 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'),
        ['mcpServers', MCP_SERVER_NAME],
        ROO_SERVER_ENTRY,
        dryRun
      ),
    ],
  },
  {
    id: 'goose',
    name: 'Goose',
    detect: (home) => existsSync(join(home, '.config', 'goose')),
    user: (home, dryRun) => [upsertGooseExtension(join(home, '.config', 'goose', 'config.yaml'), dryRun)],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    detect: (home) => existsSync(join(home, '.gemini')),
    user: (home, dryRun) => [
      upsertJsonEntry(join(home, '.gemini', 'settings.json'), ['mcpServers', MCP_SERVER_NAME], GEMINI_SERVER_ENTRY, dryRun),
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
