import type { Command, OptionDef, PositionalDef } from './command';
import { GLOBAL_OPTIONS } from './command';
import { shouldUseColor } from './utils/env';
import { tryResolveCredential } from './auth/resolver';
import type { Config } from './config/schema';

interface TreeNode {
  command?: Command;
  children: Map<string, TreeNode>;
}

export interface ResourceGroup {
  name: string;
  description: string;
  order: number;
}

const RESOURCE_ORDER: Record<string, ResourceGroup> = {
  case: { name: 'case', description: 'Cases and investigations', order: 10 },
  service: { name: 'service', description: 'Cloud infrastructure (nodes, logs, metrics, graph)', order: 20 },
  repo: { name: 'repo', description: 'Repositories and code search', order: 30 },
  wiki: { name: 'wiki', description: 'Generated wiki documentation', order: 40 },
  memory: { name: 'memory', description: 'Persistent agent memory', order: 50 },
  thread: { name: 'thread', description: 'Conversation threads', order: 60 },
  skill: { name: 'skill', description: 'Reusable agent skills (catalog, install, docs)', order: 63 },
  automation: { name: 'automation', description: 'Automations and executions', order: 65 },
  integration: { name: 'integration', description: 'Observability tools and cloud providers', order: 68 },
  cloud: { name: 'cloud', description: 'Cloud accounts (aws, cloudflare, fly, render, vercel)', order: 69 },
  workspace: { name: 'workspace', description: 'Workspaces', order: 70 },
  auth: { name: 'auth', description: 'Authentication (login, status, logout)', order: 80 },
  config: { name: 'config', description: 'CLI configuration', order: 90 },
  telemetry: { name: 'telemetry', description: 'Anonymous usage telemetry (status/enable/disable)', order: 95 },
  api: { name: 'api', description: 'Raw API access (advanced)', order: 100 },
  help: { name: 'help', description: 'Show help for a command', order: 110 },
  update: { name: 'update', description: 'Check for CLI updates', order: 120 },
};

export class CommandRegistry {
  private root: TreeNode = { children: new Map() };
  private all: Command[] = [];

  register(cmd: Command): void {
    this.all.push(cmd);
    const parts = cmd.name.split(/\s+/);
    let node = this.root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.command = cmd;
  }

  resolve(path: string[]): { command: Command; consumed: number } | null {
    let node = this.root;
    let consumed = 0;
    let bestMatch: { command: Command; consumed: number } | null = null;

    for (const part of path) {
      const child = node.children.get(part);
      if (!child) break;
      node = child;
      consumed++;
      if (node.command) {
        bestMatch = { command: node.command, consumed };
      }
    }

    if (bestMatch) return bestMatch;
    if (consumed !== path.length) return null;
    if (node.command) return { command: node.command, consumed };
    if (node.children.size === 1) {
      const only = [...node.children.values()][0]!;
      if (only.command) return { command: only.command, consumed };
    }
    return null;
  }

  resolveNode(path: string[]): TreeNode | null {
    let node = this.root;
    for (const part of path) {
      const child = node.children.get(part);
      if (!child) return null;
      node = child;
    }
    return node;
  }

  getSubcommands(node: TreeNode): Command[] {
    const out: Command[] = [];
    for (const child of node.children.values()) {
      if (child.command) out.push(child.command);
    }
    return out;
  }

  getAll(): Command[] {
    return [...this.all];
  }

  getResourceGroups(): Array<{ resource: string; commands: Command[]; meta: ResourceGroup }> {
    const byResource = new Map<string, Command[]>();
    for (const cmd of this.all) {
      const resource = cmd.name.split(/\s+/)[0]!;
      const list = byResource.get(resource) ?? [];
      list.push(cmd);
      byResource.set(resource, list);
    }
    const groups: Array<{ resource: string; commands: Command[]; meta: ResourceGroup }> = [];
    for (const [resource, commands] of byResource) {
      const meta = RESOURCE_ORDER[resource] ?? {
        name: resource,
        description: '',
        order: 1000,
      };
      groups.push({ resource, commands, meta });
    }
    groups.sort((a, b) => a.meta.order - b.meta.order);
    return groups;
  }
}

export const registry = new CommandRegistry();

function color(s: string, code: string, useColor: boolean): string {
  if (!useColor) return s;
  return `\x1B[${code}m${s}\x1B[0m`;
}

function buildUsage(cmd: Command): string {
  const parts = [`nominal ${cmd.name}`];
  for (const p of cmd.positional ?? []) {
    const token = p.required === false ? `[${p.name}]` : `<${p.name}>`;
    parts.push(p.variadic ? `${token}...` : token);
  }
  parts.push('[options]');
  return parts.join(' ');
}

function statusLine(config: Config | null): string | null {
  if (!config) return null;
  try {
    const noop = Promise.resolve(null);
    void noop;
  } catch {
    return null;
  }
  return null;
}

