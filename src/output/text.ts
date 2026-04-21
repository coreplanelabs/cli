export type TextValue = string | number | boolean | null | undefined;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) {
    // Array of primitives → comma-joined. Array of objects → multi-line indented block.
    if (v.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      return v.map(formatValue).join(', ');
    }
    const lines: string[] = [];
    for (const item of v) {
      if (isPlainObject(item)) {
        const pretty = formatObjectInline(item, 0);
        lines.push('-');
        for (const line of pretty.split('\n')) {
          lines.push('  ' + line);
        }
      } else {
        lines.push('- ' + formatValue(item));
      }
    }
    return lines.join('\n');
  }
  if (isPlainObject(v)) return formatObjectInline(v, 0);
  return String(v);
}

function formatObjectInline(obj: Record<string, unknown>, depth: number): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const maxKey = Math.max(...entries.map(([k]) => k.length));
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  for (const [k, v] of entries) {
    const formatted = formatValue(v);
    if (formatted.includes('\n')) {
      lines.push(`${indent}${k.padEnd(maxKey)}  |`);
      for (const line of formatted.split('\n')) {
        lines.push(`${indent}${' '.repeat(maxKey)}  | ${line}`);
      }
    } else {
      lines.push(`${indent}${k.padEnd(maxKey)}  ${formatted}`);
    }
  }
  return lines.join('\n');
}

export function outputTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    process.stdout.write('(no items)\n');
    return;
  }
  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > max) max = cell.length;
    }
    return max;
  });

  const headerLine = headers.map((h, i) => h.toUpperCase().padEnd(widths[i]!)).join('  ');
  process.stdout.write(headerLine + '\n');

  for (const row of rows) {
    const rowLine = row.map((cell, i) => (cell ?? '').padEnd(widths[i]!)).join('  ');
    process.stdout.write(rowLine + '\n');
  }
}

export function outputKeyValue(pairs: Array<[string, unknown]>): void {
  if (pairs.length === 0) return;
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  for (const [key, value] of pairs) {
    const formatted = formatValue(value);
    if (formatted.includes('\n')) {
      process.stdout.write(`${key.padEnd(maxKey)}  |\n`);
      for (const line of formatted.split('\n')) {
        process.stdout.write(`${' '.repeat(maxKey)}  | ${line}\n`);
      }
    } else {
      process.stdout.write(`${key.padEnd(maxKey)}  ${formatted}\n`);
    }
  }
}

export function outputPlain(text: string): void {
  process.stdout.write(text);
  if (!text.endsWith('\n')) process.stdout.write('\n');
}

export function outputList(items: string[]): void {
  for (const item of items) {
    process.stdout.write(item + '\n');
  }
}
