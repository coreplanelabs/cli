import { type OptionDef, extractFlagName, hasValue } from './command';
import { CLIError } from './errors/base';
import { ExitCode } from './errors/codes';

type FlagSchemaEntry = { type: OptionType; name: string; short?: string };
type OptionType = 'string' | 'number' | 'boolean' | 'array';

function buildSchema(options: OptionDef[]): Map<string, FlagSchemaEntry> {
  const schema = new Map<string, FlagSchemaEntry>();
  for (const opt of options) {
    const name = extractFlagName(opt.flag);
    const type: OptionType = opt.type ?? (hasValue(opt.flag) ? 'string' : 'boolean');
    const entry: FlagSchemaEntry = { type, name, short: opt.short };
    schema.set(name, entry);
    schema.set(`--${name}`, entry);
    if (opt.short) {
      schema.set(opt.short, entry);
    }
  }
  return schema;
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function isBooleanLike(schema: Map<string, FlagSchemaEntry>, token: string): boolean {
  const cleaned = token.startsWith('--') ? token : token;
  const entry = schema.get(cleaned);
  return entry?.type === 'boolean';
}

export function scanCommandPath(argv: string[], globalOptions: OptionDef[]): string[] {
  const schema = buildSchema(globalOptions);
  const path: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === '--') break;
    if (token.startsWith('-')) {
      // Handle --flag=value
      if (token.includes('=')) {
        i++;
        continue;
      }
      const base = token;
      if (isBooleanLike(schema, base)) {
        i++;
      } else {
        i += 2;
      }
      continue;
    }
    path.push(token);
    i++;
  }
  return path;
}

export function parseFlags(
  argv: string[],
  commandOptions: OptionDef[],
  globalOptions: OptionDef[]
): { flags: Record<string, unknown>; positional: string[] } {
  const schema = buildSchema([...globalOptions, ...commandOptions]);
  const flags: Record<string, unknown> = {};
  const positional: string[] = [];

  let i = 0;
  let passThrough = false;

  while (i < argv.length) {
    const token = argv[i]!;

    if (passThrough) {
      positional.push(token);
      i++;
      continue;
    }

    if (token === '--') {
      passThrough = true;
      i++;
      continue;
    }

    if (!token.startsWith('-')) {
      positional.push(token);
      i++;
      continue;
    }

    let name: string;
    let rawValue: string | undefined;

    if (token.includes('=')) {
      const eqIdx = token.indexOf('=');
      name = token.slice(0, eqIdx);
      rawValue = token.slice(eqIdx + 1);
    } else {
      name = token;
    }

    const entry = schema.get(name);
    if (!entry) {
      throw new CLIError(`Unknown flag: ${name}`, ExitCode.USAGE);
    }

    const key = kebabToCamel(entry.name);

    if (entry.type === 'boolean') {
      flags[key] = true;
      i++;
      continue;
    }

    let value = rawValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && !/^-\d/.test(next))) {
        throw new CLIError(
          `Flag ${name} requires a value`,
          ExitCode.USAGE
        );
      }
      value = next;
      i += 2;
    } else {
      i++;
    }

    if (entry.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new CLIError(
          `Flag ${name} expects a number, got "${value}"`,
          ExitCode.USAGE
        );
      }
      flags[key] = n;
    } else if (entry.type === 'array') {
      const existing = flags[key];
      if (Array.isArray(existing)) {
        (existing as string[]).push(value);
      } else {
        flags[key] = [value];
      }
    } else {
      flags[key] = value;
    }
  }

  return { flags, positional };
}
