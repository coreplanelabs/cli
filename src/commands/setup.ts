import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import type { Command } from '../command';
import type { Config } from '../config/schema';
import { tryResolveCredential } from '../auth/resolver';
import { ensureDir } from '../utils/fs';
import { getArgBoolean } from './helpers';
import { SKILL_MD } from '../generated/skill';

export const MCP_SERVER_NAME = 'polylane';
export const MCP_SERVER_URL = process.env.POLYLANE_MCP_URL || 'https://mcp.polylane.com/mcp';
export const SKILL_DIRECTORY_NAME = 'polylane-cli';

export type SkillInstallAction = 'created' | 'updated' | 'unchanged';

export interface SkillInstallResult {
  path: string;
  action: SkillInstallAction;
}

export function installSkill(skillFilePath: string): SkillInstallResult {
  if (existsSync(skillFilePath)) {
    const current = readFileSync(skillFilePath, 'utf-8');
    if (current === SKILL_MD) {
      return { path: skillFilePath, action: 'unchanged' };
    }
    writeFileSync(skillFilePath, SKILL_MD, 'utf-8');
    return { path: skillFilePath, action: 'updated' };
  }
  ensureDir(dirname(skillFilePath));
  writeFileSync(skillFilePath, SKILL_MD, 'utf-8');
  return { path: skillFilePath, action: 'created' };
}

export type McpRegisterAction = 'registered' | 'unchanged' | 'skipped';

export interface McpRegisterResult {
  path: string;
  action: McpRegisterAction;
  reason?: string;
}

export function registerMcpServer(agentConfigPath: string): McpRegisterResult {
  let root: Record<string, unknown> = {};
  if (existsSync(agentConfigPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(agentConfigPath, 'utf-8'));
    } catch {
      return {
        path: agentConfigPath,
        action: 'skipped',
        reason: 'existing file is not valid JSON',
      };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        path: agentConfigPath,
        action: 'skipped',
        reason: 'existing file is not a JSON object',
      };
    }
    root = parsed as Record<string, unknown>;
  }

  const existingServers = root.mcpServers;
  const servers: Record<string, unknown> =
    typeof existingServers === 'object' && existingServers !== null && !Array.isArray(existingServers)
      ? (existingServers as Record<string, unknown>)
      : {};
  root.mcpServers = servers;

  if (servers[MCP_SERVER_NAME] !== undefined) {
    return { path: agentConfigPath, action: 'unchanged' };
  }

  servers[MCP_SERVER_NAME] = { type: 'http', url: MCP_SERVER_URL };
  ensureDir(dirname(agentConfigPath));
  writeFileSync(agentConfigPath, JSON.stringify(root, null, 2) + '\n', 'utf-8');
  return { path: agentConfigPath, action: 'registered' };
}

export function skillInstallPath(baseDir: string): string {
  return join(baseDir, '.claude', 'skills', SKILL_DIRECTORY_NAME, 'SKILL.md');
}

export function userAgentConfigPath(baseDir: string): string {
  return join(baseDir, '.claude.json');
}

export function projectAgentConfigPath(baseDir: string): string {
  return join(baseDir, '.mcp.json');
}

const SKILL_ACTION_LABEL: Record<SkillInstallAction, string> = {
  created: 'Installed agent skill',
  updated: 'Updated agent skill',
  unchanged: 'Agent skill already up to date',
};

const MCP_ACTION_LABEL: Record<McpRegisterAction, string> = {
  registered: 'Registered MCP server',
  unchanged: 'MCP server already registered',
  skipped: 'Skipped MCP registration',
};

export const setupCommand: Command = {
  name: 'setup',
  description: 'Wire the CLI into coding agents (agent skill + MCP server)',
  options: [
    {
      flag: '--project',
      description: 'Install into the current project (./.claude/skills + ./.mcp.json) instead of the home directory',
      type: 'boolean',
    },
  ],
  examples: [
    'polylane setup',
    'polylane setup --project',
    'polylane setup --dry-run',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const project = getArgBoolean(args, 'project') === true;
    const baseDir = project ? process.cwd() : homedir();
    const skillPath = skillInstallPath(baseDir);
    const agentConfigPath = project
      ? projectAgentConfigPath(baseDir)
      : userAgentConfigPath(baseDir);

    const say = (line: string): void => {
      if (!config.quiet) process.stderr.write(line + '\n');
    };

    if (config.dryRun) {
      say(`Would install agent skill: ${skillPath}`);
      say(`Would register MCP server "${MCP_SERVER_NAME}" (${MCP_SERVER_URL}) in: ${agentConfigPath}`);
      return;
    }

    const skill = installSkill(skillPath);
    say(`${SKILL_ACTION_LABEL[skill.action]}: ${skill.path}`);

    const mcp = registerMcpServer(agentConfigPath);
    if (mcp.action === 'skipped') {
      say(`${MCP_ACTION_LABEL[mcp.action]}: ${mcp.path} (${mcp.reason ?? 'unknown reason'})`);
      say(`Register it manually: claude mcp add --transport http ${MCP_SERVER_NAME} ${MCP_SERVER_URL}`);
    } else {
      say(`${MCP_ACTION_LABEL[mcp.action]}: ${MCP_SERVER_URL} in ${mcp.path}`);
    }

    const credential = await tryResolveCredential(config);
    if (credential) {
      say('Authentication: signed in.');
    } else {
      say('Authentication: not signed in. Run `polylane auth login` to authenticate.');
    }
  },
};
