import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';

import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';

import { ensureDir } from '../utils/fs';
import { SKILL_MD } from '../generated/skill';

export const MCP_SERVER_NAME = 'polylane';
export const MCP_SERVER_URL = process.env.POLYLANE_MCP_URL || 'https://mcp.polylane.com/mcp';
export const SKILL_DIRECTORY_NAME = 'polylane-cli';

/** The prompt handed to a coding agent to map the current repository. */
export const MAPPING_PROMPT = 'Map this repository with Polylane';

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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nestEntry(keys: string[], value: unknown): unknown {
  return [...keys].reverse().reduce<unknown>((acc, key) => ({ [key]: acc }), value);
}

// JSONC-aware upsert for configs that may carry comments and trailing commas
// (opencode parses everything as JSONC). Existing files are edited in place
// with jsonc-parser — the same library opencode uses on its own config — so
// comments and the formatting of existing members survive. Only a file
// opencode itself couldn't parse is refused.
export function upsertJsoncEntry(
  path: string,
  keyPath: string[],
  value: unknown,
  dryRun = false
): WriteOutcome {
  const label = 'MCP server';
  if (!existsSync(path)) {
    if (!dryRun) {
      ensureDir(dirname(path));
      writeFileSync(path, JSON.stringify(nestEntry(keyPath, value), null, 2) + '\n', 'utf-8');
    }
    return { label, path, action: 'created' };
  }

  const skip = (detail: string): WriteOutcome => ({
    label,
    path,
    action: 'skipped',
    detail,
    needsManualStep: true,
  });

  const text = readFileSync(path, 'utf-8');
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) return skip('existing file is not valid JSONC');
  if (!isJsonObject(parsed)) return skip('existing file is not a JSON object');

  let node: Record<string, unknown> = parsed;
  let reachedLeaf = true;
  for (const key of keyPath.slice(0, -1)) {
    const child = node[key];
    if (child === undefined) {
      reachedLeaf = false;
      break;
    }
    if (!isJsonObject(child)) return skip(`"${key}" is not a JSON object`);
    node = child;
  }
  if (reachedLeaf && node[keyPath[keyPath.length - 1]!] !== undefined) {
    return { label, path, action: 'unchanged' };
  }

  const edits = modify(text, keyPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
    getInsertionIndex: () => 0,
  });
  if (!dryRun) writeFileSync(path, applyEdits(text, edits), 'utf-8');
  return { label, path, action: 'updated' };
}