export async function buildStatusLine(config: Config): Promise<string> {
  const cred = await tryResolveCredential(config);
  if (!cred) return 'Not logged in.';

  const ws = config.workspaceId ? `workspace: ${config.workspaceId}` : 'no workspace set';
  if (cred.type === 'api-key') {
    return `Signed in with API key · ${ws}`;
  }
  const acct = cred.account ?? 'oauth';
  return `Signed in as ${acct} · ${ws}`;
}

export function renderRootHelp(
  noColor: boolean,
  statusMessage: string | null
): string {
  const useColor = shouldUseColor(noColor);
  const bold = (s: string): string => color(s, '1', useColor);
  const dim = (s: string): string => color(s, '2', useColor);
  const cyan = (s: string): string => color(s, '36', useColor);

  const lines: string[] = [];
  if (statusMessage) {
    lines.push(dim(statusMessage));
    lines.push('');
  }
  lines.push(`${bold('nominal')} — CLI for the Nominal platform`);
  lines.push('');
  lines.push(`${bold('Usage:')} nominal <resource> <command> [options]`);
  lines.push('');
  lines.push(bold('Resources:'));

  const groups = registry.getResourceGroups();
  const pad = Math.max(...groups.map((g) => g.resource.length)) + 2;
  for (const g of groups) {
    lines.push(`  ${cyan(g.resource.padEnd(pad))} ${dim(g.meta.description)}`);
  }

  lines.push('');
  lines.push(bold('Global flags:'));
  lines.push(`  ${cyan('--api-key <key>')}        API key`);
  lines.push(`  ${cyan('--workspace <id>')}       Workspace ID`);
  lines.push(`  ${cyan('--domain <host>')}        API hostname (default: api.nominal.dev)`);
  lines.push(`  ${cyan('--output <text|json>')}   Output format (default: text in TTY, json when piped)`);
  lines.push(`  ${cyan('--verbose')}              Log HTTP requests`);
  lines.push(`  ${cyan('--dry-run')}              Show the request without sending`);
  lines.push(`  ${cyan('--non-interactive')}      Disable prompts`);
  lines.push(`  ${cyan('--help')}                 Show help`);
  lines.push(`  ${cyan('--version')}              Show version`);
  lines.push('');
  lines.push(bold('Getting help:'));
  lines.push(`  ${dim('Add --help after any command for its options and examples, e.g.')}`);
  lines.push(`  ${dim('nominal case investigate --help')}`);
  return lines.join('\n') + '\n';
}

export function renderGroupHelp(path: string[], commands: Command[], noColor: boolean): string {
  const useColor = shouldUseColor(noColor);
  const bold = (s: string): string => color(s, '1', useColor);
  const dim = (s: string): string => color(s, '2', useColor);
  const cyan = (s: string): string => color(s, '36', useColor);

  const lines: string[] = [];
  const prefix = path.join(' ');
  lines.push(`${bold('Usage:')} nominal ${prefix} <command> [options]`);
  lines.push('');
  lines.push(bold('Commands:'));
  const pad = Math.max(...commands.map((c) => c.name.length)) + 2;
  for (const cmd of commands) {
    lines.push(`  ${cyan(cmd.name.padEnd(pad))} ${dim(cmd.description)}`);
  }
  lines.push('');
  lines.push(dim('Run nominal <command> --help for full options and examples.'));
  return lines.join('\n') + '\n';
}

export function renderCommandHelp(cmd: Command, noColor: boolean): string {
  const useColor = shouldUseColor(noColor);
  const bold = (s: string): string => color(s, '1', useColor);
  const dim = (s: string): string => color(s, '2', useColor);
  const cyan = (s: string): string => color(s, '36', useColor);

  const lines: string[] = [];
  lines.push(cmd.description);
  lines.push('');
  lines.push(`${bold('Usage:')} ${cmd.usage ?? buildUsage(cmd)}`);

  if (cmd.positional && cmd.positional.length > 0) {
    lines.push('');
    lines.push(bold('Arguments:'));
    const pad = Math.max(...cmd.positional.map((p: PositionalDef) => p.name.length)) + 2;
    for (const p of cmd.positional) {
      const marker = p.required === false ? dim(' (optional)') : '';
      lines.push(`  ${cyan(p.name.padEnd(pad))} ${p.description}${marker}`);
    }
  }

  if (cmd.options && cmd.options.length > 0) {
    lines.push('');
    lines.push(bold('Options:'));
    const pad = Math.max(...cmd.options.map((o: OptionDef) => o.flag.length)) + 2;
    for (const o of cmd.options) {
      lines.push(`  ${cyan(o.flag.padEnd(pad))} ${o.description}`);
    }
  }

  if (cmd.examples && cmd.examples.length > 0) {
    lines.push('');
    lines.push(bold('Examples:'));
    for (const ex of cmd.examples) {
      lines.push(`  ${dim(ex)}`);
    }
  }

  lines.push('');
  lines.push(dim('Run nominal --help for global flags.'));
  return lines.join('\n') + '\n';
}

export function renderHelp(cmd: Command | null, noColor: boolean): string {
  if (cmd) return renderCommandHelp(cmd, noColor);
  return renderRootHelp(noColor, null);
}

export { GLOBAL_OPTIONS, statusLine };
