import type { Config } from './config/schema';
import type { GlobalFlags } from './types/flags';

export type OptionType = 'string' | 'number' | 'boolean' | 'array';

export interface OptionDef {
  flag: string;
  description: string;
  type?: OptionType;
  required?: boolean;
  short?: string;
}

export interface PositionalDef {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  options?: OptionDef[];
  positional?: PositionalDef[];
  examples?: string[];
  operationId?: string;
  execute(config: Config, flags: GlobalFlags, args: Record<string, unknown>): Promise<void>;
}

export const GLOBAL_OPTIONS: OptionDef[] = [
  { flag: '--api-key <key>', description: 'Override API key', type: 'string' },
  { flag: '--workspace <id>', description: 'Workspace ID', type: 'string', short: '-w' },
  { flag: '--domain <host>', description: 'API domain (hostname only)', type: 'string' },
  { flag: '--output <format>', description: 'Output format: text | json', type: 'string' },
  { flag: '--timeout <seconds>', description: 'Request timeout', type: 'number' },
  { flag: '--quiet', description: 'Suppress non-essential output', type: 'boolean' },
  { flag: '--verbose', description: 'Verbose logging', type: 'boolean' },
  { flag: '--no-color', description: 'Disable ANSI colors', type: 'boolean' },
  { flag: '--dry-run', description: 'Show what would happen without making changes', type: 'boolean' },
  { flag: '--non-interactive', description: 'Disable interactive prompts', type: 'boolean' },
  { flag: '--help', description: 'Show help', type: 'boolean', short: '-h' },
  { flag: '--version', description: 'Show CLI version', type: 'boolean', short: '-v' },
  { flag: '--per-page <n>', description: 'Items per page (for list commands)', type: 'number' },
  { flag: '--page <n>', description: 'Page number (for list commands)', type: 'number' },
  { flag: '--order-by <field>', description: 'Sort field (for list commands)', type: 'string' },
  { flag: '--order <direction>', description: 'Sort direction: asc | desc', type: 'string' },
];

export function extractFlagName(flag: string): string {
  const match = flag.match(/--([a-z0-9-]+)/i);
  return match ? match[1]! : flag;
}

export function hasValue(flag: string): boolean {
  return flag.includes('<') || flag.includes('[');
}
