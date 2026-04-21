import type { Config } from '../config/schema';
import { outputJson } from './json';
import { outputTable, outputKeyValue, formatValue } from './text';

export interface TableDef<T> {
  headers: string[];
  rows: (item: T) => string[];
}

function stripLinks(obj: Record<string, unknown>): {
  clean: Record<string, unknown>;
  htmlUrl?: string;
  links?: Record<string, string>;
} {
  const clean: Record<string, unknown> = {};
  let htmlUrl: string | undefined;
  let links: Record<string, string> | undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_html_url' && typeof v === 'string') {
      htmlUrl = v;
      continue;
    }
    if (k === '_links' && v !== null && typeof v === 'object') {
      const rec = v as Record<string, unknown>;
      const l: Record<string, string> = {};
      for (const [lk, lv] of Object.entries(rec)) {
        if (typeof lv === 'string') l[lk] = lv;
      }
      if (Object.keys(l).length > 0) links = l;
      continue;
    }
    clean[k] = v;
  }
  return { clean, htmlUrl, links };
}

function writeLinksFooter(htmlUrl: string | undefined, links: Record<string, string> | undefined): void {
  if (!htmlUrl && !links) return;
  process.stdout.write('\n');
  if (htmlUrl) process.stdout.write(`Console:  ${htmlUrl}\n`);
  if (links) {
    process.stdout.write('Next:\n');
    const pad = Math.max(...Object.keys(links).map((k) => k.length));
    for (const [k, v] of Object.entries(links)) {
      process.stdout.write(`  ${k.padEnd(pad)}  ${v}\n`);
    }
  }
}

export function formatOutput(config: Config, data: unknown): void {
  if (config.output === 'json') {
    outputJson(data);
    return;
  }
  if (data === null || data === undefined) {
    process.stdout.write('(empty)\n');
    return;
  }
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    process.stdout.write(String(data) + '\n');
    return;
  }
  if (Array.isArray(data)) {
    formatArray(data);
    return;
  }
  if (typeof data === 'object') {
    const { clean, htmlUrl, links } = stripLinks(data as Record<string, unknown>);
    formatObject(clean);
    writeLinksFooter(htmlUrl, links);
    return;
  }
}

export function formatList<T extends Record<string, unknown>>(
  config: Config,
  result: { items: T[]; count: number },
  table?: TableDef<T>
): void {
  if (config.output === 'json') {
    outputJson(result);
    return;
  }
  if (table && result.items.length > 0) {
    outputTable(
      table.headers,
      result.items.map((item) => table.rows(item))
    );
    if (!config.quiet) {
      process.stdout.write(`\n${result.count} item${result.count === 1 ? '' : 's'} total\n`);
    }
    return;
  }
  formatArray(result.items);
}

export function formatSingle<T extends Record<string, unknown>>(
  config: Config,
  data: T,
  fields?: Array<keyof T | [keyof T, string]>
): void {
  if (config.output === 'json') {
    outputJson(data);
    return;
  }
  const { clean, htmlUrl, links } = stripLinks(data as Record<string, unknown>);
  if (fields) {
    const pairs: Array<[string, unknown]> = fields.map((f) => {
      if (Array.isArray(f)) return [f[1], data[f[0]]];
      return [String(f), data[f]];
    });
    outputKeyValue(pairs);
  } else {
    formatObject(clean);
  }
  writeLinksFooter(htmlUrl, links);
}

function formatArray(items: unknown[]): void {
  if (items.length === 0) {
    process.stdout.write('(no items)\n');
    return;
  }
  for (const item of items) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      formatObject(item as Record<string, unknown>);
      process.stdout.write('\n');
    } else {
      process.stdout.write(formatValue(item) + '\n');
    }
  }
}

function formatObject(obj: Record<string, unknown>): void {
  const pairs: Array<[string, unknown]> = Object.entries(obj);
  outputKeyValue(pairs);
}

export { outputJson, outputTable, outputKeyValue };