// opencode reads and merges both opencode.json and opencode.jsonc; edit the
// file that exists instead of creating a sibling next to it.
export function opencodeConfigFile(dir: string): string {
  const jsonc = join(dir, 'opencode.jsonc');
  return existsSync(jsonc) ? jsonc : join(dir, 'opencode.json');
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

/**
 * Whether `dir` looks like an installed agent's home rather than a directory
 * some other tool created. skills.sh writes `<agent dir>/skills/<skill>/` for
 * every agent it installs to — with `-y` and nothing detected, for every agent
 * it knows — so a directory whose only content is a `skills` tree (at any
 * depth, e.g. `~/.pi/agent/skills`) is skills.sh's footprint, not the agent's.
 * Any regular file, or any non-`skills` subdirectory that itself has a
 * footprint, counts. Stops at the first file found.
 */
export function hasAgentFootprint(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    // Dirents report a symlink as neither file nor directory; follow it so a
    // dotfiles-managed (stow/chezmoi) symlinked `skills` dir is still skipped
    // and a symlinked config file still counts. A dangling link counts as a
    // file: something put it there on purpose.
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (!isDirectory) return true;
    if (entry.name === 'skills') continue;
    if (hasAgentFootprint(path)) return true;
  }
  return false;
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

/**
 * How to launch an agent headlessly for a one-shot, auto-approved run of a
 * prompt. Absent for agents with no scriptable headless entry (IDE/extension
 * surfaces like Windsurf, Zed, Roo, VS Code).
 */
export interface HeadlessRun {
  /** The executable to invoke; must resolve on PATH for the recipe to run. */
  bin: string;
  /** Build the full argv (excluding `bin`) for a one-shot run of `prompt`. */
  args(prompt: string): string[];
  /** Extra environment needed to run non-interactively (merged over process.env). */
  env?: Record<string, string>;
}

export interface AgentSetup {
  id: string;
  name: string;
  detect(home: string): boolean;
  user(home: string, dryRun: boolean): WriteOutcome[];
  project?(projectDir: string, dryRun: boolean): WriteOutcome[];
  /** How to run this agent headlessly, when it has a scriptable one-shot mode. */
  headlessRun?: HeadlessRun;
}

function skillFile(baseDir: string): string {
  return join(baseDir, 'skills', SKILL_DIRECTORY_NAME, 'SKILL.md');
}

export const AGENTS: AgentSetup[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    headlessRun: { bin: 'claude', args: (prompt) => ['-p', prompt, '--permission-mode', 'bypassPermissions'] },
    detect: (home) => hasAgentFootprint(join(home, '.claude')) || existsSync(join(home, '.claude.json')),
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
    headlessRun: { bin: 'cursor-agent', args: (prompt) => ['-p', prompt, '--force'] },
    detect: (home) => hasAgentFootprint(join(home, '.cursor')),
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
    headlessRun: { bin: 'opencode', args: (prompt) => ['run', prompt] },
    detect: (home) => hasAgentFootprint(join(home, '.config', 'opencode')),
    user: (home, dryRun) => [
      writeSkillFile(skillFile(join(home, '.config', 'opencode')), dryRun),
      upsertJsoncEntry(
        opencodeConfigFile(join(home, '.config', 'opencode')),
        ['mcp', MCP_SERVER_NAME],
        { type: 'remote', url: MCP_SERVER_URL },
        dryRun
      ),
    ],
    project: (projectDir, dryRun) => [
      writeSkillFile(skillFile(join(projectDir, '.opencode')), dryRun),
      upsertJsoncEntry(
        opencodeConfigFile(projectDir),
        ['mcp', MCP_SERVER_NAME],
        { type: 'remote', url: MCP_SERVER_URL },
        dryRun
      ),
    ],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    headlessRun: { bin: 'codex', args: (prompt) => ['exec', '--full-auto', prompt] },
    detect: (home) => hasAgentFootprint(join(home, '.codex')),
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
    headlessRun: { bin: 'pi', args: (prompt) => ['-p', prompt] },
    detect: (home) => hasAgentFootprint(join(home, '.pi')),
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
    detect: (home) => hasAgentFootprint(join(home, '.warp')),
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
    headlessRun: { bin: 'cline', args: (prompt) => ['--yolo', prompt] },
    // Two Cline surfaces share one config format: the VS Code extension
    // (globalStorage) and the Cline CLI (~/.cline). Write to whichever exists
    // so we never create VS Code's storage tree for an uninstalled extension.
    detect: (home) =>
      existsSync(join(vscodeUserDirectory(home), 'globalStorage', 'saoudrizwan.claude-dev')) ||
      hasAgentFootprint(join(home, '.cline')),
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
    headlessRun: { bin: 'goose', args: (prompt) => ['run', '--no-session', '-t', prompt], env: { GOOSE_MODE: 'auto' } },
    detect: (home) => hasAgentFootprint(join(home, '.config', 'goose')),
    user: (home, dryRun) => [upsertGooseExtension(join(home, '.config', 'goose', 'config.yaml'), dryRun)],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    headlessRun: { bin: 'gemini', args: (prompt) => ['-p', prompt, '--yolo'] },
    detect: (home) => hasAgentFootprint(join(home, '.gemini')),
    user: (home, dryRun) => [
      upsertJsonEntry(join(home, '.gemini', 'settings.json'), ['mcpServers', MCP_SERVER_NAME], GEMINI_SERVER_ENTRY, dryRun),
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: (home) => hasAgentFootprint(join(home, '.codeium', 'windsurf')),
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
    detect: (home) => hasAgentFootprint(join(home, '.config', 'zed')),
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
    detect: (home) => hasAgentFootprint(vscodeUserDirectory(home)),
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

export const AGENT_IDS = AGENTS.map((a) => a.id);

/** The agents installed for `home`, in registry order. The one detection the installer and setup share. */
export function detectedAgents(home: string): AgentSetup[] {
  return AGENTS.filter((a) => a.detect(home));
}

/**
 * skills.sh agent ids (`npx skills add … -a <id>`) for each registry agent;
 * `null` when skills.sh has no counterpart (VS Code's closest, github-copilot,
 * targets ~/.copilot — a different product). The installer pins the skills.sh
 * version (SKILLS_CLI in polylanedotcom's install.sh); re-check this table on
 * a bump. Every registry agent must appear here — a test enforces it — so a
 * new agent is a deliberate skills.sh decision, not a silent drop.
 */
export const SKILLS_SH_IDS: Record<string, string | null> = {
  claude: 'claude-code',
  cursor: 'cursor',
  opencode: 'opencode',
  codex: 'codex',
  pi: 'pi',
  warp: 'warp',
  cline: 'cline',
  roo: 'roo',
  goose: 'goose',
  gemini: 'gemini-cli',
  windsurf: 'windsurf',
  zed: 'zed',
  vscode: null,
};

export type AgentIdNamespace = 'polylane' | 'skills-sh';
export const AGENT_ID_NAMESPACES: AgentIdNamespace[] = ['polylane', 'skills-sh'];

/** Ids of the detected agents in the requested namespace; agents with no id there are omitted. */
export function detectedAgentIds(home: string, namespace: AgentIdNamespace): string[] {
  const ids: string[] = [];
  for (const agent of detectedAgents(home)) {
    const id = namespace === 'polylane' ? agent.id : SKILLS_SH_IDS[agent.id];
    if (id) ids.push(id);
  }
  return ids;
}

export function agentById(id: string): AgentSetup | undefined {
  return AGENTS.find((a) => a.id === id);
}

