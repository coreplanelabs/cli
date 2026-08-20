import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
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
  snippet?: string;
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

function skipString(s: string, i: number): number {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') i += 2;
    else if (s[i] === '"') return i + 1;
    else i++;
  }
  return i;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

// Blank out comments and trailing commas with spaces, so the result is
// strict JSON with every remaining character at its original offset.
function stripJsonc(text: string): string {
  const chars = text.split('');
  for (let i = 0; i < chars.length; ) {
    if (chars[i] === '"') {
      i = skipString(text, i);
    } else if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      chars[i] = chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) {
        chars[i] = chars[i + 1] = ' ';
        i += 2;
      }
    } else {
      i++;
    }
  }
  const blanked = chars.join('');
  for (let i = 0; i < chars.length; ) {
    if (chars[i] === '"') {
      i = skipString(blanked, i);
    } else if (chars[i] === ',') {
      const j = skipWs(blanked, i + 1);
      if (blanked[j] === '}' || blanked[j] === ']') chars[i] = ' ';
      i++;
    } else {
      i++;
    }
  }
  return chars.join('');
}

function skipValue(s: string, i: number): number {
  if (s[i] === '"') return skipString(s, i);
  if (s[i] === '{' || s[i] === '[') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '"') {
        i = skipString(s, i);
        continue;
      }
      if (s[i] === '{' || s[i] === '[') depth++;
      else if (s[i] === '}' || s[i] === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return i;
  }
  while (i < s.length && !/[\s,}\]]/.test(s[i]!)) i++;
  return i;
}

// Index of the `{` opening the object reached by `keys` ([] = root), or -1.
function objectOpenIndex(s: string, keys: string[]): number {
  let i = skipWs(s, 0);
  if (s[i] !== '{') return -1;
  for (const key of keys) {
    let j = skipWs(s, i + 1);
    let valueAt = -1;
    while (j < s.length && s[j] !== '}') {
      if (s[j] !== '"') return -1;
      const keyEnd = skipString(s, j);
      let name: unknown;
      try {
        name = JSON.parse(s.slice(j, keyEnd));
      } catch {
        return -1;
      }
      j = skipWs(s, keyEnd);
      if (s[j] !== ':') return -1;
      j = skipWs(s, j + 1);
      if (name === key) {
        valueAt = j;
        break;
      }
      j = skipWs(s, skipValue(s, j));
      if (s[j] === ',') j = skipWs(s, j + 1);
    }
    if (valueAt < 0 || s[valueAt] !== '{') return -1;
    i = valueAt;
  }
  return i;
}

function nestEntry(keys: string[], value: unknown): unknown {
  return [...keys].reverse().reduce<unknown>((acc, key) => ({ [key]: acc }), value);
}

export function manualSnippet(keyPath: string[], value: unknown): string {
  return JSON.stringify(nestEntry(keyPath, value), null, 2).split('\n').slice(1, -1).join('\n');
}

// JSONC-aware upsert for configs that may carry comments and trailing commas
// (opencode parses everything as JSONC). Existing files are edited by textual
// insertion so comments and formatting survive; when the file can't be edited
// safely, the outcome carries a snippet to add by hand instead of clobbering.
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

  const manual = (detail: string): WriteOutcome => ({
    label,
    path,
    action: 'skipped',
    detail,
    needsManualStep: true,
    snippet: manualSnippet(keyPath, value),
  });

  const text = readFileSync(path, 'utf-8');
  const stripped = stripJsonc(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return manual('existing file is not valid JSON');
  }
  if (!isJsonObject(parsed)) {
    return manual('existing file is not a JSON object');
  }

  let node: Record<string, unknown> = parsed;
  let depth = 0;
  for (const key of keyPath.slice(0, -1)) {
    const child = node[key];
    if (child === undefined) break;
    if (!isJsonObject(child)) return manual(`"${key}" is not a JSON object`);
    node = child;
    depth++;
  }
  if (depth === keyPath.length - 1 && node[keyPath[depth]!] !== undefined) {
    return { label, path, action: 'unchanged' };
  }

  const openIdx = objectOpenIndex(stripped, keyPath.slice(0, depth));
  if (openIdx < 0) return manual('add the entry manually');

  const unit = /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
  const memberIndent = unit.repeat(depth + 1);
  const rendered = JSON.stringify(nestEntry(keyPath.slice(depth + 1), value), null, unit)
    .split('\n')
    .map((line, index) => (index === 0 ? line : memberIndent + line))
    .join('\n');
  const entry = `${JSON.stringify(keyPath[depth])}: ${rendered}`;
  const empty = stripped[skipWs(stripped, openIdx + 1)] === '}';
  const insertion = empty
    ? `\n${memberIndent}${entry}\n${unit.repeat(depth)}`
    : `\n${memberIndent}${entry},`;
  const next = text.slice(0, openIdx + 1) + insertion + text.slice(openIdx + 1);

  let probe: unknown;
  try {
    probe = JSON.parse(stripJsonc(next));
  } catch {
    probe = undefined;
  }
  for (const key of keyPath) {
    probe = isJsonObject(probe) ? probe[key] : undefined;
  }
  if (probe === undefined) return manual('add the entry manually');

  if (!dryRun) writeFileSync(path, next, 'utf-8');
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
    headlessRun: { bin: 'cursor-agent', args: (prompt) => ['-p', prompt, '--force'] },
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
    headlessRun: { bin: 'opencode', args: (prompt) => ['run', prompt] },
    detect: (home) => existsSync(join(home, '.config', 'opencode')),
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
    headlessRun: { bin: 'pi', args: (prompt) => ['-p', prompt] },
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
    headlessRun: { bin: 'cline', args: (prompt) => ['--yolo', prompt] },
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
    headlessRun: { bin: 'goose', args: (prompt) => ['run', '--no-session', '-t', prompt], env: { GOOSE_MODE: 'auto' } },
    detect: (home) => existsSync(join(home, '.config', 'goose')),
    user: (home, dryRun) => [upsertGooseExtension(join(home, '.config', 'goose', 'config.yaml'), dryRun)],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    headlessRun: { bin: 'gemini', args: (prompt) => ['-p', prompt, '--yolo'] },
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

export const AGENT_IDS = AGENTS.map((a) => a.id);

export function agentById(id: string): AgentSetup | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function isAgentId(id: string): boolean {
  return AGENTS.some((a) => a.id === id);
}

export function validateAgentId(id: string): void {
  if (!isAgentId(id)) {
    throw new CLIError(
      `Unknown agent: "${id}"`,
      ExitCode.USAGE,
      `Supported agents: ${AGENT_IDS.join(', ')}`
    );
  }
}
